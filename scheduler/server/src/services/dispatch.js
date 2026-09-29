// Dispatcher: when a post's slot comes, POST the publish payload to n8n.
// The app never talks to a social platform; n8n publishes and may report back
// through the status callback (POST /api/posts/:id/status).
import { absoluteUrl, config } from '../config.js';
import { clock } from './clock.js';
import { serialized } from './lock.js';
import { offsetIso } from './time.js';

const TIMEOUT_MS = 10_000;
const PRIORITIES = ['standard', 'high', 'next'];

export const testEndpointUrl = () => `${config.selfUrl}/api/test-webhook`;

/**
 * Where a platform's posts go. Test mode sends everything to the test URL so
 * nothing reaches the client's publish workflow; the Test platform always does.
 */
export function webhookUrlFor(platform) {
  if (platform.isTest) return testEndpointUrl();
  if (config.testMode) return config.webhook.testUrl || testEndpointUrl();
  return platform.webhookUrl || config.webhook.url || null;
}

/** Publish payload agreed with the client (sprint plan, section 3). */
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
    priority: PRIORITIES[post.priority],
    createdBy: null, // team login arrives in Sprint 6
    callbackUrl: `${config.appUrl}/api/posts/${post.id}/status`,
  };
}

/** Problems with a received payload's shape; empty when it matches the contract. */
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
  if (!PRIORITIES.includes(p.priority)) problems.push(`priority must be one of ${PRIORITIES.join(', ')}`);
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

/** Sends every queued post whose slot has come. Returns the number handled. */
export function dispatchDue(db) {
  return serialized(() => dispatchDueNow(db));
}

async function dispatchDueNow(db) {
  const now = clock.now().toISOString();
  const due = db.prepare(`SELECT * FROM post WHERE status = 'queued' AND scheduledAt IS NOT NULL AND scheduledAt <= ?
                          ORDER BY scheduledAt`).all(now);
  const platformById = db.prepare('SELECT * FROM platform WHERE id = ?');
  const mediaById = db.prepare('SELECT * FROM media WHERE id = ?');
  const claim = db.prepare(`UPDATE post SET status = 'sending', updatedAt = datetime('now') WHERE id = ? AND status = 'queued'`);
  const finish = db.prepare(`UPDATE post SET status = ?, sentAt = ?, lastError = ?, updatedAt = datetime('now') WHERE id = ?`);
  const record = db.prepare(`INSERT INTO dispatch (postId, url, payload, dryRun, httpStatus, error, createdAt)
                             VALUES (?, ?, ?, ?, ?, ?, ?)`);

  for (const post of due) {
    if (claim.run(post.id).changes === 0) continue;
    const platform = platformById.get(post.platformId);
    const media = post.mediaId ? mediaById.get(post.mediaId) : null;
    const payload = buildPayload({ post, platform, media });
    const url = webhookUrlFor(platform);

    if (config.dryRun) {
      console.log(`[dry run] would POST to ${url}:`, JSON.stringify(payload));
      record.run(post.id, url, JSON.stringify(payload), 1, null, null, now);
      finish.run('posted', now, null, post.id);
      continue;
    }

    let httpStatus = null;
    let error = null;
    try {
      if (!url) throw new Error('No publish webhook URL is configured');
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      httpStatus = res.status;
      if (!res.ok) throw new Error(`Webhook answered HTTP ${res.status}`);
    } catch (err) {
      error = err.cause?.message ? `${err.message}: ${err.cause.message}` : err.message;
    }
    record.run(post.id, url, JSON.stringify(payload), 0, httpStatus, error, now);
    finish.run(error ? 'failed' : 'posted', now, error, post.id);
  }
  return due.length;
}

/**
 * A post left in 'sending' means the process stopped mid-request. It may or
 * may not have reached n8n, so it is marked failed for a person to check
 * rather than sent again.
 */
export function failInterrupted(db) {
  db.prepare(`UPDATE post SET status = 'failed', lastError = ?, updatedAt = datetime('now') WHERE status = 'sending'`)
    .run('The app stopped while sending this post. Check whether it was published before requeueing it.');
}
