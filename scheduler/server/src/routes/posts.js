/**
 * Post routes (/api/posts): the Library's lists, Compose's create and edit, requeueing a failed
 * post, n8n's status callback, a post's send history, and delete.
 *
 * Two kinds of post: a library post (kind "library", a post type and, on platforms that use
 * colors, Blue or Purple; no date) waits for the next matching empty slot; a Specific Date post
 * (kind "fixed") keeps its fixedAt, a local "YYYY-MM-DDTHH:MM" in the app's time zone.
 * syncPlatform (services/sync.js) places posts in slots and writes the calendar after every change.
 *
 * Permissions (ROUTES in services/permissions.js, which also writes the audit entries):
 * GET needs any signed-in user; POST createPosts; PATCH and requeue editPosts; DELETE deletePosts;
 * the status callback is open to n8n (with N8N_CALLBACK_SECRET when set) and needs editPosts
 * from a signed-in person. PATCH on a scheduled post (isScheduled) also needs editScheduledPosts,
 * checked here.
 */
import { Router } from 'express';
import { config } from '../config.js';
import { clock } from '../services/clock.js';
import { can } from '../services/permissions.js';
import { COLORS } from '../services/projection.js';
import { localDateTimeString, parseLocalDateTime } from '../services/time.js';
import { parsePlatform, removeCalendarEvent, syncPlatform } from '../services/sync.js';
import { SELECT_POST } from '../services/views.js';
import { collisionMs } from '../settings.js';

const STATUSES = ['queued', 'sending', 'posted', 'failed'];
const KINDS = ['library', 'fixed'];
// Fields that decide where a post goes; changing one reschedules it even if its time has come
const PLACEMENT = ['kind', 'postTypeId', 'color', 'fixedAt', 'platformId'];

/**
 * Whether a post counts as scheduled, so editing it needs editScheduledPosts as well as
 * editPosts: others ask a super admin, since all content is preapproved before it gets
 * added.
 *
 * Usage:
 *   if (isScheduled(post) && !(await can(db, req.user, 'editScheduledPosts'))) ...
 *
 * Takes:
 *   post - a SELECT_POST row (needs status, kind and slotId)
 *
 * Returns:
 *   true when it is queued AND placed: in a slot, or a Specific Date post (kind "fixed").
 *   A Library post waiting in the library (no slot) is false, so editPosts is enough for it.
 *
 * When editing:
 *   The Library and Calendar pages hide Edit with the same rule; keep them the same.
 */
export const isScheduled = (post) => post.status === 'queued' && (post.kind === 'fixed' || post.slotId != null);

/**
 * Validates Compose and Library input against the platform, on the post as it will be after
 * the change.
 *
 * Usage:
 *   const updates = await postUpdates(body, platform, post, db);   // [['caption', '...'], ...]
 *
 * Takes:
 *   body     - any of caption, hashtags, altText, mediaId, kind, postTypeId, color, fixedAt
 *   platform - the parsed platform row (parsePlatform) the post will be on
 *   current  - the stored post, or {} for a new one
 *   db       - the open database
 *
 * Returns:
 *   [column, value] pairs for the fields that actually change. Throws a message (a 400) for
 *   anything invalid.
 *
 * How it works:
 *   1. caption is required and trimmed; hashtags and altText are trimmed strings.
 *   2. mediaId must be an image that exists and is not deleted or a history copy. Every post
 *      needs an image (n8n can't publish without one), so it can be swapped but not removed,
 *      and an older post saved without one must get one before any other change is saved.
 *   3. postTypeId must be one of this platform's types; color "Blue", "Purple" or null, and only
 *      on platforms that use colors. A type or color that no longer applies (e.g. after a move to
 *      another platform) is cleared.
 *   4. A library post needs a post type that is in the rotation (Holiday is Specific Date only),
 *      a color where the platform uses them, and no date (fixedAt is cleared).
 *      A Specific Date post needs fixedAt, and a new or changed date must be in the future.
 *      On platforms that use colors, a Holiday (non-rotation type) post needs a color too
 *      (Specific Date colors shift the Blue/Purple order of later slots).
 *   5. Caption plus hashtags (joined by two characters) must fit the platform's charLimit.
 *
 * When editing:
 *   The error texts are shown to users as they are.
 */
