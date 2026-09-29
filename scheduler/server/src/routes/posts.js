import { Router } from 'express';
import { config } from '../config.js';
import { clock } from '../services/clock.js';
import { defaultTime } from '../services/projection.js';
import { atLocalTime, nextDateString, parseDateString } from '../services/time.js';
import { parsePlatform, removeCalendarEvent, syncPlatform } from '../services/sync.js';

const STATUSES = ['queued', 'library', 'sending', 'posted', 'failed'];
const HIGH = 1;
const NEXT = 2;

// Posts come back with their image's link and name so pages don't need a second request
const SELECT_POST = `SELECT post.*, media.link AS mediaLink, media.name AS mediaName
                     FROM post LEFT JOIN media ON media.id = post.mediaId`;

/**
 * Validates composer/queue input against the platform. overrideDate is a local
 * "YYYY-MM-DD" (the time always comes from the platform) or null.
 * Returns [column, value] pairs for the fields present, or throws a message.
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
  if ('priority' in body) {
    if (![0, HIGH, NEXT].includes(body.priority)) throw 'priority must be 0 (standard), 1 (high) or 2 (next)';
    updates.set('priority', body.priority);
  }

  const time = defaultTime(platform);
  if ('overrideDate' in body && body.overrideDate) {
    if (!parseDateString(body.overrideDate)) throw 'overrideDate must be "YYYY-MM-DD" or null';
    if (!time) throw `${platform.name} has no posting time`;
    if (atLocalTime(body.overrideDate, time, config.timezone) <= clock.now()) {
      throw `${platform.name} posts at ${time}, which has already passed on ${body.overrideDate}`;
    }
    updates.set('overrideDate', body.overrideDate);
  } else if ('overrideDate' in body) {
    updates.set('overrideDate', null);
  }

  // Next is pinned to the next day when it is set, so later reprojections don't keep pushing it back
  const priority = updates.has('priority') ? updates.get('priority') : current.priority;
  const wasNext = current.priority === NEXT;
  if (priority === NEXT && body.overrideDate) throw 'A Next post goes out the next day; pick another priority to set a date';
  if (priority === NEXT && !wasNext) {
    if (!time) throw `${platform.name} has no posting time`;
    updates.set('overrideDate', nextDateString(clock.now(), config.timezone));
  } else if (wasNext && priority !== NEXT && !('overrideDate' in body)) {
    updates.set('overrideDate', null);
  }

  const caption = updates.get('caption') ?? current.caption ?? '';
  const hashtags = updates.get('hashtags') ?? current.hashtags ?? '';
  const length = caption.length + (hashtags ? hashtags.length + 2 : 0);
  if (platform.charLimit && length > platform.charLimit) {
    throw `Caption and hashtags are ${length} characters; ${platform.name} allows ${platform.charLimit}`;
  }
  return [...updates];
}

export function postsRouter(db) {
  const router = Router();
  const postById = db.prepare(`${SELECT_POST} WHERE post.id = ?`);
  const platformById = db.prepare('SELECT * FROM platform WHERE id = ?');
  const lastPosition = db.prepare('SELECT MAX(queuePosition) AS last FROM post WHERE platformId = ?');

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

  // ?status=queued,failed takes several; ordered by projected time within each platform
  router.get('/', (req, res) => {
    const { platformId, status = 'queued' } = req.query;
    const statuses = status.split(',');
    if (!statuses.every((s) => STATUSES.includes(s))) {
      return res.status(400).json({ error: `status must be one or more of ${STATUSES.join(', ')}` });
    }
    const sql = `${SELECT_POST} WHERE post.status IN (${statuses.map(() => '?').join(', ')})
                 ${platformId ? 'AND post.platformId = ?' : ''}
                 ORDER BY post.platformId, post.scheduledAt IS NULL, post.scheduledAt, post.priority DESC, post.queuePosition`;
    res.json(db.prepare(sql).all(...statuses, ...(platformId ? [platformId] : [])));
  });

  // Composer submit: append to the platform's queue, then project and sync
  router.post('/', async (req, res) => {
    const body = { caption: undefined, ...req.body };
    const platform = usablePlatform(body.platformId);
    if (!platform) return res.status(400).json({ error: 'platformId must be an enabled platform' });

    let updates;
    try {
      updates = postUpdates(body, platform, {}, db);
    } catch (message) {
      return res.status(400).json({ error: message });
    }
    const cols = ['platformId', 'queuePosition', ...updates.map(([col]) => col)];
    const { lastInsertRowid } = db.prepare(`INSERT INTO post (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(platform.id, (lastPosition.get(platform.id).last ?? 0) + 1, ...updates.map(([, value]) => value));

    await syncPlatform(db, platform.id);
    res.status(201).json(postById.get(lastInsertRowid));
  });

  // Edit fields, or move to another platform's queue
  router.patch('/:id', async (req, res) => {
    const post = postById.get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.status !== 'queued' && post.status !== 'library') {
      return res.status(409).json({ error: `Post is ${post.status} and can no longer be edited` });
    }

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
    if (moving) {
      // The old event's color and summary belong to the old platform
      await removeCalendarEvent(post);
      updates.push(['platformId', platform.id], ['queuePosition', (lastPosition.get(platform.id).last ?? 0) + 1],
        ['calendarEventId', null], ['calendarEventHash', null], ['calendarEventEtag', null]);
    }
    if (updates.length > 0) {
      update(post.id, updates);
      await syncPlatform(db, platform.id);
      if (moving) await syncPlatform(db, post.platformId);
    }
    res.json(postById.get(post.id));
  });

  // Swap with the neighbouring post of the same priority (priority decides order across groups)
  router.post('/:id/move', async (req, res) => {
    const post = postById.get(req.params.id);
    if (!post || post.status !== 'queued') return res.status(404).json({ error: 'Queued post not found' });
    const { direction } = req.body ?? {};
    if (direction !== 'up' && direction !== 'down') return res.status(400).json({ error: 'direction must be "up" or "down"' });
    if (post.overrideDate) return res.status(409).json({ error: 'Posts with an override date keep their date; clear it to reorder' });

    const neighbour = db.prepare(`
      SELECT * FROM post WHERE platformId = ? AND status = 'queued' AND priority = ? AND overrideDate IS NULL
        AND queuePosition ${direction === 'up' ? '<' : '>'} ?
      ORDER BY queuePosition ${direction === 'up' ? 'DESC' : 'ASC'} LIMIT 1`)
      .get(post.platformId, post.priority, post.queuePosition);
    if (neighbour) {
      const setPosition = db.prepare('UPDATE post SET queuePosition = ? WHERE id = ?');
      setPosition.run(neighbour.queuePosition, post.id);
      setPosition.run(post.queuePosition, neighbour.id);
      await syncPlatform(db, post.platformId);
    }
    res.json(postById.get(post.id));
  });

  // A failed post missed its slot, so it goes back at the front of the queue
  router.post('/:id/requeue', async (req, res) => {
    const post = postById.get(req.params.id);
    if (!post || post.status !== 'failed') return res.status(404).json({ error: 'Failed post not found' });
    update(post.id, [['status', 'queued'], ['priority', HIGH], ['overrideDate', null], ['lastError', null], ['scheduledAt', null]]);
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
    db.prepare('DELETE FROM post WHERE id = ?').run(post.id);
    await syncPlatform(db, post.platformId);
    res.status(204).end();
  });

  return router;
}
