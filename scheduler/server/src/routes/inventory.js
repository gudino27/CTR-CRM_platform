import { Router } from 'express';
import { config } from '../config.js';
import { clock } from '../services/clock.js';
import { monthsBetween, monthsFrom } from '../services/projection.js';
import { syncPlatform } from '../services/sync.js';
import { offsetIso } from '../services/time.js';
import { SELECT_POST, SELECT_SLOT, fixedDays, inventory, slotViews, visible } from '../services/views.js';

const DAY_MS = 86_400_000;

// Library stock per post type and color, and the data for the weekly brief email
export function inventoryRouter(db) {
  const router = Router();
  const activePlatforms = () => db.prepare('SELECT * FROM platform WHERE enabled = 1 ORDER BY sortOrder').all().filter(visible);

  // Slots must exist for the months counted
  const generate = async (months) => {
    for (const { id } of activePlatforms()) await syncPlatform(db, id, { months });
  };

  router.get('/inventory', async (req, res) => {
    const count = Number(req.query.months ?? 2);
    if (!Number.isInteger(count) || count < 1 || count > 12) return res.status(400).json({ error: 'months must be 1 to 12' });
    const now = clock.now();
    const months = monthsFrom(now, count, config.timezone);
    await generate(months);
    res.json(inventory(db, months, now));
  });

  // What goes out in the next `days`, the slots still empty in that range, and the types running low
  router.get('/brief', async (req, res) => {
    const days = Number(req.query.days ?? 14);
    if (!Number.isInteger(days) || days < 1 || days > 90) return res.status(400).json({ error: 'days must be 1 to 90' });
    const now = clock.now();
    const to = new Date(now.getTime() + days * DAY_MS);
    await generate(monthsBetween(now, to, config.timezone));

    const ids = activePlatforms().map((p) => p.id);
    const inList = ids.map(() => '?').join(', ') || 'NULL';
    const range = [now.toISOString(), to.toISOString()];
    const posts = db.prepare(`${SELECT_POST} WHERE post.status = 'queued' AND post.platformId IN (${inList})
                              AND post.scheduledAt > ? AND post.scheduledAt <= ? ORDER BY post.scheduledAt, post.id`)
      .all(...ids, ...range);
    const blocked = new Map(ids.map((id) => [id, fixedDays(db, id)]));
    const empty = db.prepare(`${SELECT_SLOT} WHERE slot.postId IS NULL AND slot.platformId IN (${inList})
                              AND slot.scheduledAt > ? AND slot.scheduledAt <= ? ORDER BY slot.scheduledAt, slot.id`)
      .all(...ids, ...range)
      .filter((s) => !blocked.get(s.platformId).has(s.date));

    res.json({
      from: offsetIso(now, config.timezone),
      to: offsetIso(to, config.timezone),
      posts,
      emptySlots: slotViews(db, empty),
      lowStock: inventory(db, monthsFrom(now, 2, config.timezone), now).filter((r) => r.low),
    });
  });

  return router;
}