/**
 * Keeps each platform's slots filled and mirrors the schedule to Google Calendar.
 * Every route that changes a post, slot, platform or schedule rule calls syncPlatform
 * afterwards; a schedule change passes regenerate so the future unlocked slots follow the
 * new rules.
 *
 * What lives here: syncPlatform and syncAll (the entry points), syncState (calendar status),
 * parsePlatform, withTypeChanges, removeCalendarEvent, setCalendarClient, suggestColor and
 * ruleChangeImpact, and the steps syncPlatformNow runs (writeBlueprint,
 * placePosts).
 */
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { clock } from './clock.js';
import { buildEvent, createCalendarClient } from './googleCalendar.js';
import { serialized } from './lock.js';
import { blackoutOn, fillSlots, fitsSlot, monthBlueprint, monthsFrom, oppositeColor, parseMonth } from './projection.js';
import { parseLocalDateTime } from './time.js';
import { blackoutsFor, colorAnchorsOf, fixedDays, postTypesOf, rulesOf } from './views.js';
// Events whose text was edited in Google Calendar keep that text until someone chooses
import { textHolds } from './notifications.js';
import { syncMonthsAhead } from '../settings.js';
let calendarClient = createCalendarClient();
// Latest calendar problems per platform; cleared when that platform syncs cleanly
const syncErrors = new Map();

/**
 * Calendar status for GET /api/status and POST /api/sync.
 *
 * Returns:
 *   lastSyncError     - { at, message } joining every platform's latest problems (at = the
 *                       newest), or null when every platform synced cleanly
 *   calendarConnected - true when a Calendar client is set up
 */
export const syncState = {
  get lastSyncError() {
    if (syncErrors.size === 0) return null;
    const errors = [...syncErrors.values()];
    return { at: errors.map((e) => e.at).sort().at(-1), message: errors.map((e) => e.message).join('; ') };
  },
  get calendarConnected() { return calendarClient !== null; },
};

/**
 * Replaces the Calendar client sync writes with (the tests pass a fake, or null for "not
 * configured"), and clears the stored errors.
 *
 * Takes:
 *   client - an object with createCalendarClient()'s shape (insert, patch, remove), or null
 */
export function setCalendarClient(client) {
  calendarClient = client;
  syncErrors.clear();
}

/**
 * A platform row as the app uses it: flags as booleans.
 *
 * Usage:
 *   const platform = parsePlatform(row);
 *
 * Returns:
 *   The row with enabled, isTest, paused and usesColors as booleans. The old postingDays and
 *   postingTimes columns are left out: schedule rules replaced them (views.js cadenceOf gives
 *   that shape where pages still want it).
 */
export function parsePlatform({ postingDays, postingTimes, ...row }) {
  return {
    ...row,
    enabled: Boolean(row.enabled),
    isTest: Boolean(row.isTest),
    paused: Boolean(row.paused),
    usesColors: Boolean(row.usesColors),
  };
}
const hash = (event) => createHash('sha256').update(JSON.stringify(event)).digest('hex');

/**
 * Brings one platform's slots, post times and calendar events up to date. Call it after any
 * change to a post, slot, platform, post type, schedule rule or blackout.
 *
 * Usage:
 *   await syncPlatform(db, platform.id);
 *   await syncPlatform(db, platform.id, { regenerate: true, months: ['2027-03'] });
 *
 * Takes:
 *   db         - the database
 *   platformId - the platform's id (an unknown id does nothing)
 *   options    - { months: extra "YYYY-MM" months to make slots for (besides the next
 *                syncMonthsAhead from settings.js), regenerate: true when the schedule rules,
 *                rotation or blackouts changed, so future unlocked slots are rebuilt }
 *
 * Returns:
 *   A promise that resolves when done. Database errors reject it; calendar errors do not
 *   (they are kept in syncState.lastSyncError and retried by the next sync).
 *
 * How it works:
 *   Queues syncPlatformNow behind any running sync, pull or dispatch (lock.js).
 *
 * When editing:
 *   Don't call it from inside another serialized job (it would wait on itself); call it after.
 */
export function syncPlatform(db, platformId, options = {}) {
  return serialized(() => syncPlatformNow(db, platformId, options));
}

