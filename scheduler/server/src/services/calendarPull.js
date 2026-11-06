/**
 * Two-way calendar sync: reads back changes people make by hand in Google Calendar to the
 * app's events, and applies them to the posts (sync.js writes the other way).
 *   - An event moved to another date or time: the post gets that date and time.
 *     A Library post becomes a Specific Date post there (as when someone sets a date on the
 *     Library page); a Specific Date post just changes fixedAt.
 *   - An event deleted: a Library post's day is skipped (its slot is locked empty, so it is
 *     not refilled) and the post goes back to the library to fill its next matching slot.
 *     A Specific Date post goes back to the library too when its
 *     post type is in the rotation (Holiday is not), otherwise it is failed with a reason so
 *     someone picks a new date.
 *   - Posts that were sent (or are being sent, or failed) are never changed.
 * Only events the app made count: the event id stored on a queued post (and, where Google
 * sends it, the postId private property buildEvent sets).
 * The app's own writes do not echo back: sync.js stores the etag Google gave each write, and
 * an event whose etag still matches was last written by the app.
 * Notifications (services/notifications.js): a move onto a blackout day or within collisionMs
 * (settings.js, 2 hours) of another Specific Date post, a hand edit of an event's text (kept
 * until someone chooses which caption to use), a skipped day, and posts it fails.
 * Reads are incremental (Google's syncToken, kept in appSetting); when Google says the token
 * expired (410 Gone), or the calendar changed, everything is read again.
 *
 * What lives here: pullCalendar (the entry point, run every calendarPullMs by index.js and by
 * POST /api/sync), pullState, setPullCalendarClient, DELETED_REASON, and the steps it uses.
 */
import { config } from '../config.js';
import { clock } from './clock.js';
import { createCalendarClient } from './googleCalendar.js';
import { serialized } from './lock.js';
import { syncPlatform } from './sync.js';
import { writeAudit } from './access.js';
import { localDateTimeString, parseLocalDateTime } from './time.js';
import { blackoutOn } from './projection.js';
import { blackoutsFor } from './views.js';
import { checkTextEdit, dayText, notify, notifyFailures, postLabel, whenText } from './notifications.js';
// Fixed posts on one platform this close together clash (as in Compose, routes/posts.js)
import { collisionMs } from '../settings.js';

const TOKEN_KEY = 'calendarPullSyncToken';
const FROM_GOOGLE = 'From Google Calendar';
// The lastError of a Specific Date post failed because its event was deleted
export const DELETED_REASON = 'Its calendar event was deleted; pick a new date';
// The collision window in words for the clash notification ("2 hours"), built from collisionMs
const collisionHours = collisionMs / 3_600_000;
const collisionText = `${collisionHours} hour${collisionHours === 1 ? '' : 's'}`;

let calendarClient = createCalendarClient();
// Latest problem reading the calendar back ({ at, message }); cleared by the next clean read
export const pullState = { lastPullError: null };

/**
 * Replaces the Calendar client the pull reads with (the tests pass a fake, or null for
 * "not configured"), and clears the last pull error.
 *
 * Takes:
 *   client - an object with createCalendarClient()'s shape (list and read are used), or null
 */
export function setPullCalendarClient(client) {
  calendarClient = client;
  pullState.lastPullError = null;
}

const isGone = (err) => err?.code === 410 || err?.status === 410 || err?.response?.status === 410;
const shown = (fixedAt) => fixedAt.replace('T', ' ');

/**
 * The syncToken saved by the last pull, or null to read everything.
 *
 * How it works:
 *   Reads appSetting calendarPullSyncToken ({ calendarId, syncToken } as JSON). A token
 *   belongs to one calendar (test mode switches calendars), so one saved for another
 *   calendar, or unreadable JSON, counts as none.
 */
async function savedToken(db) {
  const row = await db.get('SELECT value FROM appSetting WHERE "key" = ?', [TOKEN_KEY]);
  if (!row?.value) return null;
  try {
    const saved = JSON.parse(row.value);
    return saved.calendarId === config.google.calendarId ? saved.syncToken : null;
  } catch {
    return null;
  }
}

