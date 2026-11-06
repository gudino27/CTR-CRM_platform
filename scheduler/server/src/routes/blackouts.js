/**
 * Blackout dates (/api/blackouts): days a platform (or every
 * platform) does not post. No slots are made on those days.
 *
 * Adding, changing or removing a blackout regenerates the affected platforms' future unlocked
 * slots, like a schedule rule change: posts in slots that go away return to the library and fill
 * later slots; removing a blackout brings its slots back. Locked and pinned slots on a blackout
 * day are kept and flagged (slot.blackout), and Specific Date posts on one are not moved;
 * Compose, Library and Calendar warn about them.
 *
 * Permissions: GET needs any signed-in user; POST, PATCH and DELETE need editSchedules (ROUTES in
 * services/permissions.js). The router writes its own audit entries, since it knows the platform
 * and dates.
 */
import { Router } from 'express';
import { config } from '../config.js';
import { writeAudit } from '../services/access.js';
import { clock } from '../services/clock.js';
import { monthsFrom } from '../services/projection.js';
import { syncPlatform } from '../services/sync.js';
import { parseDateString } from '../services/time.js';
import { visible } from '../services/views.js';
// Months ahead a blackout's own months are regenerated, as far as GET /api/slots generates
import { slotMonthsAhead } from '../settings.js';

// Matched by the blackout form's maxLength
const MAX_REASON = 200;

// isTest is only for the check below; it is left out of answers
const SELECT_BLACKOUT = `SELECT blackout.*, platform.name AS platformName, platform.isTest
                         FROM blackout LEFT JOIN platform ON platform.id = blackout.platformId`;

// "YYYY-MM-DD" that is a real date (parseDateString checks the shape and the day)
const isDate = (value) => typeof value === 'string' && Boolean(parseDateString(value));

/**
 * Checks the fields present in body against the current blackout (null for a new one).
 *
 * Usage:
 *   const { columns, merged } = await blackoutUpdates(db, req.body ?? {}, current);
 *
 * Takes:
 *   db      - the open database
 *   body    - any of platformId (a platform id, or null for all platforms), startDate, endDate
 *             ("YYYY-MM-DD"), reason (up to MAX_REASON characters, or null)
 *   current - the stored blackout, or null for a new one (then platformId, startDate and endDate
 *             are always set)
 *
 * Returns:
 *   { columns: [[column, value]], merged } where merged is the blackout as it will be.
 *   Throws a message (a 400) for a bad field.
 *
 * How it works:
 *   A new one-day blackout may leave endDate out (it becomes startDate). An empty reason is
 *   stored as null. endDate cannot be before startDate.
 */
async function blackoutUpdates(db, body, current) {
  const columns = [];
  const merged = { ...current };
  if ('platformId' in body || !current) {
    const id = body.platformId ?? null;
    if (id !== null) {
      const platform = Number.isInteger(id) ? await db.get('SELECT * FROM platform WHERE id = ?', [id]) : null;
      if (!platform || !visible(platform)) throw 'platformId must be a platform, or null for all platforms';
    }
    columns.push(['platformId', id]);
    merged.platformId = id;
  }
  if ('startDate' in body || !current) {
    if (!isDate(body.startDate)) throw 'startDate must be a date "YYYY-MM-DD"';
    columns.push(['startDate', body.startDate]);
    merged.startDate = body.startDate;
  }
  if ('endDate' in body || !current) {
    const end = body.endDate ?? (current ? undefined : body.startDate);
    if (!isDate(end)) throw 'endDate must be a date "YYYY-MM-DD"';
    columns.push(['endDate', end]);
    merged.endDate = end;
  }
  if (merged.endDate < merged.startDate) throw 'endDate cannot be before startDate';
  if ('reason' in body) {
    const reason = body.reason === null ? '' : body.reason;
    if (typeof reason !== 'string' || reason.trim().length > MAX_REASON) throw `reason must be up to ${MAX_REASON} characters, or null`;
    columns.push(['reason', reason.trim() || null]);
    merged.reason = reason.trim() || null;
  }
  return { columns, merged };
}