/**
 * Attaches each rule's type changes (ruleTypeChange rows, oldest first), which the
 * slot panel's "This and later slots" and "Shift the rotation" choices store per rule and
 * which shape the slots monthBlueprint makes from then on.
 *
 * Usage:
 *   const rules = await withTypeChanges(db, (await rulesOf(db, platform.id)).filter((r) => r.active));
 *
 * Takes:
 *   rules - scheduleRule rows (rulesOf output)
 *
 * Returns:
 *   The rules with typeChanges: [ruleTypeChange rows ordered by date, id].
 */
export async function withTypeChanges(db, rules) {
  if (!rules.length) return rules;
  const changes = await db.all(`SELECT * FROM ruleTypeChange WHERE ruleId IN (${rules.map(() => '?').join(', ')})
                                ORDER BY date, id`, rules.map((r) => r.id));
  return rules.map((rule) => ({ ...rule, typeChanges: changes.filter((c) => c.ruleId === rule.id) }));
}

// Where the last sync's color anchors are kept, per platform (appSetting)
const anchorsKey = (platformId) => `colorAnchors.${platformId}`;
const anchorKey = (a) => `${a.date} ${a.time} ${a.color} ${a.blocksDay ? 'fixed' : 'kept'}`;

/**
 * Compares the platform's color anchors with the ones the last sync saw, and saves
 * the new list.
 *
 * Usage:
 *   const recolorFrom = await anchorsChanged(tx, platform.id, anchors);   // '2026-11-26' or null
 *
 * Takes:
 *   db       - the database (a transaction)
 *   anchors  - colorAnchorsOf output
 *
 * Returns:
 *   The earliest date of an anchor that was added, removed, moved or recolored since the last
 *   sync, or null when nothing changed.
 *
 * How it works:
 *   The list is stored as JSON text in appSetting "colorAnchors.<platformId>". No stored list
 *   counts as empty, so on the first sync after an upgrade every existing anchor counts as
 *   added (the existing Specific Date colors then shift later slots once).
 *
 * When editing:
 *   This is how every way of changing a Specific Date post (Compose, Library, Calendar, a move
 *   read back from Google Calendar, a failed send, the Archive page) reaches the colors, without
 *   each route asking for it. "key" is quoted because it is a reserved word in MariaDB.
 */
async function anchorsChanged(db, platformId, anchors) {
  const row = await db.get('SELECT value FROM appSetting WHERE "key" = ?', [anchorsKey(platformId)]);
  const before = new Set(row?.value ? JSON.parse(row.value) : []);
  const now = new Set(anchors.map(anchorKey));
  const changed = [...before].filter((k) => !now.has(k)).concat([...now].filter((k) => !before.has(k)));
  if (!changed.length) return null;
  await db.run('DELETE FROM appSetting WHERE "key" = ?', [anchorsKey(platformId)]);
  await db.run('INSERT INTO appSetting ("key", value) VALUES (?, ?)', [anchorsKey(platformId), JSON.stringify([...now])]);
  return changed.map((k) => k.slice(0, 10)).sort()[0];
}

/**
 * Makes sure the slot rows for the given months exist, from the platform's active rules.
 *
 * Takes:
 *   db         - the database (a transaction)
 *   platform   - parsed platform
 *   months     - ["YYYY-MM", ...]; repeats are fine
 *   nowIso     - now as an ISO string; only future slots are made or changed
 *   regenerate - true to also rebuild future slots after a schedule change
 *
 * How it works:
 *   1. Loads the rotation types, the active rules with their type changes, the blackouts, and
 *      the color anchors (Specific Date posts with a color, and kept slots).
 *   2. With regenerate, or when the color anchors changed since the last sync (anchorsChanged),
 *      also covers every month that already has future slots.
 *   3. For each month, makes the blueprint (projection.js) and leaves out past slots and
 *      blackout days. Blackout days get no slots; the others keep their place in the color
 *      and post type sequence, so adding or removing a blackout changes no other slot.
 *   4. With regenerate, each future slot that is neither locked nor pinned nor kept (with
 *      its post) either takes the blueprint's color, type, time and rule for its date and time,
 *      or is deleted when the blueprint has none there (its post goes back to the library).
 *      An empty kept slot is regenerated like any other and stops being kept.
 *   4b. Without regenerate: when the anchors changed, the same future slots from
 *      the earliest changed anchor's date on take the blueprint's color only (types and hand
 *      type changes stay). placePosts then sends the library posts whose color no longer fits
 *      back to the library, and they refill matching slots.
 *   5. Inserts the blueprint's slots; ones that already exist (same platform, date, time)
 *      are left as they are.
 *
 * When editing:
 *   Locked and pinned slots are hand choices, so regenerating leaves them as they are
 *   (not yet confirmed: a pinned slot stays put, at its old date and time, when the rules
 *   change). Kept slots are left as they are while they hold a post. "ON CONFLICT ... DO NOTHING" is rewritten for MariaDB by db/client.js; check it
 *   there if you change this INSERT.
 */
