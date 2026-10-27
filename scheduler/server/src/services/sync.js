// Keeps each platform's slots filled and mirrors the schedule to Google Calendar.
// Every route that changes a post, slot or platform calls syncPlatform afterwards.
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { clock } from './clock.js';
import { buildEvent, createCalendarClient } from './googleCalendar.js';
import { serialized } from './lock.js';
import { fillSlots, fitsSlot, monthBlueprint, monthsFrom, parseMonth } from './projection.js';
import { parseLocalDateTime } from './time.js';
import { fixedDays, postTypesOf } from './views.js';
let calendarClient = createCalendarClient();
// Latest calendar problems per platform; cleared when that platform syncs cleanly
const syncErrors = new Map();
export const syncState = {
  get lastSyncError() {
    if (syncErrors.size === 0) return null;
    const errors = [...syncErrors.values()];
    return { at: errors.map((e) => e.at).sort().at(-1), message: errors.map((e) => e.message).join('; ') };
  },
  get calendarConnected() { return calendarClient !== null; },
};
/** Tests swap in a fake client (or null). */
export function setCalendarClient(client) {
  calendarClient = client;
  syncErrors.clear();
}
export function parsePlatform(row) {
  return {
    ...row,
    enabled: Boolean(row.enabled),
    isTest: Boolean(row.isTest),
    paused: Boolean(row.paused),
    usesColors: Boolean(row.usesColors),
    postingDays: JSON.parse(row.postingDays),
    postingTimes: JSON.parse(row.postingTimes),
  };
}
const hash = (event) => createHash('sha256').update(JSON.stringify(event)).digest('hex');
export function syncPlatform(db, platformId, options = {}) {
  return serialized(() => syncPlatformNow(db, platformId, options));
}

