/**
 * Read queries shared by the routes: posts come back with their image, type and slot, and
 * slots with their post, so pages don't need a second request.
 *
 * What lives here: SELECT_POST and SELECT_SLOT (base queries), visible, postTypesOf, rulesOf,
 * cadenceOf, fixedDays, blackoutsFor, colorAnchorsOf, missedPosts, slotViews and inventory.
 *
 * When editing:
 *   Rows go straight from SQL to JSON (camelCase columns), so a column added here shows up in
 *   the API as it is named. Every query must work on SQLite and MariaDB.
 */
import { config } from '../config.js';
import { COLORS, blackoutOn } from './projection.js';
import { parseLocalDateTime } from './time.js';

// A post with mediaLink, mediaName, postTypeName and slotId; add WHERE/ORDER BY after it
export const SELECT_POST = `SELECT post.*, media.link AS mediaLink, media.name AS mediaName,
                                   postType.name AS postTypeName, slot.id AS slotId
                            FROM post LEFT JOIN media ON media.id = post.mediaId
                            LEFT JOIN postType ON postType.id = post.postTypeId
                            LEFT JOIN slot ON slot.postId = post.id`;

// A slot with postTypeName; pass the rows through slotViews before sending them
export const SELECT_SLOT = `SELECT slot.*, postType.name AS postTypeName
                            FROM slot LEFT JOIN postType ON postType.id = slot.postTypeId`;

/**
 * Whether the app shows a platform: the Test platform only exists in test mode.
 *
 * Usage:
 *   platforms.filter(visible)
 *
 * Takes:
 *   platform - a platform row (isTest may be 0/1 or a boolean)
 *
 * Returns:
 *   true when TEST_MODE is on or the platform is not the Test platform.
 */
export const visible = (platform) => config.testMode || !platform.isTest;

/**
 * A platform's post types, in sortOrder (then id).
 *
 * Usage:
 *   const types = await postTypesOf(db, platform.id);
 *
 * Returns:
 *   [{ id, name, sortOrder, inRotation }] with inRotation as a boolean.
 *
 * When editing:
 *   This order is the rotation order monthBlueprint uses for rules with an empty type list.
 */
export const postTypesOf = async (db, platformId) =>
  (await db.all('SELECT id, name, sortOrder, inRotation FROM postType WHERE platformId = ? ORDER BY sortOrder, id', [platformId]))
    .map((type) => ({ ...type, inRotation: Boolean(type.inRotation) }));

/**
 * A platform's schedule rules in sortOrder (then id), as the API returns them.
 *
 * Usage:
 *   const rules = await rulesOf(db, platform.id);
 *
 * Returns:
 *   scheduleRule rows with postTypeIds as a list (stored as JSON text) and active as a boolean.
 */
export const rulesOf = async (db, platformId) =>
  (await db.all('SELECT * FROM scheduleRule WHERE platformId = ? ORDER BY sortOrder, id', [platformId]))
    .map((rule) => ({ ...rule, postTypeIds: JSON.parse(rule.postTypeIds), active: Boolean(rule.active) }));

/**
 * The weekdays and times the active rules post on, in the old postingDays/postingTimes shape
 * (pages use the first time as a default).
 *
 * Usage:
 *   { ...parsePlatform(row), ...cadenceOf(rules) }   // routes/platforms.js
 *
 * Takes:
 *   rules - rulesOf() output
 *
 * Returns:
 *   { postingDays: ['MON', ...] in Monday-first order, postingTimes: ['09:00', ...] sorted, no repeats }
 */
export function cadenceOf(rules) {
  const active = rules.filter((r) => r.active);
  const codes = new Set(active.flatMap((r) => r.byDay.split(',')));
  return {
    postingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].filter((d) => codes.has(d.slice(0, 2))),
    postingTimes: [...new Set(active.map((r) => r.time))].sort(),
  };
}

/**
 * The local dates that have a Specific Date (fixed) post on the platform; its library slots
 * on those days are blocked.
 *
 * Usage:
 *   const blocked = await fixedDays(db, platform.id);   // blocked.has('2026-11-26')
 *
 * Returns:
 *   A Set of "YYYY-MM-DD" strings. Failed fixed posts don't block their day.
 */
export async function fixedDays(db, platformId) {
  const rows = await db.all(`SELECT DISTINCT substr(fixedAt, 1, 10) AS date FROM post
                             WHERE platformId = ? AND kind = 'fixed' AND status != 'failed'`, [platformId]);
  return new Set(rows.map((r) => r.date));
}

// Post statuses whose Specific Date color stays in the Blue/Purple alternation
// (failed posts were never published, so they leave it)
const ANCHOR_STATUSES = ['queued', 'sending', 'posted'];