async function writeBlueprint(db, platform, months, nowIso, regenerate) {
  const types = (await postTypesOf(db, platform.id)).filter((type) => type.inRotation);
  const rules = await withTypeChanges(db, (await rulesOf(db, platform.id)).filter((rule) => rule.active));
  const blackouts = await blackoutsFor(db, platform.id);
  const anchors = await colorAnchorsOf(db, platform);
  const recolorFrom = await anchorsChanged(db, platform.id, anchors);
  const insert = `INSERT INTO slot (platformId, date, time, scheduledAt, color, postTypeId, ruleId)
                  VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (platformId, date, time) DO NOTHING`;
  if (regenerate || recolorFrom) {
    const withFuture = await db.all(`SELECT DISTINCT substr(date, 1, 7) AS month FROM slot
                                     WHERE platformId = ? AND scheduledAt > ?`, [platform.id, nowIso]);
    months = [...months, ...withFuture.map((r) => r.month)];
  }
  // Locked and pinned slots are hand choices, and kept slots hold a post someone chose to keep: never regenerated
  const futureUnlocked = `SELECT * FROM slot WHERE platformId = ? AND date LIKE ? AND scheduledAt > ?
                            AND locked = 0 AND pinned = 0 AND (kept = 0 OR postId IS NULL)`;

  for (const month of new Set(months)) {
    const [year, m] = parseMonth(month);
    const blueprint = monthBlueprint(platform, rules, types, year, m, config.timezone, anchors)
      .filter((s) => s.scheduledAt > nowIso && !blackoutOn(blackouts, s.date));
    const byKey = new Map(blueprint.map((s) => [`${s.date} ${s.time}`, s]));
    if (regenerate) {
      for (const slot of await db.all(futureUnlocked, [platform.id, `${month}-%`, nowIso])) {
        const next = byKey.get(`${slot.date} ${slot.time}`);
        if (next) {
          await db.run('UPDATE slot SET color = ?, postTypeId = ?, scheduledAt = ?, ruleId = ?, kept = 0 WHERE id = ?',
            [next.color, next.postTypeId, next.scheduledAt, next.ruleId, slot.id]);
        } else {
          await db.run('DELETE FROM slot WHERE id = ?', [slot.id]); // its post goes back to the library
        }
      }
    } else if (recolorFrom && month >= recolorFrom.slice(0, 7)) {
      // Only the color follows the anchors; placePosts frees posts that no longer fit
      for (const slot of await db.all(futureUnlocked, [platform.id, `${month}-%`, nowIso])) {
        const next = byKey.get(`${slot.date} ${slot.time}`);
        if (slot.date >= recolorFrom && next && next.color !== slot.color) {
          await db.run('UPDATE slot SET color = ? WHERE id = ?', [next.color, slot.id]);
        }
      }
    }
    for (const s of blueprint) await db.run(insert, [platform.id, s.date, s.time, s.scheduledAt, s.color, s.postTypeId, s.ruleId]);
  }
}

