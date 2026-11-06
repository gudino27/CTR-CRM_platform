/**
 * Dispatcher: when a post's slot comes, POST the publish payload to n8n. The app never talks
 * to a social platform; n8n publishes and may report back through the status callback
 * (POST /api/posts/:id/status).
 *
 * What lives here: dispatchDue (run by every scheduler tick), failInterrupted (run once at
 * startup), buildPayload and payloadProblems (the payload contract), webhookUrlFor and
 * testEndpointUrl (where posts go).
 */
import { absoluteUrl, config } from '../config.js';
import { clock } from './clock.js';
import { serialized } from './lock.js';
import { offsetIso } from './time.js';
import { webhookTimeoutMs } from '../settings.js';

const KINDS = ['library', 'fixed'];

/**
 * The built-in stand-in for n8n (routes/testWebhook.js), as this process reaches itself.
 *
 * Returns:
 *   'http://127.0.0.1:<PORT>/api/test-webhook' (config.selfUrl, not APP_URL, which may be a proxy).
 */
export const testEndpointUrl = () => `${config.selfUrl}/api/test-webhook`;

/**
 * Where a platform's posts go. Test mode sends everything to the test URL so nothing reaches
 * the production publish workflow; the Test platform always does.
 *
 * Usage:
 *   const url = webhookUrlFor(platform);   // also GET /api/status with { isTest: false }
 *
 * Takes:
 *   platform - platform row: { isTest, webhookUrl }
 *
 * Returns:
 *   The URL, or null when no webhook is set (the post then fails with a clear error).
 *   In order: Test platform -> built-in test endpoint; TEST_MODE -> TEST_WEBHOOK_URL or the
 *   built-in endpoint; otherwise the platform's own webhook URL (Platforms page), then
 *   WEBHOOK_URL.
 *
 * When editing:
 *   The test-mode checks come first on purpose: a test post must never reach the live workflow.
 */
export function webhookUrlFor(platform) {
  if (platform.isTest) return testEndpointUrl();
  if (config.testMode) return config.webhook.testUrl || testEndpointUrl();
  return platform.webhookUrl || config.webhook.url || null;
}

/**
 * The publish payload the n8n publish workflow expects.
 *
 * Usage:
 *   const payload = buildPayload({ post, platform, media });
 *
 * Takes:
 *   post     - post row with postTypeName (as dispatchDue selects it) and a scheduledAt
 *   platform - platform row: { key, name }
 *   media    - media row, or null
 *
 * Returns:
 *   { postId (text), platform (key), platformName, caption (caption and hashtags joined by a
 *     blank line), media: [{ type 'image', driveFileId, url, mimeType, altText }] or [],
 *     scheduledFor (local time with offset, see time.js offsetIso), kind, postType, color,
 *     createdBy, callbackUrl (APP_URL + /api/posts/:id/status) }
 *
 * When editing:
 *   n8n depends on this shape. Change it only together with the n8n publish workflow, and keep
 *   payloadProblems and the contract in step.
 */
export function buildPayload({ post, platform, media }) {
  return {
    postId: String(post.id),
    platform: platform.key,
    platformName: platform.name,
    caption: [post.caption, post.hashtags].filter(Boolean).join('\n\n'),
    media: media
      ? [{ type: 'image', driveFileId: media.driveFileId ?? null, url: absoluteUrl(media.link), mimeType: media.mimeType, altText: post.altText }]
      : [],
    scheduledFor: offsetIso(new Date(post.scheduledAt), config.timezone),
    kind: post.kind,
    postType: post.postTypeName ?? null,
    color: post.color ?? null,
    createdBy: null, // team login arrives 
    callbackUrl: `${config.appUrl}/api/posts/${post.id}/status`,
  };
}

/**
 * Checks a received payload against the contract. The built-in test endpoint uses it to show
 * what n8n would get wrong.
 *
 * Usage:
 *   const problems = payloadProblems(req.body);   // routes/testWebhook.js
 *
 * Takes:
 *   p - the parsed JSON body (anything)
 *
 * Returns:
 *   A list of plain-language problems; empty when it matches the contract.
 */
export function payloadProblems(p) {
  const problems = [];
  const isString = (v) => typeof v === 'string' && v.length > 0;
  if (!p || typeof p !== 'object') return ['payload is not a JSON object'];
  for (const key of ['postId', 'platform', 'platformName', 'caption', 'scheduledFor', 'callbackUrl']) {
    if (!isString(p[key])) problems.push(`${key} must be a non-empty string`);
  }
  if (isString(p.scheduledFor) && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(p.scheduledFor)) {
    problems.push('scheduledFor must be ISO 8601 with a UTC offset');
  }
  if (!KINDS.includes(p.kind)) problems.push(`kind must be one of ${KINDS.join(', ')}`);
  for (const key of ['postType', 'color']) {
    if (p[key] !== null && !isString(p[key])) problems.push(`${key} must be a non-empty string or null`);
  }
  if (!Array.isArray(p.media)) {
    problems.push('media must be a list');
  } else {
    p.media.forEach((m, i) => {
      if (m?.type !== 'image') problems.push(`media[${i}].type must be "image"`);
      if (!isString(m?.url)) problems.push(`media[${i}].url must be a non-empty string`);
      if (!isString(m?.mimeType)) problems.push(`media[${i}].mimeType must be a non-empty string`);
      if (typeof m?.altText !== 'string') problems.push(`media[${i}].altText must be a string`);
    });
  }
  return problems;
}