async function postUpdates(body, platform, current, db) {
  const updates = new Map();
  if ('caption' in body) {
    if (typeof body.caption !== 'string' || !body.caption.trim()) throw 'caption is required';
    updates.set('caption', body.caption.trim());
  }
  for (const field of ['hashtags', 'altText']) {
    if (field in body) {
      if (typeof body[field] !== 'string') throw `${field} must be a string`;
      updates.set(field, body[field].trim());
    }
  }
  if ('mediaId' in body) {
    if (body.mediaId === null || body.mediaId === undefined) throw 'An image is required';
    const media = await db.get('SELECT deletedAt, archivedAt FROM media WHERE id = ?', [body.mediaId]);
    if (!media) throw 'mediaId does not exist';
    // An image in Recently deleted (or purged to its history copy) can't go on a post
    if (media.deletedAt || media.archivedAt) throw 'That image was deleted; choose another';
    updates.set('mediaId', body.mediaId);
  } else if (current?.id && !current.mediaId) {
    throw 'An image is required';
  }
  if ('kind' in body) {
    if (!KINDS.includes(body.kind)) throw 'kind must be "library" or "fixed"';
    updates.set('kind', body.kind);
  }

  const ownType = (id) => db.get('SELECT 1 FROM postType WHERE id = ? AND platformId = ?', [id, platform.id]);
  if ('postTypeId' in body) {
    if (body.postTypeId !== null && !(await ownType(body.postTypeId))) throw `postTypeId must be one of ${platform.name}'s post types`;
    updates.set('postTypeId', body.postTypeId);
  }
  if ('color' in body) {
    if (body.color !== null && !COLORS.includes(body.color)) throw 'color must be "Blue", "Purple" or null';
    if (body.color !== null && !platform.usesColors) throw `${platform.name} does not use colors; leave color empty`;
    updates.set('color', body.color);
  }
  if ('fixedAt' in body && body.fixedAt !== null && !parseLocalDateTime(body.fixedAt, config.timezone)) {
    throw 'fixedAt must be a local date and time, "YYYY-MM-DDTHH:MM"';
  }
  const after = (field) => (updates.has(field) ? updates.get(field) : current[field] ?? null);
  if (after('postTypeId') !== null && !(await ownType(after('postTypeId')))) updates.set('postTypeId', null);
  if (after('color') !== null && !platform.usesColors) updates.set('color', null);
  if (after('kind') === 'library') {
    if (body.fixedAt) throw 'A library post has no date; use kind "fixed" for a specific date';
    if (after('postTypeId') === null) throw `postTypeId is required: pick one of ${platform.name}'s post types`;
    if (platform.usesColors && after('color') === null) throw 'color is required ("Blue" or "Purple")';
    if (!(await db.get('SELECT inRotation FROM postType WHERE id = ?', [after('postTypeId')])).inRotation) {
      throw 'This post type is only for Specific Date posts; choose a date and time';
    }
    if (after('fixedAt') !== null) updates.set('fixedAt', null);
  } else {
    if ('fixedAt' in body) updates.set('fixedAt', body.fixedAt);
    const fixedAt = after('fixedAt');
    if (!fixedAt) throw 'fixedAt is required for a Specific Date post';
    if ((updates.has('fixedAt') || updates.has('kind')) && parseLocalDateTime(fixedAt, config.timezone) <= clock.now()) {
      throw `${fixedAt.replace('T', ' ')} has already passed`;
    }
    // A Holiday (date-only type) post shifts the Blue/Purple order, so it needs a color.
    // Checked on create and when its date, kind, type or color changes, so older posts stay editable.
    const placing = !current.id || ['fixedAt', 'kind', 'postTypeId', 'color'].some((f) => updates.has(f));
    if (placing && platform.usesColors && after('postTypeId') !== null && after('color') === null
      && !(await db.get('SELECT inRotation FROM postType WHERE id = ?', [after('postTypeId')]))?.inRotation) {
      throw `A Holiday post on ${platform.name} needs a color ("Blue" or "Purple") so the colors keep alternating`;
    }
  }

  const caption = updates.get('caption') ?? current.caption ?? '';
  const hashtags = updates.get('hashtags') ?? current.hashtags ?? '';
  const length = caption.length + (hashtags ? hashtags.length + 2 : 0);
  if (platform.charLimit && length > platform.charLimit) {
    throw `Caption and hashtags are ${length} characters; ${platform.name} allows ${platform.charLimit}`;
  }
  return [...updates].filter(([field, value]) => current[field] !== value);
}