function writeBlueprint(db, platform, months, nowIso, regenerate) {
  const types = postTypesOf(db, platform.id).filter((type) => type.inRotation);
  const insert = db.prepare(`INSERT INTO slot (platformId, date, time, scheduledAt, color, postTypeId)
                             VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (platformId, date, time) DO NOTHING`);
  if (regenerate) {
    const withFuture = db.prepare(`SELECT DISTINCT substr(date, 1, 7) AS month FROM slot
                                   WHERE platformId = ? AND scheduledAt > ?`).all(platform.id, nowIso);
    months = [...months, ...withFuture.map((r) => r.month)];
  }
  const update = db.prepare('UPDATE slot SET color = ?, postTypeId = ?, scheduledAt = ? WHERE id = ?');
  const remove = db.prepare('DELETE FROM slot WHERE id = ?');
  const futureUnlocked = db.prepare(`SELECT * FROM slot WHERE platformId = ? AND date LIKE ? AND scheduledAt > ? AND locked = 0`);

  for (const month of new Set(months)) {
    const [year, m] = parseMonth(month);
    const blueprint = monthBlueprint(platform, types, year, m, config.timezone).filter((s) => s.scheduledAt > nowIso);
    if (regenerate) {
      const byKey = new Map(blueprint.map((s) => [`${s.date} ${s.time}`, s]));
      for (const slot of futureUnlocked.all(platform.id, `${month}-%`, nowIso)) {
        const next = byKey.get(`${slot.date} ${slot.time}`);
        if (next) update.run(next.color, next.postTypeId, next.scheduledAt, slot.id);
        else remove.run(slot.id); // its post goes back to the library
      }
    }
    for (const s of blueprint) insert.run(platform.id, s.date, s.time, s.scheduledAt, s.color, s.postTypeId);
  }
}
function placePosts(db, platform, nowIso, scheduling) {
  const slots = db.prepare('SELECT * FROM slot WHERE platformId = ? ORDER BY scheduledAt').all(platform.id);
  const postsInSlots = new Map(db.prepare('SELECT post.* FROM post JOIN slot ON slot.postId = post.id WHERE slot.platformId = ?')
    .all(platform.id).map((p) => [p.id, p]));
  const blocked = fixedDays(db, platform.id);
  const free = db.prepare('UPDATE slot SET postId = NULL, pinned = 0 WHERE id = ?');

  for (const slot of slots) {
    const post = slot.postId ? postsInSlots.get(slot.postId) : null;
    // Sent (or failed) posts stay in their slot as history
    if (!post || post.status !== 'queued') continue;
    const belongs = post.kind === 'library' && post.platformId === platform.id;
    let release;
    if (slot.scheduledAt <= nowIso) {
      // A due post is the dispatcher's; one that wasn't due (paused, or edited after its slot) missed it
      release = !belongs || post.scheduledAt === null || post.scheduledAt > nowIso;
    } else {
      release = !belongs || (!slot.locked && (blocked.has(slot.date) || (!slot.pinned && !fitsSlot(slot, post, platform.usesColors))));
    }
    if (release) {
      free.run(slot.id);
      slot.postId = null;
    }
  }
  db.prepare('UPDATE slot SET pinned = 0 WHERE platformId = ? AND postId IS NULL AND pinned = 1').run(platform.id);
  if (!scheduling) return slots;
  const pool = db.prepare(`SELECT * FROM post WHERE platformId = ? AND kind = 'library' AND status = 'queued'
                             AND (scheduledAt IS NULL OR scheduledAt > ?)
                             AND NOT EXISTS (SELECT 1 FROM slot WHERE slot.postId = post.id)`).all(platform.id, nowIso);
  const open = slots.filter((s) => !s.postId && !s.locked && s.scheduledAt > nowIso && !blocked.has(s.date));
  const assign = db.prepare('UPDATE slot SET postId = ? WHERE id = ?');
  const byId = new Map(slots.map((s) => [s.id, s]));
  for (const { slotId, postId } of fillSlots(open, pool, platform.usesColors)) {
    assign.run(postId, slotId);
    byId.get(slotId).postId = postId;
  }
  return slots;
}
async function syncPlatformNow(db, platformId, { months = [], regenerate = false } = {}) {
  const now = clock.now();
  const nowIso = now.toISOString();
  const row = db.prepare('SELECT * FROM platform WHERE id = ?').get(platformId);
  if (!row) return;
  const platform = parsePlatform(row);
  // Disabled or paused platforms, and the Test platform outside test mode, schedule nothing;
  // their slot assignments are kept so turning them back on restores the schedule
  const scheduling = platform.enabled && !platform.paused && (config.testMode || !platform.isTest);
  // Posts whose time has come are the dispatcher's; rescheduling them would push them to a later slot
  let posts;
  let schedule;
  db.exec('BEGIN');
  try {
    writeBlueprint(db, platform, [...monthsFrom(now, 2, config.timezone), ...months], nowIso, regenerate);
    const slots = placePosts(db, platform, nowIso, scheduling);
    const slotTime = new Map(slots.filter((s) => s.postId).map((s) => [s.postId, s.scheduledAt]));

    posts = db.prepare(`SELECT post.*, postType.name AS postTypeName FROM post LEFT JOIN postType ON postType.id = post.postTypeId
                        WHERE post.platformId = ? AND post.status = 'queued'
                          AND (post.scheduledAt IS NULL OR post.scheduledAt > ?)`).all(platformId, nowIso);
    // Fixed posts go at fixedAt, library posts at their slot; unplaced ones have no time
    schedule = posts.map((post) => {
      if (!scheduling) return { post, slot: null };
      const at = post.kind === 'fixed' ? parseLocalDateTime(post.fixedAt, config.timezone)?.toISOString() : slotTime.get(post.id);
      return { post, slot: at ? new Date(at) : null };
    });
    // Saved first so the app shows it even if the calendar is unreachable
    const save = db.prepare('UPDATE post SET scheduledAt = ? WHERE id = ?');
    for (const { post, slot } of schedule) save.run(slot?.toISOString() ?? null, post.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  if (!calendarClient) return;

  const saveEvent = db.prepare('UPDATE post SET calendarEventId = ?, calendarEventHash = ?, calendarEventEtag = ? WHERE id = ?');
  const mediaById = db.prepare('SELECT * FROM media WHERE id = ?');
  const problems = [];

  for (const { post, slot } of schedule) {
    const eventId = post.calendarEventId;
    try {
      if (!slot) {
        if (eventId) {
          await calendarClient.remove(eventId);
          saveEvent.run(null, null, null, post.id);
        }
        continue;
      }
      const media = post.mediaId ? mediaById.get(post.mediaId) : null;
      const event = buildEvent({ platform, post, media, slot });
      const eventHash = hash(event);
      if (!eventId) {
        const written = await calendarClient.insert(event);
        saveEvent.run(written.id, eventHash, written.etag, post.id);
      } else if (post.calendarEventHash !== eventHash) {
        const written = await calendarClient.patch(eventId, event, post.calendarEventEtag);
        saveEvent.run(eventId, eventHash, written.etag, post.id);
      }
    } catch (err) {
      // 412: someone edited the event in Google Calendar. Their edit is kept;
      // reading it back as a fixed date is two-way sync.
      problems.push(err.code === 412
        ? `Post ${post.id}: event was edited in Google Calendar, so the app left it unchanged`
        : `Post ${post.id}: ${err.message}`);
      if (err.code !== 412) console.error('Calendar sync failed:', err);
    }
  }
  // The next sync retries anything that failed
  if (problems.length) syncErrors.set(platformId, { at: now.toISOString(), message: problems.join('; ') });
  else syncErrors.delete(platformId);
}
/** Removes the post's calendar event (if any). Call before deleting the row. */
export function removeCalendarEvent(post) {
  return serialized(async () => {
    if (post.calendarEventId && calendarClient) await calendarClient.remove(post.calendarEventId);
  });
}
export async function syncAll(db, options) {
  for (const { id } of db.prepare('SELECT id FROM platform').all()) await syncPlatform(db, id, options);
}