/**
 * The fixed points of a platform's Blue/Purple alternation, for monthBlueprint. A Specific
 * Date post with a color shifts the whole schedule from that point on.
 *
 * Usage:
 *   const anchors = await colorAnchorsOf(db, platform);
 *   const anchors = await colorAnchorsOf(db, platform, { exceptPostId: 12 });   // the color suggestion
 *
 * Takes:
 *   platform     - a platform row ({ id, usesColors })
 *   exceptPostId - optional; leaves that post out (the one being edited)
 *
 * Returns:
 *   [{ date 'YYYY-MM-DD', time 'HH:MM', color, blocksDay, postId?, slotId? }] ordered by date
 *   and time; [] when the platform does not use colors.
 *   - Specific Date posts with a color that are queued, sending or posted (archived ones
 *     too): blocksDay true, since they take that day's place.
 *   - Kept slots (slot.kept) with a color: blocksDay false.
 *
 * When editing:
 *   sync.js compares this list between syncs to know when to recolor later slots, so keep the
 *   order stable. Deleting an old posted Specific Date post for good (Archive page) takes it
 *   out of the list; when it was the latest one, later slots recount from the one before.
 */
export async function colorAnchorsOf(db, platform, { exceptPostId = null } = {}) {
  if (!platform.usesColors) return [];
  const posts = await db.all(`SELECT id, fixedAt, color FROM post
                              WHERE platformId = ? AND kind = 'fixed' AND color IS NOT NULL AND fixedAt IS NOT NULL
                                AND status IN (${ANCHOR_STATUSES.map(() => '?').join(', ')}) AND id != ?`,
    [platform.id, ...ANCHOR_STATUSES, exceptPostId ?? 0]);
  const kept = await db.all('SELECT id, date, time, color FROM slot WHERE platformId = ? AND kept = 1 AND color IS NOT NULL',
    [platform.id]);
  return [
    ...posts.map((p) => ({ date: p.fixedAt.slice(0, 10), time: p.fixedAt.slice(11, 16), color: p.color, blocksDay: true, postId: p.id })),
    ...kept.map((k) => ({ date: k.date, time: k.time, color: k.color, blocksDay: false, slotId: k.id })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || (a.postId ?? 0) - (b.postId ?? 0)
    || (a.slotId ?? 0) - (b.slotId ?? 0));
}

/**
 * The queued posts whose date passed while the platform was paused (or off), for
 * the resume choices on the Platforms page.
 *
 * Usage:
 *   const missed = await missedPosts(db, platform, clock.now());
 *
 * Takes:
 *   platform - parsed platform ({ id, usesColors })
 *   now      - a Date
 *
 * Returns:
 *   [{ ...SELECT_POST row, missedAt (UTC ISO), canReturnToLibrary }] ordered by missedAt:
 *   - Specific Date posts (kind "fixed") whose fixedAt has passed; missedAt is fixedAt.
 *   - Library posts still in a slot whose time passed (sync.js placePosts keeps them there
 *     while the platform is not scheduling); missedAt is the slot's time.
 *   canReturnToLibrary is false for a Specific Date post whose type is not in the rotation
 *   (Holiday is date-only), has no type, or has no color on a platform that uses colors.
 *
 * When editing:
 *   Only means "missed" while the platform is paused or off: on a scheduling platform sync
 *   already sent the library posts back and failed the Specific Date ones.
 */
export async function missedPosts(db, platform, now) {
  const nowIso = now.toISOString();
  const fixed = (await db.all(`${SELECT_POST} WHERE post.platformId = ? AND post.kind = 'fixed' AND post.status = 'queued'
                                AND post.fixedAt IS NOT NULL`, [platform.id]))
    .map((p) => ({ ...p, missedAt: parseLocalDateTime(p.fixedAt, config.timezone)?.toISOString() ?? null }))
    .filter((p) => p.missedAt && p.missedAt <= nowIso);
  const library = (await db.all(`${SELECT_POST.replace('slot.id AS slotId', 'slot.id AS slotId, slot.scheduledAt AS missedAt')}
                                 WHERE post.platformId = ? AND post.kind = 'library' AND post.status = 'queued'
                                   AND slot.scheduledAt <= ?`, [platform.id, nowIso]));
  const rotation = new Set((await db.all('SELECT id FROM postType WHERE platformId = ? AND inRotation = 1', [platform.id])).map((t) => t.id));
  return [...fixed, ...library]
    .map((p) => ({ ...p, canReturnToLibrary: p.kind === 'library'
      || (rotation.has(p.postTypeId) && (!platform.usesColors || p.color !== null)) }))
    .sort((a, b) => a.missedAt.localeCompare(b.missedAt) || a.id - b.id);
}

/**
 * The blackouts that apply to a platform: its own and the all-platform ones (platformId null).
 *
 * Usage:
 *   const blackouts = await blackoutsFor(db, platform.id);   // then blackoutOn(blackouts, date)
 *
 * Returns:
 *   A promise for blackout rows ordered by startDate, then id.
 */
export const blackoutsFor = (db, platformId) =>
  db.all('SELECT * FROM blackout WHERE platformId = ? OR platformId IS NULL ORDER BY startDate, id', [platformId]);

/**
 * Turns slot rows into what the API returns for them.
 *
 * Usage:
 *   res.json({ slots: await slotViews(db, slots), fixedPosts });   // routes/slots.js
 *
 * Takes:
 *   rows - slot rows, e.g. from SELECT_SLOT (any mix of platforms)
 *
 * Returns:
 *   The rows, in the same order, with:
 *   locked, pinned - booleans
 *   kept           - boolean: kept where it was when the schedule rules changed
 *   blocked        - true for an empty slot on a day with a Specific Date post
 *   blackout       - { id, reason } for a slot on a blackout day (absent otherwise); only locked
 *                    or pinned slots are left on blackout days, kept as hand choices and
 *                    flagged by it
 *   post           - the post in it (SELECT_POST shape), or null
 *
 * How it works:
 *   Loads each platform's fixed days and blackouts once, then adds the fields row by row
 *   (one query per filled slot for its post).
 */
export async function slotViews(db, rows) {
  const daysByPlatform = new Map();
  const blackoutsByPlatform = new Map();
  const views = [];
  for (const row of rows) {
    if (!daysByPlatform.has(row.platformId)) daysByPlatform.set(row.platformId, await fixedDays(db, row.platformId));
    if (!blackoutsByPlatform.has(row.platformId)) blackoutsByPlatform.set(row.platformId, await blackoutsFor(db, row.platformId));
    const blackout = blackoutOn(blackoutsByPlatform.get(row.platformId), row.date);
    views.push({
      ...row,
      locked: Boolean(row.locked),
      pinned: Boolean(row.pinned),
      kept: Boolean(row.kept),
      blocked: !row.postId && daysByPlatform.get(row.platformId).has(row.date),
      ...(blackout ? { blackout: { id: blackout.id, reason: blackout.reason } } : {}),
      post: row.postId ? await db.get(`${SELECT_POST} WHERE post.id = ?`, [row.postId]) : null,
    });
  }
  return views;
}

/**
 * Stock per platform x post type x color: how many library posts are waiting for a slot,
 * against how many empty slots are still to come. Feeds the Inventory page and the brief's
 * "running low" list.
 *
 * Usage:
 *   res.json(await inventory(db, months, now));   // routes/inventory.js
 *
 * Takes:
 *   months - ["YYYY-MM", ...] in order; the range runs from the first to the last
 *   now    - a Date; only slots after it count
 *
 * Returns:
 *   [{ platformId, platformName, postTypeId, postTypeName, color, inLibrary, emptySlots, low }]
 *   for each enabled, visible platform (in sortOrder) and each rotation type; color is null
 *   on platforms without colors. low is true when emptySlots > inLibrary.
 *
 * How it works:
 *   inLibrary counts queued library posts not in any slot. emptySlots counts future empty
 *   slots in the months, leaving out days blocked by a Specific Date post and blackout days.
 *
 * When editing:
 *   The last day is written as "-31" for every month; that is fine because dates are compared
 *   as strings. Colors are matched with COALESCE (see the inline note), not "IS ?", so the
 *   query runs on both SQLite and MariaDB.
 */
export async function inventory(db, months, now) {
  const first = `${months[0]}-01`;
  const last = `${months.at(-1)}-31`;
  const platforms = (await db.all('SELECT * FROM platform WHERE enabled = 1 ORDER BY sortOrder')).filter(visible);
  // COALESCE(color, '') = COALESCE(?, '') matches null to null (SQLite's "color IS ?"; MariaDB has no IS for values)
  const inLibrary = `SELECT COUNT(*) AS n FROM post
                     WHERE platformId = ? AND kind = 'library' AND status = 'queued' AND postTypeId = ? AND COALESCE(color, '') = COALESCE(?, '')
                       AND NOT EXISTS (SELECT 1 FROM slot WHERE slot.postId = post.id)`;
  const emptySlots = `SELECT date FROM slot
                      WHERE platformId = ? AND postTypeId = ? AND COALESCE(color, '') = COALESCE(?, '') AND postId IS NULL
                        AND scheduledAt > ? AND date BETWEEN ? AND ?`;
  const rows = [];
  for (const platform of platforms) {
    const blocked = await fixedDays(db, platform.id);
    const blackouts = await blackoutsFor(db, platform.id);
    for (const type of (await postTypesOf(db, platform.id)).filter((t) => t.inRotation)) {
      for (const color of platform.usesColors ? COLORS : [null]) {
        const stock = (await db.get(inLibrary, [platform.id, type.id, color])).n;
        const empty = (await db.all(emptySlots, [platform.id, type.id, color, now.toISOString(), first, last]))
          .filter((s) => !blocked.has(s.date) && !blackoutOn(blackouts, s.date)).length;
        rows.push({
          platformId: platform.id, platformName: platform.name, postTypeId: type.id, postTypeName: type.name,
          color, inLibrary: stock, emptySlots: empty, low: empty > stock,
        });
      }
    }
  }
  return rows;
}