/**
 * The /api/posts router.
 *
 * Usage:
 *   app.use('/api/posts', postsRouter(db));   (app.js)
 *
 * Takes:
 *   db - the open database
 *
 * Returns:
 *   An Express router with the routes below. Posts come back as SELECT_POST rows
 *   (services/views.js: the post plus its image's link and name, and more).
 */
export function postsRouter(db) {
  const router = Router();
  const postById = (id) => db.get(`${SELECT_POST} WHERE post.id = ?`, [id]);
  const platformById = (id) => db.get('SELECT * FROM platform WHERE id = ?', [id]);
  const freeSlotOf = (postId) => db.run('UPDATE slot SET postId = NULL, pinned = 0 WHERE postId = ?', [postId]);

  // Platforms that can take new posts right now: enabled, and the Test platform only in test mode
  const usablePlatform = async (id) => {
    const row = await platformById(id);
    return row && row.enabled && (config.testMode || !row.isTest) ? parsePlatform(row) : null;
  };
  // Writes [column, value] pairs to the post and stamps updatedAt; nothing to write is a no-op
  const update = async (id, updates) => {
    if (updates.length === 0) return;
    await db.run(`UPDATE post SET ${updates.map(([col]) => `${col} = ?`).join(', ')}, updatedAt = datetime('now') WHERE id = ?`,
      [...updates.map(([, value]) => value), id]);
  };

  /**
   * Checks a Specific Date post's time against the platform's other Specific Date posts.
   *
   * Usage:
   *   const clash = await collision(platform.id, '2026-12-01T10:00', post.id);
   *   if (clash) return res.status(409).json(clash);
   *
   * Takes:
   *   platformId - the platform
   *   fixedAt    - the local "YYYY-MM-DDTHH:MM" to check
   *   exceptId   - the post's own id when editing (left out for a new post)
   *
   * Returns:
   *   null when no other fixed post (failed ones aside) is within collisionMs, otherwise
   *   { error, conflict (the nearest such post), suggestedAt (local "YYYY-MM-DDTHH:MM"),
   *     windowHours (collisionMs in hours, so the page words it without its own copy) }.
   *
   * How it works:
   *   suggestedAt starts collisionMs after the nearest clash and moves on past every fixed post
   *   it would clash with, until it clears them all.
   *
   * When editing:
   *   The window is collisionMs in settings.js; the error's "2 hours" is built from it.
   *   Compose shows the error and suggestedAt and can resend with force: true.
   */
  const collision = async (platformId, fixedAt, exceptId) => {
    const others = await db.all(`${SELECT_POST} WHERE post.platformId = ? AND post.kind = 'fixed' AND post.status != 'failed' AND post.id != ?`,
      [platformId, exceptId ?? 0]);
    const at = (p) => parseLocalDateTime(p.fixedAt, config.timezone).getTime();
    const near = (t) => others.filter((p) => Math.abs(at(p) - t) < collisionMs).sort((a, b) => at(a) - at(b));
    const t = parseLocalDateTime(fixedAt, config.timezone).getTime();
    const hits = near(t).sort((a, b) => Math.abs(at(a) - t) - Math.abs(at(b) - t));
    if (hits.length === 0) return null;
    let suggested = at(hits[0]) + collisionMs;
    for (let clash = near(suggested); clash.length; clash = near(suggested)) suggested = at(clash.at(-1)) + collisionMs;
    const hours = collisionMs / 3_600_000;
    return {
      error: `Another ${(await platformById(platformId)).name} post is fixed at ${hits[0].fixedAt.replace('T', ' ')}, within ${hours} hour${hours === 1 ? '' : 's'}`,
      conflict: hits[0],
      suggestedAt: localDateTimeString(new Date(suggested), config.timezone),
      windowHours: hours,
    };
  };

  /**
   * GET /api/posts: posts for the Library's lists. Any signed-in user.
   *
   * Usage:
   *   GET /api/posts?status=queued,failed&platformId=2&kind=library&placed=false
   *
   * Takes:
   *   status     - one or more of queued, sending, posted, failed, comma-separated (default queued)
   *   platformId - optional, one platform
   *   kind       - optional, "library" or "fixed"
   *   placed     - optional "true" (in a slot, or fixed: a fixed post always has its date) or
   *                "false" (a library post not in a slot)
   *
   * Returns:
   *   200 [post] ordered by platform, then scheduled time (unplaced last), then created;
   *   400 for a bad status, kind or placed.
   *
   * When editing:
   *   Archived posts (the Archive page) are left out of these lists.
   */
  router.get('/', async (req, res) => {
    const { platformId, kind, placed, status = 'queued' } = req.query;
    const statuses = status.split(',');
    if (!statuses.every((s) => STATUSES.includes(s))) {
      return res.status(400).json({ error: `status must be one or more of ${STATUSES.join(', ')}` });
    }
    if (kind && !KINDS.includes(kind)) return res.status(400).json({ error: 'kind must be "library" or "fixed"' });
    if (placed && placed !== 'true' && placed !== 'false') return res.status(400).json({ error: 'placed must be true or false' });
    const placedSql = { true: "AND (slot.id IS NOT NULL OR post.kind = 'fixed')", false: "AND slot.id IS NULL AND post.kind = 'library'" };
    const sql = `${SELECT_POST} WHERE post.status IN (${statuses.map(() => '?').join(', ')})
                 AND post.archivedAt IS NULL
                 ${platformId ? 'AND post.platformId = ?' : ''}
                 ${kind ? 'AND post.kind = ?' : ''}
                 ${placed ? placedSql[placed] : ''}
                 ORDER BY post.platformId, post.scheduledAt IS NULL, post.scheduledAt, post.createdAt, post.id`;
    res.json(await db.all(sql, [...statuses, ...(platformId ? [platformId] : []), ...(kind ? [kind] : [])]));
  });

  /**
   * POST /api/posts: Compose's submit. A library post waits for a matching slot; a Specific
   * Date post keeps its date. Needs createPosts.
   *
   * Usage:
   *   POST /api/posts  { platformId: 2, caption: "...", mediaId: 7, kind: "library", postTypeId: 4, color: "Blue" }
   *   POST /api/posts  { platformId: 2, caption: "...", mediaId: 7, kind: "fixed", fixedAt: "2026-12-24T10:00" }
   *
   * Takes:
   *   body - platformId (an enabled platform), mediaId (required), kind (default "library"),
   *          the fields postUpdates checks, and force: true to save despite a time clash
   *
   * Returns:
   *   201 with the new post (placed by syncPlatform); 400 with a message for invalid input;
   *   409 { error, conflict, suggestedAt } when a Specific Date post is too close to another.
   */
  router.post('/', async (req, res) => {
    const body = { caption: undefined, kind: 'library', ...req.body };
    const platform = await usablePlatform(body.platformId);
    if (!platform) return res.status(400).json({ error: 'platformId must be an enabled platform' });
    if (body.mediaId === null || body.mediaId === undefined) return res.status(400).json({ error: 'An image is required' });
    let updates;
    try {
      updates = await postUpdates(body, platform, {}, db);
    } catch (message) {
      return res.status(400).json({ error: message });
    }
    const fields = new Map(updates);
    if (fields.get('kind') === 'fixed' && body.force !== true) {
      const clash = await collision(platform.id, fields.get('fixedAt'));
      if (clash) return res.status(409).json(clash);
    }
    const cols = ['platformId', ...updates.map(([col]) => col)];
    const { lastInsertRowid } = await db.run(`INSERT INTO post (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      [platform.id, ...updates.map(([, value]) => value)]);

    await syncPlatform(db, platform.id);
    res.status(201).json(await postById(lastInsertRowid));
  });

  /**
   * PATCH /api/posts/:id: edits a waiting post's fields, switches its kind, or moves it to
   * another platform. Needs editPosts, and editScheduledPosts too when the post is scheduled
   * (isScheduled: in a slot, or a Specific Date post).
   *
   * Usage:
   *   PATCH /api/posts/12  { caption: "New text" }
   *   PATCH /api/posts/12  { platformId: 3 }
   *
   * Takes:
   *   body - the fields postUpdates checks, platformId to move, force: true to save despite a
   *          time clash
   *
   * Returns:
   *   200 with the post; 404 unknown; 403 { error, permission } for a scheduled post without
   *   editScheduledPosts ("Ask a super admin to change a scheduled post"); 409 when it is no
   *   longer queued, or a time clash
   *   ({ error, conflict, suggestedAt }); 400 with a message for invalid input or an unusable
   *   platform.
   *
   * How it works:
   *   1. Validates against the platform it will be on.
   *   2. A move removes the old calendar event first (its color and summary belong to the old
   *      platform) and forgets the event id, hash and etag.
   *   3. A change of kind or platform takes the post out of its slot; a type or color that no
   *      longer fits is freed by syncPlatform. A change to a PLACEMENT field clears scheduledAt,
   *      so the post is placed again even if its time has come.
   *   4. Saves, then syncs the platform (and the old one after a move).
   */
  router.patch('/:id', async (req, res) => {
    const post = await postById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.status !== 'queued') return res.status(409).json({ error: `Post is ${post.status} and can no longer be edited` });
    // Second permission check: ROUTES only checked editPosts
    if (isScheduled(post) && !(await can(db, req.user, 'editScheduledPosts'))) {
      return res.status(403).json({ error: 'Ask a super admin to change a scheduled post', permission: 'editScheduledPosts' });
    }
    const body = req.body ?? {};
    const moving = 'platformId' in body && body.platformId !== post.platformId;
    const platform = moving ? await usablePlatform(body.platformId) : parsePlatform(await platformById(post.platformId));
    if (!platform) return res.status(400).json({ error: 'platformId must be an enabled platform' });
    let updates;
    try {
      updates = await postUpdates(body, platform, post, db);
    } catch (message) {
      return res.status(400).json({ error: message });
    }
    if (moving) updates.push(['platformId', platform.id]);
    const changed = new Set(updates.map(([col]) => col));
    const kind = changed.has('kind') ? body.kind : post.kind;
    const fixedAt = new Map(updates).get('fixedAt') ?? post.fixedAt;
    if (kind === 'fixed' && (changed.has('fixedAt') || changed.has('kind') || moving) && body.force !== true) {
      const clash = await collision(platform.id, fixedAt, post.id);
      if (clash) return res.status(409).json(clash);
    }
    if (moving) {
      await removeCalendarEvent(post);
      updates.push(['calendarEventId', null], ['calendarEventHash', null], ['calendarEventEtag', null]);
    }
    if (updates.length > 0) {
      if (changed.has('kind') || moving) await freeSlotOf(post.id);
      if (PLACEMENT.some((f) => changed.has(f))) updates.push(['scheduledAt', null]);
      await update(post.id, updates);
      await syncPlatform(db, platform.id);
      if (moving) await syncPlatform(db, post.platformId);
    }
    res.json(await postById(post.id));
  });

  /**
   * POST /api/posts/:id/requeue: puts a failed post back in line. A failed library post goes
   * back to the library; a failed Specific Date post needs a new date and time. Needs editPosts.
   *
   * Usage:
   *   POST /api/posts/12/requeue                                  (library post)
   *   POST /api/posts/12/requeue  { fixedAt: "2026-12-02T10:00" } (Specific Date post)
   *
   * Takes:
   *   body.fixedAt - required for a Specific Date post, a future local "YYYY-MM-DDTHH:MM"
   *   body.force   - true to requeue despite a time clash
   *
   * Returns:
   *   200 with the post (queued again, lastError cleared); 404 when it is not a failed post;
   *   400 for a missing or past fixedAt; 409 { error, conflict, suggestedAt } for a time clash.
   *
   * When editing:
   *   The slot it missed stays empty; the post waits for the next matching one.
   */
  router.post('/:id/requeue', async (req, res) => {
    const post = await postById(req.params.id);
    if (!post || post.status !== 'failed') return res.status(404).json({ error: 'Failed post not found' });
    const { fixedAt, force } = req.body ?? {};
    const updates = [['status', 'queued'], ['lastError', null], ['scheduledAt', null]];

    if (post.kind === 'fixed') {
      const at = parseLocalDateTime(fixedAt, config.timezone);
      if (!at) return res.status(400).json({ error: 'fixedAt ("YYYY-MM-DDTHH:MM") is required to requeue a Specific Date post' });
      if (at <= clock.now()) return res.status(400).json({ error: `${fixedAt.replace('T', ' ')} has already passed` });
      if (force !== true) {
        const clash = await collision(post.platformId, fixedAt, post.id);
        if (clash) return res.status(409).json(clash);
      }
      updates.push(['fixedAt', fixedAt]);
    }
    await freeSlotOf(post.id);
    await update(post.id, updates);
    await syncPlatform(db, post.platformId);
    res.json(await postById(post.id));
  });

  /**
   * POST /api/posts/:id/status: n8n's status callback after it publishes (or fails to).
   * Open to n8n without a session (it must send X-Callback-Secret when N8N_CALLBACK_SECRET is
   * set, checked in services/access.js); a signed-in person needs editPosts.
   *
   * Usage:
   *   POST /api/posts/12/status  { status: "posted", platformPostId: "1789..." }
   *   POST /api/posts/12/status  { status: "failed", error: "Token expired" }
   *
   * Takes:
   *   body.status         - "posted" or "failed"
   *   body.platformPostId - optional, the platform's id for the published post
   *   body.error          - optional, why it failed (default "n8n reported a failure")
   *
   * Returns:
   *   200 with the post; 404 unknown; 400 for a bad status; 409 when the post was never sent
   *   (only sending, posted or failed posts take a callback).
   */
  router.post('/:id/status', async (req, res) => {
    const post = await postById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const { status, platformPostId = null, error = null } = req.body ?? {};
    if (status !== 'posted' && status !== 'failed') return res.status(400).json({ error: 'status must be "posted" or "failed"' });
    if (!['sending', 'posted', 'failed'].includes(post.status)) {
      return res.status(409).json({ error: `Post is ${post.status}; only sent posts take a status callback` });
    }
    await update(post.id, [['status', status], ['platformPostId', platformPostId],
      ['lastError', status === 'failed' ? (error ?? 'n8n reported a failure') : null]]);
    res.json(await postById(post.id));
  });

  /**
   * GET /api/posts/:id/dispatches: one post's send history, newest first. Any signed-in user.
   *
   * Usage:
   *   GET /api/posts/12/dispatches
   *
   * Returns:
   *   200 [{ ...dispatch row, dryRun (boolean), payload (parsed JSON) }]; [] for an unknown post.
   */
  router.get('/:id/dispatches', async (req, res) => {
    res.json((await db.all('SELECT * FROM dispatch WHERE postId = ? ORDER BY id DESC', [req.params.id]))
      .map((d) => ({ ...d, dryRun: Boolean(d.dryRun), payload: JSON.parse(d.payload) })));
  });

  /**
   * DELETE /api/posts/:id: deletes a post and its calendar event. Needs deletePosts.
   *
   * Usage:
   *   DELETE /api/posts/12
   *
   * Returns:
   *   204; 404 unknown; 409 while it is being sent; 502 when the calendar event could not be
   *   removed (the post is kept).
   *
   * How it works:
   *   Removes the calendar event first, then the row. Its slot empties (ON DELETE SET NULL) and
   *   refills from the library on the sync that follows.
   */
  router.delete('/:id', async (req, res) => {
    const post = await postById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.status === 'sending') return res.status(409).json({ error: 'Post is being sent right now' });
    // If the event can't be removed, keep the post so the calendar and app don't disagree
    try {
      await removeCalendarEvent(post);
    } catch (err) {
      return res.status(502).json({ error: `Could not remove the calendar event: ${err.message}` });
    }
    await db.run('DELETE FROM post WHERE id = ?', [post.id]);
    await syncPlatform(db, post.platformId);
    res.status(204).end();
  });
  return router;
}