/**
 * The months a blackout covers, limited to the months the app generates slots for.
 *
 * Usage:
 *   monthsOf({ startDate: '2026-12-24', endDate: '2027-01-02' })   // ['2026-12', '2027-01']
 *
 * Takes:
 *   blackout - { startDate, endDate }
 *
 * Returns:
 *   "YYYY-MM" months, from this month up to slotMonthsAhead (settings.js) months ahead.
 */
function monthsOf(blackout) {
  const upcoming = monthsFrom(clock.now(), slotMonthsAhead, config.timezone);
  const first = blackout.startDate.slice(0, 7);
  const last = blackout.endDate.slice(0, 7);
  return upcoming.filter((m) => m >= first && m <= last);
}

// "Instagram, 2026-12-24 to 2026-12-26 (Holidays)", for the audit log
const describe = (b, platformName) =>
  `${platformName ?? 'all platforms'}, ${b.startDate === b.endDate ? b.startDate : `${b.startDate} to ${b.endDate}`}${b.reason ? ` (${b.reason})` : ''}`;

/**
 * The /api/blackouts router.
 *
 * Usage:
 *   app.use('/api/blackouts', blackoutsRouter(db));   (app.js)
 *
 * Takes:
 *   db - the open database
 *
 * Returns:
 *   An Express router with the routes below. Every answer leaves out isTest.
 *
 * When editing:
 *   Blackouts on the Test platform only exist in test mode, like the platform (isTest is null
 *   for all-platform blackouts, so those are always shown).
 */
