import { Router } from 'express';
import { config } from '../config.js';
import { clock } from '../services/clock.js';
import { COLORS } from '../services/projection.js';
import { localDateTimeString, parseLocalDateTime } from '../services/time.js';
import { parsePlatform, removeCalendarEvent, syncPlatform } from '../services/sync.js';
import { SELECT_POST } from '../services/views.js';

const STATUSES = ['queued', 'sending', 'posted', 'failed'];
const KINDS = ['library', 'fixed'];
// Fixed posts on one platform must be at least this far apart unless forced
const COLLISION_MS = 120 * 60_000;
// Fields that decide where a post goes; changing one reschedules it even if its time has come
const PLACEMENT = ['kind', 'postTypeId', 'color', 'fixedAt', 'platformId'];

/**
 * Validates composer/library input against the platform, on the post as it
 * will be after the change. Library posts need a post type (and a color when
 * the platform uses colors); fixed posts need fixedAt, a local "YYYY-MM-DDTHH:MM".
 * Returns [column, value] pairs for the fields that change, or throws a message.
 */
function postUpdates(body, platform, current, db) {
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
    if (body.mediaId !== null && !db.prepare('SELECT 1 FROM media WHERE id = ?').get(body.mediaId)) throw 'mediaId does not exist';
    updates.set('mediaId', body.mediaId);
  }
  if ('kind' in body) {
    if (!KINDS.includes(body.kind)) throw 'kind must be "library" or "fixed"';
    updates.set('kind', body.kind);
  }

  const ownType = (id) => db.prepare('SELECT 1 FROM postType WHERE id = ? AND platformId = ?').get(id, platform.id);
  if ('postTypeId' in body) {
    if (body.postTypeId !== null && !ownType(body.postTypeId)) throw `postTypeId must be one of ${platform.name}'s post types`;
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
  if (after('postTypeId') !== null && !ownType(after('postTypeId'))) updates.set('postTypeId', null);
  if (after('color') !== null && !platform.usesColors) updates.set('color', null);
  if (after('kind') === 'library') {
    if (body.fixedAt) throw 'A library post has no date; use kind "fixed" for a specific date';
    if (after('postTypeId') === null) throw `postTypeId is required: pick one of ${platform.name}'s post types`;
    if (platform.usesColors && after('color') === null) throw 'color is required ("Blue" or "Purple")';
    if (!db.prepare('SELECT inRotation FROM postType WHERE id = ?').get(after('postTypeId')).inRotation) {
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
  }

  const caption = updates.get('caption') ?? current.caption ?? '';
  const hashtags = updates.get('hashtags') ?? current.hashtags ?? '';
  const length = caption.length + (hashtags ? hashtags.length + 2 : 0);
  if (platform.charLimit && length > platform.charLimit) {
    throw `Caption and hashtags are ${length} characters; ${platform.name} allows ${platform.charLimit}`;
  }
  // Only what actually changes
  return [...updates].filter(([field, value]) => current[field] !== value);
}

export function postsRouter(db) {
  const router = Router();
  const postById = db.prepare(`${SELECT_POST} WHERE post.id = ?`);
  const platformById = db.prepare('SELECT * FROM platform WHERE id = ?');
  const freeSlotOf = db.prepare('UPDATE slot SET postId = NULL, pinned = 0 WHERE postId = ?');

  // Platforms that can take new posts right now
  const usablePlatform = (id) => {
    const row = platformById.get(id);
    return row && row.enabled && (config.testMode || !row.isTest) ? parsePlatform(row) : null;
  };
  const update = (id, updates) => {
    if (updates.length === 0) return;
    db.prepare(`UPDATE post SET ${updates.map(([col]) => `${col} = ?`).join(', ')}, updatedAt = datetime('now') WHERE id = ?`)
      .run(...updates.map(([, value]) => value), id);
  };
  /**
   * The nearest other fixed post on the platform within two hours of fixedAt,
   * and the first time from two hours after it that clears every fixed post.
   */
  const collision = (platformId, fixedAt, exceptId) => {
    const others = db.prepare(`${SELECT_POST} WHERE post.platformId = ? AND post.kind = 'fixed' AND post.status != 'failed' AND post.id != ?`)
      .all(platformId, exceptId ?? 0);
    const at = (p) => parseLocalDateTime(p.fixedAt, config.timezone).getTime();
    const near = (t) => others.filter((p) => Math.abs(at(p) - t) < COLLISION_MS).sort((a, b) => at(a) - at(b));
    const t = parseLocalDateTime(fixedAt, config.timezone).getTime();
    const hits = near(t).sort((a, b) => Math.abs(at(a) - t) - Math.abs(at(b) - t));
    if (hits.length === 0) return null;
    let suggested = at(hits[0]) + COLLISION_MS;
    for (let clash = near(suggested); clash.length; clash = near(suggested)) suggested = at(clash.at(-1)) + COLLISION_MS;
    return {
      error: `Another ${platformById.get(platformId).name} post is fixed at ${hits[0].fixedAt.replace('T', ' ')}, within 2 hours`,
      conflict: hits[0],
      suggestedAt: localDateTimeString(new Date(suggested), config.timezone),
    };
  };

  // ?status=queued,failed takes several; ordered by scheduled time within each platform, unplaced last
  router.get('/', (req, res) => {
    const { platformId, kind, placed, status = 'queued' } = req.query;
    const statuses = status.split(',');
    if (!statuses.every((s) => STATUSES.includes(s))) {
      return res.status(400).json({ error: `status must be one or more of ${STATUSES.join(', ')}` });
    }
    if (kind && !KINDS.includes(kind)) return res.status(400).json({ error: 'kind must be "library" or "fixed"' });
    if (placed && placed !== 'true' && placed !== 'false') return res.status(400).json({ error: 'placed must be true or false' });
    // Placed = in a slot, or fixed (a fixed post always has its date)
    const placedSql = { true: "AND (slot.id IS NOT NULL OR post.kind = 'fixed')", false: "AND slot.id IS NULL AND post.kind = 'library'" };
    const sql = `${SELECT_POST} WHERE post.status IN (${statuses.map(() => '?').join(', ')})
                 ${platformId ? 'AND post.platformId = ?' : ''}
                 ${kind ? 'AND post.kind = ?' : ''}
                 ${placed ? placedSql[placed] : ''}
                 ORDER BY post.platformId, post.scheduledAt IS NULL, post.scheduledAt, post.createdAt, post.id`;
    res.json(db.prepare(sql).all(...statuses, ...(platformId ? [platformId] : []), ...(kind ? [kind] : [])));
  });
  // Composer submit: a library post waits for a matching slot, a fixed post keeps its date
  router.post('/', async (req, res) => {
    const body = { caption: undefined, kind: 'library', ...req.body };
    const platform = usablePlatform(body.platformId);
    if (!platform) return res.status(400).json({ error: 'platformId must be an enabled platform' });
    let updates;
    try {
      updates = postUpdates(body, platform, {}, db);
    } catch (message) {
      return res.status(400).json({ error: message });
    }
    const fields = new Map(updates);
    if (fields.get('kind') === 'fixed' && body.force !== true) {
      const clash = collision(platform.id, fields.get('fixedAt'));
      if (clash) return res.status(409).json(clash);
    }
    const cols = ['platformId', ...updates.map(([col]) => col)];
    const { lastInsertRowid } = db.prepare(`INSERT INTO post (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(platform.id, ...updates.map(([, value]) => value));

    await syncPlatform(db, platform.id);
    res.status(201).json(postById.get(lastInsertRowid));
  });
  // Edit fields, switch kind, or move to another platform
  router.patch('/:id', async (req, res) => {
    const post = postById.get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.status !== 'queued') return res.status(409).json({ error: `Post is ${post.status} and can no longer be edited` });
    const body = req.body ?? {};
    const moving = 'platformId' in body && body.platformId !== post.platformId;
    const platform = moving ? usablePlatform(body.platformId) : parsePlatform(platformById.get(post.platformId));
    if (!platform) return res.status(400).json({ error: 'platformId must be an enabled platform' });
    let updates;
    try {
      updates = postUpdates(body, platform, post, db);
    } catch (message) {
      return res.status(400).json({ error: message });
    }
    if (moving) updates.push(['platformId', platform.id]);
    const changed = new Set(updates.map(([col]) => col));
    const kind = changed.has('kind') ? body.kind : post.kind;
    const fixedAt = new Map(updates).get('fixedAt') ?? post.fixedAt;
    if (kind === 'fixed' && (changed.has('fixedAt') || changed.has('kind') || moving) && body.force !== true) {
      const clash = collision(platform.id, fixedAt, post.id);
      if (clash) return res.status(409).json(clash);
    }
    if (moving) {
      // The old event's color and summary belong to the old platform
      await removeCalendarEvent(post);
      updates.push(['calendarEventId', null], ['calendarEventHash', null], ['calendarEventEtag', null]);
    }
    if (updates.length > 0) {
      // A post that changes kind or platform leaves its slot; type/color mismatches are freed by sync
      if (changed.has('kind') || moving) freeSlotOf.run(post.id);
      if (PLACEMENT.some((f) => changed.has(f))) updates.push(['scheduledAt', null]);
      update(post.id, updates);
      await syncPlatform(db, platform.id);
      if (moving) await syncPlatform(db, post.platformId);
    }
    res.json(postById.get(post.id));
  });
  // A failed library post goes back to the library; a failed fixed post needs a new date and time
  router.post('/:id/requeue', async (req, res) => {
    const post = postById.get(req.params.id);
    if (!post || post.status !== 'failed') return res.status(404).json({ error: 'Failed post not found' });
    const { fixedAt, force } = req.body ?? {};
    const updates = [['status', 'queued'], ['lastError', null], ['scheduledAt', null]];

    if (post.kind === 'fixed') {
      const at = parseLocalDateTime(fixedAt, config.timezone);
      if (!at) return res.status(400).json({ error: 'fixedAt ("YYYY-MM-DDTHH:MM") is required to requeue a Specific Date post' });
      if (at <= clock.now()) return res.status(400).json({ error: `${fixedAt.replace('T', ' ')} has already passed` });
      if (force !== true) {
        const clash = collision(post.platformId, fixedAt, post.id);
        if (clash) return res.status(409).json(clash);
      }
      updates.push(['fixedAt', fixedAt]);
    }
    // The slot it missed stays empty; the post waits for the next matching one
    freeSlotOf.run(post.id);
    update(post.id, updates);
    await syncPlatform(db, post.platformId);
    res.json(postById.get(post.id));
  });

  // Status callback from n8n after it publishes (or fails to)
  router.post('/:id/status', (req, res) => {
    const post = postById.get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const { status, platformPostId = null, error = null } = req.body ?? {};
    if (status !== 'posted' && status !== 'failed') return res.status(400).json({ error: 'status must be "posted" or "failed"' });
    if (!['sending', 'posted', 'failed'].includes(post.status)) {
      return res.status(409).json({ error: `Post is ${post.status}; only sent posts take a status callback` });
    }
    update(post.id, [['status', status], ['platformPostId', platformPostId],
      ['lastError', status === 'failed' ? (error ?? 'n8n reported a failure') : null]]);
    res.json(postById.get(post.id));
  });
  // Send history for one post
  router.get('/:id/dispatches', (req, res) => {
    res.json(db.prepare('SELECT * FROM dispatch WHERE postId = ? ORDER BY id DESC').all(req.params.id)
      .map((d) => ({ ...d, dryRun: Boolean(d.dryRun), payload: JSON.parse(d.payload) })));
  });
  router.delete('/:id', async (req, res) => {
    const post = postById.get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.status === 'sending') return res.status(409).json({ error: 'Post is being sent right now' });
    // If the event can't be removed, keep the post so the calendar and app don't disagree
    try {
      await removeCalendarEvent(post);
    } catch (err) {
      return res.status(502).json({ error: `Could not remove the calendar event: ${err.message}` });
    }
    // Its slot empties (ON DELETE SET NULL) and refills from the library
    db.prepare('DELETE FROM post WHERE id = ?').run(post.id);
    await syncPlatform(db, post.platformId);
    res.status(204).end();
  });
  return router;
}