/**
 * Takes posts out of slots they no longer belong in, then fills the open future slots with
 * library posts.
 *
 * Takes:
 *   db         - the database (a transaction)
 *   platform   - parsed platform
 *   nowIso     - now as an ISO string
 *   scheduling - false when the platform schedules nothing (off, paused, or the Test platform
 *                outside test mode): posts are released but no slot is filled
 *
 * Returns:
 *   Every slot row of the platform, ordered by scheduledAt, with postId updated.
 *
 * How it works:
 *   1. For each slot holding a queued post (sent or failed posts stay in their slot as history):
 *      - a due slot (time passed): the post is the dispatcher's. It is released only if it
 *        doesn't belong (not this platform's library post), or it wasn't due (paused, or edited
 *        after its slot), since then it missed it. While not scheduling (paused or off), a
 *        missed post stays in its passed slot until the platform schedules again, so the
 *        resume can list it (views.js missedPosts); then it is released and refills.
 *      - a future slot: released if the post doesn't belong, or the slot is not locked and
 *        either its day has a Specific Date post, or (when not pinned) it is a blackout day or
 *        the post no longer fits it (type or color).
 *      Releasing also clears pinned.
 *   2. Clears pinned on every empty slot.
 *   3. When scheduling, fillSlots pairs the unplaced queued library posts with the open
 *      future slots (not locked, not blocked by a Specific Date post, not a blackout day).
 *
 * When editing:
 *   Regenerating removes the unlocked, unpinned slots on blackout days; any left over (a
 *   blackout written without a regenerate) lose their post and stay empty. Locked and pinned
 *   slots on a blackout day keep their post: they were placed by hand (the Calendar flags them).
 */
async function placePosts(db, platform, nowIso, scheduling) {
  const slots = await db.all('SELECT * FROM slot WHERE platformId = ? ORDER BY scheduledAt', [platform.id]);
  const postsInSlots = new Map((await db.all('SELECT post.* FROM post JOIN slot ON slot.postId = post.id WHERE slot.platformId = ?',
    [platform.id])).map((p) => [p.id, p]));
  const blocked = await fixedDays(db, platform.id);
  const blackouts = await blackoutsFor(db, platform.id);
  const blackedOut = (slot) => Boolean(blackoutOn(blackouts, slot.date));

  for (const slot of slots) {
    const post = slot.postId ? postsInSlots.get(slot.postId) : null;
    // Sent (or failed) posts stay in their slot as history
    if (!post || post.status !== 'queued') continue;
    const belongs = post.kind === 'library' && post.platformId === platform.id;
    let release;
    if (slot.scheduledAt <= nowIso) {
      // A due post is the dispatcher's; one that wasn't due missed it. While not
      // scheduling it stays in its passed slot, so resuming can list it as missed
      release = !belongs || (scheduling && (post.scheduledAt === null || post.scheduledAt > nowIso));
    } else {
      release = !belongs || (!slot.locked && (blocked.has(slot.date)
        || (!slot.pinned && (blackedOut(slot) || !fitsSlot(slot, post, platform.usesColors)))));
    }
    if (release) {
      await db.run('UPDATE slot SET postId = NULL, pinned = 0 WHERE id = ?', [slot.id]);
      slot.postId = null;
    }
  }
  await db.run('UPDATE slot SET pinned = 0 WHERE platformId = ? AND postId IS NULL AND pinned = 1', [platform.id]);
  if (!scheduling) return slots;
  const pool = await db.all(`SELECT * FROM post WHERE platformId = ? AND kind = 'library' AND status = 'queued'
                               AND (scheduledAt IS NULL OR scheduledAt > ?)
                               AND NOT EXISTS (SELECT 1 FROM slot WHERE slot.postId = post.id)`, [platform.id, nowIso]);
  const open = slots.filter((s) => !s.postId && !s.locked && s.scheduledAt > nowIso && !blocked.has(s.date) && !blackedOut(s));
  const byId = new Map(slots.map((s) => [s.id, s]));
  for (const { slotId, postId } of fillSlots(open, pool, platform.usesColors)) {
    await db.run('UPDATE slot SET postId = ? WHERE id = ?', [postId, slotId]);
    byId.get(slotId).postId = postId;
  }
  return slots;
}

