import { Router } from 'express';
import { config } from '../config.js';
import { clock } from '../services/clock.js';
import { COLORS, fitsSlot, monthsFrom, parseMonth } from '../services/projection.js';
import { parsePlatform, syncPlatform } from '../services/sync.js';
import { SELECT_POST, SELECT_SLOT, fixedDays, slotViews, visible } from '../services/views.js';
// Months ahead that GET /api/slots generates on demand
const GENERATE_MONTHS = 24;

export function slotsRouter(db) {
  const router = Router();
  const platformById = db.prepare('SELECT * FROM platform WHERE id = ?');
  const slotById = db.prepare(`${SELECT_SLOT} WHERE slot.id = ?`);

  // One platform's month: its slots (generated on first view) and the fixed posts on its days
  router.get('/', async (req, res) => {
    const row = platformById.get(req.query.platformId);
    if (!row || !visible(row)) return res.status(400).json({ error: 'platformId must be a platform' });
    const month = req.query.month;
    if (!parseMonth(month)) return res.status(400).json({ error: 'month must be "YYYY-MM"' });

    const upcoming = monthsFrom(clock.now(), GENERATE_MONTHS, config.timezone);
    await syncPlatform(db, row.id, { months: upcoming.includes(month) ? [month] : [] });

    const slots = db.prepare(`${SELECT_SLOT} WHERE slot.platformId = ? AND slot.date LIKE ? ORDER BY slot.scheduledAt`)
      .all(row.id, `${month}-%`);
    const fixedPosts = db.prepare(`${SELECT_POST} WHERE post.platformId = ? AND post.kind = 'fixed' AND post.fixedAt LIKE ?
                                   ORDER BY post.fixedAt, post.id`).all(row.id, `${month}-%`);
    res.json({ slots: slotViews(db, slots), fixedPosts });
  });

  // Hand overrides: type, color, the post in it (pinned), and lock
  router.patch('/:id', async (req, res) => {
    const slot = slotById.get(req.params.id);
    const row = slot && platformById.get(slot.platformId);
    if (!slot || !visible(row)) return res.status(404).json({ error: 'Slot not found' });
    if (slot.scheduledAt <= clock.now().toISOString()) return res.status(409).json({ error: 'This slot has already passed' });
    const platform = parsePlatform(row);
    const body = req.body ?? {};
    const updates = [];
    if ('postTypeId' in body) {
      if (!db.prepare('SELECT 1 FROM postType WHERE id = ? AND platformId = ? AND inRotation = 1').get(body.postTypeId, platform.id)) {
        return res.status(400).json({ error: `postTypeId must be one of ${platform.name}'s monthly post types` });
      }
      updates.push(['postTypeId', body.postTypeId]);
    }
    if ('color' in body) {
      const ok = platform.usesColors ? COLORS.includes(body.color) : body.color === null;
      if (!ok) {
        return res.status(400).json({ error: platform.usesColors ? 'color must be "Blue" or "Purple"' : `${platform.name} does not use colors; color must be null` });
      }
      updates.push(['color', body.color]);
    }
    if ('locked' in body) {
      if (typeof body.locked !== 'boolean') return res.status(400).json({ error: 'locked must be true or false' });
      updates.push(['locked', body.locked ? 1 : 0]);
    }
    let pin;
    if ('postId' in body && body.postId !== null) {
      pin = db.prepare(`SELECT * FROM post WHERE id = ? AND platformId = ? AND kind = 'library' AND status = 'queued'`)
        .get(body.postId, platform.id);
      if (!pin) return res.status(400).json({ error: `postId must be a waiting library post on ${platform.name}` });
      if (fixedDays(db, platform.id).has(slot.date)) {
        return res.status(409).json({ error: 'A Specific Date post is on this day, so its library slots are blocked' });
      }
    }
    if (updates.length > 0) {
      db.prepare(`UPDATE slot SET ${updates.map(([col]) => `${col} = ?`).join(', ')} WHERE id = ?`)
        .run(...updates.map(([, value]) => value), slot.id);
    }
    const free = db.prepare('UPDATE slot SET postId = NULL, pinned = 0 WHERE id = ?');
    if ('postId' in body) {
      free.run(slot.id); // its post goes back to the library
      if (pin) {
        // Taking the post from another slot frees that one, which refills from the library
        db.prepare('UPDATE slot SET postId = NULL, pinned = 0 WHERE postId = ?').run(pin.id);
        db.prepare('UPDATE slot SET postId = ?, pinned = 1 WHERE id = ?').run(pin.id, slot.id);
        db.prepare('UPDATE post SET scheduledAt = NULL WHERE id = ?').run(pin.id);
      }
    } else if (slot.postId && !slot.pinned && (updates.length > 0)) {
      // A new type or color frees a post that no longer fits, even in a locked slot (this is a hand change)
      const changed = slotById.get(slot.id);
      const post = db.prepare('SELECT * FROM post WHERE id = ?').get(slot.postId);
      if (!fitsSlot(changed, post, platform.usesColors)) free.run(slot.id);
    }
    await syncPlatform(db, platform.id);
    res.json(slotViews(db, [slotById.get(slot.id)])[0]);
  });
  return router;
}