/**
 * Stores the token for the next pull (with the calendar it belongs to), or removes it when
 * syncToken is empty.
 *
 * When editing:
 *   Delete then insert in one transaction works the same on SQLite and MariaDB. "key" is a
 *   reserved word in MariaDB, so it stays quoted.
 */
async function saveToken(db, syncToken) {
  const value = syncToken ? JSON.stringify({ calendarId: config.google.calendarId, syncToken }) : null;
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM appSetting WHERE "key" = ?', [TOKEN_KEY]);
    if (value) await tx.run('INSERT INTO appSetting ("key", value) VALUES (?, ?)', [TOKEN_KEY, value]);
  });
}

/**
 * Every changed event since syncToken (all events without one), and the token for next time.
 *
 * Returns:
 *   { items, nextSyncToken } after following every page. Errors from Google are thrown
 *   (a 410 means the token expired).
 */
async function readChanges(syncToken) {
  const items = [];
  let pageToken = null;
  for (;;) {
    const page = await calendarClient.list({ syncToken, pageToken });
    items.push(...page.items);
    if (page.nextPageToken) {
      pageToken = page.nextPageToken;
      continue;
    }
    return { items, nextSyncToken: page.nextSyncToken };
  }
}

/**
 * The instant an event starts.
 *
 * Takes:
 *   event   - a Google event
 *   current - the post's current time in the app (a Date), used for all-day events
 *
 * Returns:
 *   A Date, or null when the event has no usable start. An all-day event keeps the post's
 *   local time on its new day.
 */
function eventStart(event, current) {
  if (event.start?.dateTime) return new Date(event.start.dateTime);
  if (event.start?.date && current) {
    const time = localDateTimeString(current, config.timezone).slice(11);
    return parseLocalDateTime(`${event.start.date}T${time}`, config.timezone);
  }
  return null;
}

/**
 * Applies one event to its post, if it is one of the app's events and someone else changed it.
 *
 * Takes:
 *   db      - the database
 *   event   - a Google event from list()
 *   skipped - array; a skipped library day is pushed onto it as { post, slot }
 *
 * Returns:
 *   The post's platformId when something changed (that platform then syncs), else null.
 *
 * How it works:
 *   Finds the queued post holding this event id (and, when the event carries one, the same
 *   postId private property). Skips posts that are sent, being sent or failed (history, left
 *   as it is), and versions the app wrote itself (an echo of its own insert or patch: the
 *   etag matches). A cancelled event goes to applyDelete, anything else to applyMove.
 */
async function applyEvent(db, event, skipped) {
  if (!event?.id) return null;
  const post = await db.get('SELECT * FROM post WHERE calendarEventId = ?', [event.id]);
  if (!post) return null;
  const ownerId = event.extendedProperties?.private?.postId;
  if (ownerId !== undefined && ownerId !== String(post.id)) return null;
  // Sent, being sent or failed: history, never changed
  if (post.status !== 'queued') return null;
  // The app wrote this version itself
  if (event.status !== 'cancelled' && event.etag && event.etag === post.calendarEventEtag) return null;

  return event.status === 'cancelled' ? applyDelete(db, post, skipped) : applyMove(db, post, event);
}

/**
 * Handles an app event deleted by hand in Google Calendar.
 *
 * Returns:
 *   The post's platformId.
 *
 * How it works:
 *   In one transaction:
 *   - Library post: skips that day. Its slot is locked empty (as a person locks an empty slot
 *     on the Calendar), so nothing refills it; unlocking it there gives the day back. The post
 *     goes back to the library (no time) and fills its next matching slot like any other
 *     library post. The slot is pushed onto `skipped` for a daySkipped notification.
 *   - Specific Date post that can be a library post (a rotation type, and a color where the
 *     platform uses colors): goes back to the library.
 *   - Any other Specific Date post: failed with DELETED_REASON so someone picks a new date.
 *   In every case the post forgets its event (id, hash, etag), an audit row
 *   (post.calendarDelete) is written, and an open calendarTextEdit notification for it is
 *   closed: the event is gone, so there is nothing left to choose about.
 *
 * When editing:
 *   The wording of the audit summaries is what the Audit log shows.
 */