/**
 * The sync itself (syncPlatform queues it). Run only inside the shared queue.
 *
 * How it works:
 *   1. Decides whether the platform schedules: disabled or paused platforms, and the Test
 *      platform outside test mode, schedule nothing. Their queued posts lose their time and
 *      calendar event, so the dispatcher sends none of them. Slots and their assignments are
 *      kept, so turning them back on restores the schedule (with new calendar events); a post
 *      whose slot passed meanwhile goes back to the library and fills the next matching slot
 *      (placePosts).
 *   2. In one transaction: writeBlueprint for this month onward (syncMonthsAhead) plus any
 *      requested months, placePosts, then works out each queued post's time. Posts whose time
 *      has come are the dispatcher's and are left out (rescheduling them would push them to a
 *      later slot), except while not scheduling: then posts already due but not sent yet are
 *      included too, so pausing stops them. Fixed posts go at fixedAt, library posts at their
 *      slot; unplaced ones have no time.
 *      A Specific Date post with no time whose date passed was held back by a pause (or the
 *      platform being off). Sending it late could be wrong (a holiday post), so it fails for a
 *      person to requeue.
 *      Every post's scheduledAt is saved here, first, so the app shows it even if the
 *      calendar is unreachable.
 *   3. Without a Calendar client, stops. Otherwise for each post: no time -> remove its event;
 *      no event yet -> insert one; event changed (by hash of buildEvent's output) -> patch it,
 *      with the stored etag. A post whose text was edited in Google Calendar and not settled
 *      yet (Notifications page, textHolds) only gets its time written.
 *   4. Records this platform's problems in syncErrors, or clears them; the next sync retries
 *      anything that failed.
 *
 * When editing:
 *   A 412 from patch means someone edited the event in Google Calendar. Their edit is kept;
 *   reading it back as a fixed date is two-way sync (calendarPull.js). It is reported but not
 *   logged as an error. The failed-post wording is what users see in the Library.
 */
async function syncPlatformNow(db, platformId, { months = [], regenerate = false } = {}) {
  const now = clock.now();
  const nowIso = now.toISOString();
  const row = await db.get('SELECT * FROM platform WHERE id = ?', [platformId]);
  if (!row) return;
  const platform = parsePlatform(row);
  const scheduling = platform.enabled && !platform.paused && (config.testMode || !platform.isTest);
  const schedule = await db.transaction(async (tx) => {
    await writeBlueprint(tx, platform, [...monthsFrom(now, syncMonthsAhead, config.timezone), ...months], nowIso, regenerate);
    const slots = await placePosts(tx, platform, nowIso, scheduling);
    const slotTime = new Map(slots.filter((s) => s.postId).map((s) => [s.postId, s.scheduledAt]));

    // Due posts are the dispatcher's, except while not scheduling (pausing stops them too)
    const posts = await tx.all(`SELECT post.*, postType.name AS postTypeName FROM post LEFT JOIN postType ON postType.id = post.postTypeId
                                WHERE post.platformId = ? AND post.status = 'queued'
                                  AND (post.scheduledAt IS NULL OR post.scheduledAt > ? OR ? = 0)`, [platformId, nowIso, scheduling ? 1 : 0]);
    const placed = [];
    for (const post of posts) {
      if (!scheduling) {
        placed.push({ post, slot: null });
        continue;
      }
      const at = post.kind === 'fixed' ? parseLocalDateTime(post.fixedAt, config.timezone)?.toISOString() : slotTime.get(post.id);
      // Held back past its date: fail it rather than send it late
      if (post.kind === 'fixed' && post.scheduledAt === null && at && at <= nowIso) {
        await tx.run(`UPDATE post SET status = 'failed', lastError = ?, updatedAt = datetime('now') WHERE id = ?`,
          [`Not sent: ${platform.name} was paused or turned off at ${post.fixedAt.replace('T', ' ')}. Requeue it with a new date.`, post.id]);
        placed.push({ post, slot: null });
        continue;
      }
      placed.push({ post, slot: at ? new Date(at) : null });
    }
    // Saved before any calendar call
    for (const { post, slot } of placed) await tx.run('UPDATE post SET scheduledAt = ? WHERE id = ?', [slot?.toISOString() ?? null, post.id]);
    return placed;
  });
  if (!calendarClient) return;

  const saveEvent = (values) => db.run('UPDATE post SET calendarEventId = ?, calendarEventHash = ?, calendarEventEtag = ? WHERE id = ?', values);
  const problems = [];
  const held = await textHolds(db);

  for (const { post, slot } of schedule) {
    const eventId = post.calendarEventId;
    try {
      if (!slot) {
        if (eventId) {
          await calendarClient.remove(eventId);
          await saveEvent([null, null, null, post.id]);
        }
        continue;
      }
      const media = post.mediaId ? await db.get('SELECT * FROM media WHERE id = ?', [post.mediaId]) : null;
      const event = buildEvent({ platform, post, media, slot });
      const eventHash = hash(event);
      if (!eventId) {
        const written = await calendarClient.insert(event);
        await saveEvent([written.id, eventHash, written.etag, post.id]);
      } else if (post.calendarEventHash !== eventHash) {
        // Text edited in Google Calendar and not settled yet: only the time is written
        const body = held.has(post.id) ? { start: event.start, end: event.end } : event;
        const written = await calendarClient.patch(eventId, body, post.calendarEventEtag);
        await saveEvent([eventId, eventHash, written.etag, post.id]);
      }
    } catch (err) {
      // 412: edited in Google Calendar; their edit is kept
      problems.push(err.code === 412
        ? `Post ${post.id}: event was edited in Google Calendar, so the app left it unchanged`
        : `Post ${post.id}: ${err.message}`);
      if (err.code !== 412) console.error('Calendar sync failed:', err);
    }
  }
  if (problems.length) syncErrors.set(platformId, { at: now.toISOString(), message: problems.join('; ') });
  else syncErrors.delete(platformId);
}

