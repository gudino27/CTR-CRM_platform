// Recomputes the projected schedule and mirrors it to Google Calendar.
// Every route that changes a post or platform calls syncPlatform afterwards.
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { clock } from './clock.js';
import { buildEvent, createCalendarClient } from './googleCalendar.js';
import { serialized } from './lock.js';
import { projectPlatform } from './projection.js';

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
    postingDays: JSON.parse(row.postingDays),
    postingTimes: JSON.parse(row.postingTimes),
  };
}

const hash = (event) => createHash('sha256').update(JSON.stringify(event)).digest('hex');

/** Reprojects the platform's queue and inserts/patches/deletes its calendar events. */
export function syncPlatform(db, platformId) {
  return serialized(() => syncPlatformNow(db, platformId));
}

async function syncPlatformNow(db, platformId) {
  const now = clock.now();
  const row = db.prepare('SELECT * FROM platform WHERE id = ?').get(platformId);
  if (!row) return;
  const platform = parsePlatform(row);

  // Posts whose slot has come are the dispatcher's; reprojecting them would push them to a later slot
  const posts = db.prepare(`SELECT * FROM post WHERE platformId = ? AND status = 'queued'
                            AND (scheduledAt IS NULL OR scheduledAt > ?)`).all(platformId, now.toISOString());
  const byId = new Map(posts.map((p) => [p.id, p]));
  // Disabled platforms, and the Test platform outside test mode, get no slots
  const active = platform.enabled && (config.testMode || !platform.isTest);
  const projection = active
    ? projectPlatform(platform, posts, now, config.timezone)
    : posts.map((p) => ({ postId: p.id, slot: null }));

  // The projection is saved first so the app shows it even if the calendar is unreachable
  const saveSlot = db.prepare('UPDATE post SET scheduledAt = ? WHERE id = ?');
  for (const { postId, slot } of projection) saveSlot.run(slot?.toISOString() ?? null, postId);
  if (!calendarClient) return;

  const saveEvent = db.prepare('UPDATE post SET calendarEventId = ?, calendarEventHash = ?, calendarEventEtag = ? WHERE id = ?');
  const mediaById = db.prepare('SELECT * FROM media WHERE id = ?');
  const problems = [];

  for (const { postId, slot } of projection) {
    const post = byId.get(postId);
    const eventId = post.calendarEventId;
    try {
      if (!slot) {
        if (eventId) {
          await calendarClient.remove(eventId);
          saveEvent.run(null, null, null, postId);
        }
        continue;
      }
      const media = post.mediaId ? mediaById.get(post.mediaId) : null;
      const event = buildEvent({ platform, post, media, slot });
      const eventHash = hash(event);
      if (!eventId) {
        const written = await calendarClient.insert(event);
        saveEvent.run(written.id, eventHash, written.etag, postId);
      } else if (post.calendarEventHash !== eventHash) {
        const written = await calendarClient.patch(eventId, event, post.calendarEventEtag);
        saveEvent.run(eventId, eventHash, written.etag, postId);
      }
    } catch (err) {
      // 412: someone edited the event in Google Calendar. Their edit is kept;
      // reading it back as an override date is Sprint 5 two-way sync.
      problems.push(err.code === 412
        ? `Post ${postId}: event was edited in Google Calendar, so the app left it unchanged`
        : `Post ${postId}: ${err.message}`);
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

export async function syncAll(db) {
  for (const { id } of db.prepare('SELECT id FROM platform').all()) await syncPlatform(db, id);
}