async function applyDelete(db, post, skipped) {
  const platform = await db.get('SELECT usesColors FROM platform WHERE id = ?', [post.platformId]);
  const type = post.postTypeId ? await db.get('SELECT inRotation FROM postType WHERE id = ?', [post.postTypeId]) : null;
  const fitsLibrary = type && type.inRotation && (!platform?.usesColors || post.color);
  let summary;

  await db.transaction(async (tx) => {
    const forget = `calendarEventId = NULL, calendarEventHash = NULL, calendarEventEtag = NULL, updatedAt = datetime('now')`;
    if (post.kind === 'library') {
      // Locked empty so the day stays skipped
      const slot = await tx.get('SELECT * FROM slot WHERE postId = ?', [post.id]);
      await tx.run('UPDATE slot SET postId = NULL, pinned = 0, locked = 1 WHERE postId = ?', [post.id]);
      if (slot) skipped.push({ post, slot });
      await tx.run(`UPDATE post SET scheduledAt = NULL, ${forget} WHERE id = ?`, [post.id]);
      summary = `${FROM_GOOGLE}: its event was deleted, so the post went back to the library`;
    } else if (fitsLibrary) {
      await tx.run(`UPDATE post SET kind = 'library', fixedAt = NULL, scheduledAt = NULL, ${forget} WHERE id = ?`, [post.id]);
      summary = `${FROM_GOOGLE}: its event was deleted, so the Specific Date post (${shown(post.fixedAt)}) went back to the library`;
    } else {
      await tx.run(`UPDATE post SET status = 'failed', lastError = ?, ${forget} WHERE id = ?`, [DELETED_REASON, post.id]);
      summary = `${FROM_GOOGLE}: its event was deleted, so the Specific Date post (${shown(post.fixedAt)}) needs a new date`;
    }
    await writeAudit(tx, { action: 'post.calendarDelete', entityType: 'post', entityId: post.id, summary });
    await tx.run(`UPDATE notification SET resolvedAt = datetime('now') WHERE kind = 'calendarTextEdit' AND postId = ? AND resolvedAt IS NULL`,
      [post.id]);
  });
  return post.platformId;
}

/**
 * Handles an app event edited by hand in Google Calendar (moved, or its text changed).
 *
 * Returns:
 *   The post's platformId when the post was moved or failed, otherwise null.
 *
 * How it works:
 *   1. Works out where the app has the post: a fixed post at fixedAt, a library post at its
 *      slot. An unplaced library post's event is about to be removed by sync anyway: nothing to do.
 *   2. checkTextEdit (notifications.js): a changed title or description is not overwritten;
 *      it waits for someone to choose.
 *   3. Same start time: only the text (or some other field) was edited, so stop here.
 *   4. In one transaction, with an audit row (post.calendarMove):
 *      - moved to a time that has already passed: the post fails with a reason, since sending
 *        it right away could surprise someone; a person picks the new date.
 *      - otherwise it becomes (or stays) a Specific Date post at the new local time; a
 *        library post leaves its slot.
 *      Either way it takes Google's etag, which lets the next sync update the event without a 412.
 *   5. For a future time, notifyClash warns about a blackout day or a nearby fixed post.
 */