/**
 * Removes a post's calendar event, if it has one. Call before deleting the post row.
 *
 * Usage:
 *   await removeCalendarEvent(post);   // routes/posts.js
 *
 * Takes:
 *   post - the post row ({ calendarEventId })
 *
 * Returns:
 *   A promise; rejects on a Google error other than "already gone".
 *
 * When editing:
 *   Runs in the shared queue so it can't race a sync writing the same event.
 */
export function removeCalendarEvent(post) {
  return serialized(async () => {
    if (post.calendarEventId && calendarClient) await calendarClient.remove(post.calendarEventId);
  });
}

/**
 * The color to suggest for a Specific Date post, so the colors keep alternating:
 * the opposite of the previous item's color on that platform before the chosen time.
 *
 * Usage:
 *   const { color, previous } = await suggestColor(db, platform, '2026-11-26T10:00', { exceptPostId: 12 });
 *
 * Takes:
 *   platform     - parsed platform
 *   fixedAt      - local "YYYY-MM-DDTHH:MM" in the app's zone
 *   exceptPostId - optional; the post being edited, left out of the timeline
 *
 * Returns:
 *   { color: 'Blue' | 'Purple' | null, previous: { kind 'slot' | 'fixed' | 'kept', date, time,
 *   color, postId? } | null }. color is null on platforms without colors, or when nothing comes
 *   before. Throws a message for a bad fixedAt.
 *
 * How it works:
 *   1. Items before the time: the stored slots (the latest few) and, for this month and the
 *      one before, the slots the blueprint makes (for months not made yet; stored ones win),
 *      Specific Date posts with a color, and kept slots (colorAnchorsOf).
 *   2. Leaves out library slots on the chosen day (the new post takes that day) and on days
 *      that already have a Specific Date post with a color, and blackout days.
 *   3. The latest one wins; the suggestion is its opposite color.
 *
 * When editing:
 *   Uses the same anchors and blueprint as writeBlueprint, so the suggestion matches what
 *   the calendar does once the post is saved. Reads only; nothing is written.
 */