/**
 * Sends every queued post whose slot has come.
 *
 * Usage:
 *   await dispatchDue(db);   // the scheduler tick (routes/system.js)
 *
 * Returns:
 *   The number of due posts found.
 *
 * How it works:
 *   Queues dispatchDueNow behind any running sync or pull (lock.js), so a due post can't be
 *   sent twice.
 */
export function dispatchDue(db) {
  return serialized(() => dispatchDueNow(db));
}

/**
 * The send itself (dispatchDue queues it).
 *
 * How it works:
 *   1. Finds queued posts with scheduledAt at or before now, oldest first.
 *   2. For each, claims it (queued -> sending); a post someone else already claimed is skipped.
 *   3. Builds the payload and picks the URL (webhookUrlFor).
 *   4. DRY_RUN: logs it, records a dispatch row with dryRun 1, marks it posted.
 *   5. Otherwise POSTs the JSON and waits at most webhookTimeoutMs (settings.js). Calls to the
 *      built-in test endpoint carry X-Self-Call (config.selfCallSecret): the endpoint knows
 *      this process by that secret, so BASIC_AUTH lets it through (app.js).
 *   6. Records a dispatch row (url, payload, HTTP status, error) and marks the post posted
 *      for any 2xx, or failed with the error (no URL, non-2xx, timeout, network error).
 *
 * When editing:
 *   The claim must come before the send: it is what stops a post going out twice. A failed
 *   post is never retried by itself; someone requeues it from the Library.
 */
async function dispatchDueNow(db) {
  const now = clock.now().toISOString();
  const due = await db.all(`SELECT post.*, postType.name AS postTypeName FROM post LEFT JOIN postType ON postType.id = post.postTypeId
                            WHERE status = 'queued' AND scheduledAt IS NOT NULL AND scheduledAt <= ?
                            ORDER BY scheduledAt`, [now]);
  const claim = (id) => db.run(`UPDATE post SET status = 'sending', updatedAt = datetime('now') WHERE id = ? AND status = 'queued'`, [id]);
  const finish = (...values) => db.run(`UPDATE post SET status = ?, sentAt = ?, lastError = ?, updatedAt = datetime('now') WHERE id = ?`, values);
  const record = (...values) => db.run(`INSERT INTO dispatch (postId, url, payload, dryRun, httpStatus, error, createdAt)
                                        VALUES (?, ?, ?, ?, ?, ?, ?)`, values);

  for (const post of due) {
    // Claimed first, so it can never be sent twice
    if ((await claim(post.id)).changes === 0) continue;
    const platform = await db.get('SELECT * FROM platform WHERE id = ?', [post.platformId]);
    const media = post.mediaId ? await db.get('SELECT * FROM media WHERE id = ?', [post.mediaId]) : null;
    const payload = buildPayload({ post, platform, media });
    const url = webhookUrlFor(platform);

    if (config.dryRun) {
      console.log(`[dry run] would POST to ${url}:`, JSON.stringify(payload));
      await record(post.id, url, JSON.stringify(payload), 1, null, null, now);
      await finish('posted', now, null, post.id);
      continue;
    }

    let httpStatus = null;
    let error = null;
    try {
      if (!url) throw new Error('No publish webhook URL is configured');
      const res = await fetch(url, {
        method: 'POST',
        // The built-in test endpoint knows this process by its secret (app.js)
        headers: { 'Content-Type': 'application/json', ...(url === testEndpointUrl() ? { 'X-Self-Call': config.selfCallSecret } : {}) },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(webhookTimeoutMs),
      });
      httpStatus = res.status;
      if (!res.ok) throw new Error(`Webhook answered HTTP ${res.status}`);
    } catch (err) {
      error = err.cause?.message ? `${err.message}: ${err.cause.message}` : err.message;
    }
    await record(post.id, url, JSON.stringify(payload), 0, httpStatus, error, now);
    await finish(error ? 'failed' : 'posted', now, error, post.id);
  }
  return due.length;
}

/**
 * Marks posts left in 'sending' as failed. One there means the process stopped mid-request;
 * it may or may not have reached n8n, so a person checks it rather than it being sent again.
 *
 * Usage:
 *   await failInterrupted(db);   // index.js, once at startup, before the first tick
 *
 * Returns:
 *   Nothing.
 *
 * When editing:
 *   Never change this to requeue: that could publish a post twice.
 */
export async function failInterrupted(db) {
  await db.run(`UPDATE post SET status = 'failed', lastError = ?, updatedAt = datetime('now') WHERE status = 'sending'`,
    ['The app stopped while sending this post. Check whether it was published before requeueing it.']);
}