async function applyMove(db, post, event) {
  const slot = await db.get('SELECT scheduledAt FROM slot WHERE postId = ?', [post.id]);
  const appTime = post.kind === 'fixed' ? parseLocalDateTime(post.fixedAt, config.timezone)
    : slot ? new Date(slot.scheduledAt) : null;
  if (!appTime) return null;
  const start = eventStart(event, appTime);
  await checkTextEdit(db, post, event, appTime);
  if (!start || Number.isNaN(start.getTime()) || start.getTime() === appTime.getTime()) return null;

  const fixedAt = localDateTimeString(start, config.timezone);
  let summary;
  await db.transaction(async (tx) => {
    if (start <= clock.now()) {
      // Never sent right away: a person picks the new date
      await tx.run(`UPDATE post SET status = 'failed', lastError = ?, calendarEventEtag = ?, updatedAt = datetime('now') WHERE id = ?`,
        [`Its calendar event was moved to ${shown(fixedAt)}, which has already passed; pick a new date`, event.etag ?? null, post.id]);
      summary = `${FROM_GOOGLE}: moved to ${shown(fixedAt)}, which has already passed, so it needs a new date`;
    } else {
      if (post.kind === 'library') await tx.run('UPDATE slot SET postId = NULL, pinned = 0 WHERE postId = ?', [post.id]);
      await tx.run(`UPDATE post SET kind = 'fixed', fixedAt = ?, scheduledAt = NULL, calendarEventEtag = ?, updatedAt = datetime('now')
                    WHERE id = ?`, [fixedAt, event.etag ?? null, post.id]);
      summary = post.kind === 'library'
        ? `${FROM_GOOGLE}: moved to ${shown(fixedAt)}, so it is now a Specific Date post`
        : `${FROM_GOOGLE}: moved from ${shown(post.fixedAt)} to ${shown(fixedAt)}`;
    }
    await writeAudit(tx, { action: 'post.calendarMove', entityType: 'post', entityId: post.id, summary });
  });
  if (start > clock.now()) await notifyClash(db, post, start, fixedAt);
  return post.platformId;
}

/**
 * The checks Compose makes, on a move made in Google Calendar: a blackout day, or another
 * Specific Date post on the platform within collisionMs (settings.js). The move stays; a
 * calendarClash notification says what clashes.
 *
 * Takes:
 *   post    - the post as it was before the move
 *   start   - the new start (Date)
 *   fixedAt - the new local "YYYY-MM-DDTHH:MM"
 *
 * Returns:
 *   Nothing; writes no notification when nothing clashes.
 *
 * When editing:
 *   The "2 hours" in the message comes from collisionMs (collisionText above).
 */
async function notifyClash(db, post, start, fixedAt) {
  const blackout = blackoutOn(await blackoutsFor(db, post.platformId), fixedAt.slice(0, 10));
  const others = (await db.all(`SELECT * FROM post WHERE platformId = ? AND kind = 'fixed' AND status != 'failed' AND id != ?`,
    [post.platformId, post.id]))
    .filter((other) => Math.abs(parseLocalDateTime(other.fixedAt, config.timezone).getTime() - start.getTime()) < collisionMs)
    .sort((a, b) => a.fixedAt.localeCompare(b.fixedAt));
  if (!blackout && others.length === 0) return;
  const platform = await db.get('SELECT name FROM platform WHERE id = ?', [post.platformId]);
  const problems = [];
  if (blackout) problems.push(`it is a blackout day${blackout.reason ? ` (${blackout.reason})` : ''}`);
  for (const other of others) {
    problems.push(`it is within ${collisionText} of ${postLabel(other)} at ${whenText(parseLocalDateTime(other.fixedAt, config.timezone))}`);
  }
  await notify(db, {
    kind: 'calendarClash',
    postId: post.id,
    platformId: post.platformId,
    title: `${platform.name} post moved in Google Calendar onto a ${blackout ? 'blackout day' : 'busy time'}`,
    body: `${postLabel(post)[0].toUpperCase()}${postLabel(post).slice(1)} was moved in Google Calendar to ${whenText(start)}, `
      + `but ${problems.join(', and ')}. The move was applied; change the date if it should not go out then.`,
    data: {
      fixedAt,
      blackout: blackout ? { id: blackout.id, startDate: blackout.startDate, endDate: blackout.endDate, reason: blackout.reason } : null,
      clashes: others.map((other) => ({ postId: other.id, fixedAt: other.fixedAt })),
    },
  });
}

