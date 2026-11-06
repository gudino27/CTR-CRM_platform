/**
 * Library stock per post type and color (/api/inventory, the Inventory page) and the data for
 * the weekly brief email (/api/brief). Both need any signed-in user.
 */
import { Router } from 'express';
import { config } from '../config.js';
import { clock } from '../services/clock.js';
import { monthsBetween, monthsFrom } from '../services/projection.js';
import { syncPlatform } from '../services/sync.js';
import { offsetIso } from '../services/time.js';
import { SELECT_POST, SELECT_SLOT, fixedDays, inventory, slotViews, visible } from '../services/views.js';
import { briefLowStockMonths } from '../settings.js';

const DAY_MS = 86_400_000;

/**
 * The inventory router, mounted at /api.
 *
 * Usage:
 *   app.use('/api', inventoryRouter(db));   (app.js)
 *
 * Takes:
 *   db - the open database
 *
 * Returns:
 *   An Express router with the routes below.
 *
 * How it works:
 *   Both routes first make sure slots exist for the months they count (generate runs
 *   syncPlatform on every enabled platform the viewer can see, for those months).
 *
 * When editing:
 *   The query limits (months 1 to 12, days 1 to 90) are part of the API, not settings.
 */
export function inventoryRouter(db) {
  const router = Router();
  const activePlatforms = async () => (await db.all('SELECT * FROM platform WHERE enabled = 1 ORDER BY sortOrder')).filter(visible);

  const generate = async (months) => {
    for (const { id } of await activePlatforms()) await syncPlatform(db, id, { months });
  };

  /**
   * GET /api/inventory: library stock for the coming months (the Inventory page).
   *
   * Usage:
   *   GET /api/inventory?months=2
   *
   * Takes:
   *   months - how many months from this one, 1 to 12, default 2
   *
   * Returns:
   *   200 with inventory()'s rows (services/views.js); 400 for a bad months.
   */
  router.get('/inventory', async (req, res) => {
    const count = Number(req.query.months ?? 2);
    if (!Number.isInteger(count) || count < 1 || count > 12) return res.status(400).json({ error: 'months must be 1 to 12' });
    const now = clock.now();
    const months = monthsFrom(now, count, config.timezone);
    await generate(months);
    res.json(await inventory(db, months, now));
  });

  /**
   * GET /api/brief: the weekly brief's data: what goes out in the next `days`, the slots still
   * empty in that range, and the post types running low.
   *
   * Usage:
   *   GET /api/brief?days=14
   *
   * Takes:
   *   days - 1 to 90, default 14
   *
   * Returns:
   *   200 { from, to (ISO with the app time zone's offset), posts (queued, in time order),
   *         emptySlots (slotViews), lowStock (inventory rows with low, over briefLowStockMonths
   *         from settings.js) }
   *   400 for a bad days.
   *
   * How it works:
   *   Only enabled platforms the viewer can see count. An empty slot on a day that has a
   *   Specific Date post is left out, since that day's library slots are blocked.
   */
  router.get('/brief', async (req, res) => {
    const days = Number(req.query.days ?? 14);
    if (!Number.isInteger(days) || days < 1 || days > 90) return res.status(400).json({ error: 'days must be 1 to 90' });
    const now = clock.now();
    const to = new Date(now.getTime() + days * DAY_MS);
    await generate(monthsBetween(now, to, config.timezone));

    const ids = (await activePlatforms()).map((p) => p.id);
    const inList = ids.map(() => '?').join(', ') || 'NULL';
    const range = [now.toISOString(), to.toISOString()];
    const posts = await db.all(`${SELECT_POST} WHERE post.status = 'queued' AND post.platformId IN (${inList})
                                AND post.scheduledAt > ? AND post.scheduledAt <= ? ORDER BY post.scheduledAt, post.id`, [...ids, ...range]);
    const blocked = new Map();
    for (const id of ids) blocked.set(id, await fixedDays(db, id));
    const empty = (await db.all(`${SELECT_SLOT} WHERE slot.postId IS NULL AND slot.platformId IN (${inList})
                                 AND slot.scheduledAt > ? AND slot.scheduledAt <= ? ORDER BY slot.scheduledAt, slot.id`, [...ids, ...range]))
      .filter((s) => !blocked.get(s.platformId).has(s.date));

    res.json({
      from: offsetIso(now, config.timezone),
      to: offsetIso(to, config.timezone),
      posts,
      emptySlots: await slotViews(db, empty),
      lowStock: (await inventory(db, monthsFrom(now, briefLowStockMonths, config.timezone), now)).filter((r) => r.low),
    });
  });

  return router;
}