export function blackoutsRouter(db) {
  const router = Router();
  const byId = (id) => db.get(`${SELECT_BLACKOUT} WHERE blackout.id = ?`, [id]);
  const shown = (row) => Boolean(row) && (config.testMode || !row.isTest);
  const view = ({ isTest, ...row }) => row;

  /**
   * Regenerates every platform the blackouts touch (null platformId = all of them), for the
   * months they cover.
   *
   * Usage:
   *   await regenerate(current, update.merged);   // the old days and the new ones
   */
  async function regenerate(...blackouts) {
    const ids = blackouts.some((b) => b.platformId === null)
      ? (await db.all('SELECT id FROM platform')).map((p) => p.id)
      : [...new Set(blackouts.map((b) => b.platformId))];
    const months = [...new Set(blackouts.flatMap(monthsOf))];
    for (const id of ids) await syncPlatform(db, id, { regenerate: true, months });
  }

  /**
   * Locked or pinned future slots kept on the blackout's days, so the page can say so.
   *
   * Returns:
   *   [{ id, platformId, date, time, postId, locked, pinned }] in time order, locked and pinned
   *   as booleans.
   */
  const keptSlots = (b) => db.all(`SELECT id, platformId, date, time, postId, locked, pinned FROM slot
                                   WHERE (platformId = ? OR ? IS NULL) AND date BETWEEN ? AND ? AND scheduledAt > ?
                                     AND (locked = 1 OR pinned = 1)
                                   ORDER BY scheduledAt`, [b.platformId, b.platformId, b.startDate, b.endDate, clock.now().toISOString()])
    .then((rows) => rows.map((s) => ({ ...s, locked: Boolean(s.locked), pinned: Boolean(s.pinned) })));

  // The answer for one blackout: the row (with platformName) plus keptSlots
  const answer = async (id) => {
    const row = await byId(id);
    return { ...view(row), keptSlots: await keptSlots(row) };
  };
  const audit = (req, action, id, summary) =>
    writeAudit(db, { userId: req.user?.id ?? null, action, entityType: 'blackout', entityId: id, summary });
  const platformName = async (id) => (id === null ? null : (await db.get('SELECT name FROM platform WHERE id = ?', [id]))?.name);

  /**
   * GET /api/blackouts: every blackout, earliest first. Any signed-in user.
   *
   * Usage:
   *   GET /api/blackouts                 all of them
   *   GET /api/blackouts?platformId=2    that platform's own and the all-platform ones
   *
   * Returns:
   *   200 [{ id, platformId, platformName, startDate, endDate, reason, ... }]
   */
  router.get('/', async (req, res) => {
    const filter = req.query.platformId ? ' WHERE blackout.platformId = ? OR blackout.platformId IS NULL' : '';
    const rows = await db.all(`${SELECT_BLACKOUT}${filter} ORDER BY blackout.startDate, blackout.id`,
      req.query.platformId ? [Number(req.query.platformId)] : []);
    res.json(rows.filter(shown).map(view));
  });

  /**
   * POST /api/blackouts: adds a blackout. Needs editSchedules.
   *
   * Usage:
   *   POST /api/blackouts  { platformId: null, startDate: "2026-12-25", endDate: "2026-12-26", reason: "Holidays" }
   *
   * Takes:
   *   body - see blackoutUpdates; endDate may be left out for one day
   *
   * Returns:
   *   201 { ...the blackout, keptSlots }; 400 for a bad field.
   *
   * How it works:
   *   Inserts the row, regenerates the affected platforms' slots, then writes the audit entry.
   */
  router.post('/', async (req, res) => {
    let update;
    try {
      update = await blackoutUpdates(db, req.body ?? {}, null);
    } catch (message) {
      return res.status(400).json({ error: message });
    }
    const cols = update.columns.map(([col]) => col);
    const { lastInsertRowid: id } = await db.run(`INSERT INTO blackout (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      update.columns.map(([, value]) => value));
    await regenerate(update.merged);
    await audit(req, 'blackout.create', id, `Added a blackout: ${describe(update.merged, await platformName(update.merged.platformId))}`);
    res.status(201).json(await answer(id));
  });

  /**
   * PATCH /api/blackouts/:id: changes a blackout's platform, dates or reason. Needs editSchedules.
   *
   * Usage:
   *   PATCH /api/blackouts/5  { endDate: "2026-12-31" }
   *
   * Returns:
   *   200 { ...the blackout, keptSlots }; 404 unknown (or a Test platform one outside test mode);
   *   400 for a bad field.
   *
   * How it works:
   *   When something changed: saves it, regenerates both the old and the new days (the old days
   *   get their slots back and the new ones lose theirs), and writes the audit entry.
   */
  router.patch('/:id', async (req, res) => {
    const current = await byId(req.params.id);
    if (!shown(current)) return res.status(404).json({ error: 'Blackout not found' });
    let update;
    try {
      update = await blackoutUpdates(db, req.body ?? {}, current);
    } catch (message) {
      return res.status(400).json({ error: message });
    }
    if (update.columns.length > 0) {
      await db.run(`UPDATE blackout SET ${update.columns.map(([col]) => `${col} = ?`).join(', ')} WHERE id = ?`,
        [...update.columns.map(([, value]) => value), current.id]);
      await regenerate(current, update.merged);
      await audit(req, 'blackout.update', current.id,
        `Changed a blackout: ${describe(update.merged, await platformName(update.merged.platformId))}`);
    }
    res.json(await answer(current.id));
  });

  /**
   * DELETE /api/blackouts/:id: removes a blackout; its days get their slots back. Needs editSchedules.
   *
   * Usage:
   *   DELETE /api/blackouts/5
   *
   * Returns:
   *   204; 404 unknown (or a Test platform one outside test mode).
   */
  router.delete('/:id', async (req, res) => {
    const current = await byId(req.params.id);
    if (!shown(current)) return res.status(404).json({ error: 'Blackout not found' });
    await db.run('DELETE FROM blackout WHERE id = ?', [current.id]);
    await regenerate(current);
    await audit(req, 'blackout.delete', current.id, `Removed a blackout: ${describe(current, current.platformName)}`);
    res.status(204).end();
  });

  return router;
}