/**
 * Writes the daySkipped notification for a deleted library event, after the sync placed the
 * post again: "Skipped Tue, Oct 6 on Instagram because its calendar event was deleted; ...".
 *
 * Takes:
 *   { post, slot } - as pushed by applyDelete (the post before, the slot it left)
 *
 * When editing:
 *   Must run after syncPlatform, since it reads the post's new scheduledAt to say where it went.
 */
async function notifySkipped(db, { post, slot }) {
  const platform = await db.get('SELECT name FROM platform WHERE id = ?', [post.platformId]);
  const now = await db.get('SELECT * FROM post WHERE id = ?', [post.id]);
  const day = dayText(new Date(slot.scheduledAt));
  const next = now?.scheduledAt ? `moves to ${whenText(new Date(now.scheduledAt))}`
    : 'waits in the library for its next matching slot';
  await notify(db, {
    kind: 'daySkipped',
    postId: post.id,
    platformId: post.platformId,
    title: `Skipped ${day} on ${platform.name}`,
    body: `Skipped ${day} on ${platform.name} because its calendar event was deleted; ${postLabel(post)} ${next}. `
      + 'The empty slot is locked on the Calendar; unlock it there to use that day again.',
    data: { slotId: slot.id, skippedAt: slot.scheduledAt, newScheduledAt: now?.scheduledAt ?? null },
  });
}

/**
 * One read of the calendar, applying every change. Runs inside the shared queue (lock.js).
 *
 * Returns:
 *   { platforms: Set of changed platformIds, full: true when everything was read, skipped }.
 *   Throws on Google or database errors.
 *
 * How it works:
 *   Reads changes since the saved token; on 410 Gone (the token expired) reads everything
 *   again. Applies each event, then saves the new token.
 *
 * When editing:
 *   The token is saved only after every change was applied, so a failure reads the same
 *   changes again; keep that order.
 */
async function pullNow(db) {
  let syncToken = await savedToken(db);
  let changes;
  try {
    changes = await readChanges(syncToken);
  } catch (err) {
    if (!syncToken || !isGone(err)) throw err;
    syncToken = null;
    changes = await readChanges(null);
  }
  const platforms = new Set();
  const skipped = [];
  for (const event of changes.items) {
    const platformId = await applyEvent(db, event, skipped);
    if (platformId !== null) platforms.add(platformId);
  }
  // Only after every change was applied
  await saveToken(db, changes.nextSyncToken);
  return { platforms, full: !syncToken, skipped };
}

/**
 * Reads back hand edits from Google Calendar, then syncs the platforms they touched (freed
 * slots refill; assignments elsewhere stay as they are).
 *
 * Usage:
 *   setInterval(() => pullCalendar(db), calendarPullMs);   // index.js; also POST /api/sync
 *
 * Returns:
 *   { changed, full } (how many platforms changed, whether everything was read), or null when
 *   the calendar is not configured or the pull failed. Never throws: problems are logged and
 *   kept in pullState.lastPullError ({ at, message }), and the next pull tries again.
 *
 * How it works:
 *   1. pullNow runs in the same queue as sync and dispatch, so it never reads an event the
 *      app is halfway through writing.
 *   2. syncPlatform for each changed platform (outside the queue job, since it queues itself).
 *   3. Notifications that need the new schedule (where a skipped day's post went), then
 *      notifyFailures for posts it failed.
 *
 * When editing:
 *   Calling syncPlatform inside the serialized job would wait on itself forever.
 */
export async function pullCalendar(db) {
  if (!calendarClient) return null;
  try {
    const { platforms, full, skipped } = await serialized(() => pullNow(db));
    for (const platformId of platforms) await syncPlatform(db, platformId);
    for (const skip of skipped) await notifySkipped(db, skip);
    await notifyFailures(db);
    pullState.lastPullError = null;
    return { changed: platforms.size, full };
  } catch (err) {
    console.error('Reading Google Calendar changes failed:', err);
    pullState.lastPullError = { at: clock.now().toISOString(), message: err.message };
    return null;
  }
}