export async function suggestColor(db, platform, fixedAt, { exceptPostId = null } = {}) {
  const at = parseLocalDateTime(fixedAt, config.timezone);
  if (!at) throw 'at must be a local date and time, "YYYY-MM-DDTHH:MM"';
  if (!platform.usesColors) return { color: null, previous: null };
  const atIso = at.toISOString();
  const date = fixedAt.slice(0, 10);
  const nowIso = clock.now().toISOString();
  const anchors = await colorAnchorsOf(db, platform, { exceptPostId });
  const blackouts = await blackoutsFor(db, platform.id);
  const blockedDays = new Set([date, ...anchors.filter((a) => a.blocksDay).map((a) => a.date)]);
  const types = (await postTypesOf(db, platform.id)).filter((type) => type.inRotation);
  const rules = await withTypeChanges(db, (await rulesOf(db, platform.id)).filter((rule) => rule.active));

  const slots = new Map();
  const [year, month] = parseMonth(date.slice(0, 7));
  for (const [y, m] of [[month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1], [year, month]]) {
    for (const s of monthBlueprint(platform, rules, types, y, m, config.timezone, anchors)) {
      if (s.scheduledAt > nowIso && !blackoutOn(blackouts, s.date)) slots.set(`${s.date} ${s.time}`, s);
    }
  }
  const stored = await db.all(`SELECT date, time, scheduledAt, color, kept FROM slot
                               WHERE platformId = ? AND scheduledAt < ? AND color IS NOT NULL
                               ORDER BY scheduledAt DESC LIMIT 50`, [platform.id, atIso]);
  for (const s of stored) slots.set(`${s.date} ${s.time}`, s);

  const items = [
    ...[...slots.values()].filter((s) => s.scheduledAt < atIso && (s.kept || !blockedDays.has(s.date)))
      .map((s) => ({ kind: s.kept ? 'kept' : 'slot', date: s.date, time: s.time, color: s.color, at: s.scheduledAt })),
    ...anchors.filter((a) => a.blocksDay)
      .map((a) => ({ kind: 'fixed', date: a.date, time: a.time, color: a.color, postId: a.postId,
        at: parseLocalDateTime(`${a.date}T${a.time}`, config.timezone).toISOString() }))
      .filter((a) => a.at < atIso),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const previous = items.at(-1);
  if (!previous) return { color: null, previous: null };
  const { at: _at, ...shown } = previous;
  return { color: oppositeColor(previous.color), previous: shown };
}

/**
 * Which posts already on the calendar a schedule rule change would move, before
 * it is saved (for the Platforms page's "Move posts / Keep posts" choice).
 *
 * Usage:
 *   const { moving, onCalendar } = await ruleChangeImpact(db, platform, proposedRules);
 *
 * Takes:
 *   platform - parsed platform
 *   rules    - the platform's schedule rules as they would be after the change (rulesOf shape;
 *              a new rule may have id 0)
 *
 * Returns:
 *   { onCalendar, moving: [{ slotId, postId, date, time }] }
 *   onCalendar - future slots (not locked, pinned or kept) holding a queued post
 *   moving     - those whose slot would go away, or would want another type or color, so
 *                regenerating would send the post back to the library
 *
 * How it works:
 *   Makes the new rules' blueprint for each month with such a slot (with the current color
 *   anchors and blackouts) and checks each post against the blueprint slot at its date and time
 *   (fitsSlot). Reads only.
 *
 * When editing:
 *   Must follow writeBlueprint's regenerate step, or the count shown would not match what
 *   "Move posts" does.
 */
export async function ruleChangeImpact(db, platform, rules) {
  const nowIso = clock.now().toISOString();
  const types = (await postTypesOf(db, platform.id)).filter((type) => type.inRotation);
  const active = await withTypeChanges(db, rules.filter((rule) => rule.active));
  const blackouts = await blackoutsFor(db, platform.id);
  const anchors = await colorAnchorsOf(db, platform);
  const held = await db.all(`SELECT slot.id AS slotId, slot.date, slot.time, post.id AS postId, post.postTypeId, post.color
                             FROM slot JOIN post ON post.id = slot.postId
                             WHERE slot.platformId = ? AND slot.scheduledAt > ? AND slot.locked = 0 AND slot.pinned = 0
                               AND slot.kept = 0 AND post.status = 'queued'
                             ORDER BY slot.scheduledAt`, [platform.id, nowIso]);
  const blueprint = new Map();
  for (const month of new Set(held.map((h) => h.date.slice(0, 7)))) {
    const [year, m] = parseMonth(month);
    for (const s of monthBlueprint(platform, active, types, year, m, config.timezone, anchors)) {
      if (!blackoutOn(blackouts, s.date)) blueprint.set(`${s.date} ${s.time}`, s);
    }
  }
  const moving = held.filter((h) => {
    const next = blueprint.get(`${h.date} ${h.time}`);
    return !next || !fitsSlot(next, h, platform.usesColors);
  }).map(({ slotId, postId, date, time }) => ({ slotId, postId, date, time }));
  return { onCalendar: held.length, moving };
}

/**
 * Syncs every platform, one after another (the scheduler tick in routes/system.js uses it).
 *
 * Usage:
 *   await syncAll(db);
 *
 * Takes:
 *   options - passed to each syncPlatform ({ months, regenerate })
 */
export async function syncAll(db, options) {
  for (const { id } of await db.all('SELECT id FROM platform')) await syncPlatform(db, id, options);
}
