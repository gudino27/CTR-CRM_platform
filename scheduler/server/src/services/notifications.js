/**
 * Notification area: things people should see without going
 * looking, listed on the Notifications page with a count on the bell in the header.
 *   calendarClash    a move made in Google Calendar landed on a blackout day, or within
 *                    collisionMs (settings.js, 2 hours) of another Specific Date post on that
 *                    platform (the move stays)
 *   calendarTextEdit someone changed an app event's text in Google Calendar. The app does not
 *                    overwrite it (sync.js writes only the time) until someone picks
 *                    "Use Google's caption" or "Keep the app's caption" (resolveTextEdit)
 *   postFailed       a post failed to send (dispatcher or n8n), or calendar sync needs a
 *                    new date for it; one per failure, closed when the post is requeued
 *   daySkipped       a deleted calendar event made the app skip that day (calendarPull.js)
 * Read state is shared by everyone (one readAt per notification), which keeps it simple.
 *
 * What lives here: notify and openNotification (writing and finding rows), notificationView,
 * text helpers (postLabel, dayText, whenText), the failed-post scan (notifyFailures), and the
 * calendar text-edit flow (textHolds, descriptionText, captionFromDescription, checkTextEdit,
 * resolveTextEdit).
 */
import { absoluteUrl, config } from '../config.js';
import { buildEvent } from './googleCalendar.js';
import { writeAudit } from './access.js';
import { notificationCaptionChars } from '../settings.js';

// The notification.kind values the app writes
export const KINDS = ['calendarClash', 'calendarTextEdit', 'postFailed', 'daySkipped'];

/**
 * A notification row as the API returns it: data parsed from its JSON text.
 *
 * Usage:
 *   notificationView(await db.get('SELECT * FROM notification WHERE id = ?', [id]))   // routes/notifications.js
 *
 * Returns:
 *   The row with data as an object (or null), or null when row is empty.
 */
export const notificationView = (row) => (row ? { ...row, data: row.data ? JSON.parse(row.data) : null } : null);

/**
 * A short name for a post in a notification: its number and the start of its caption.
 *
 * Usage:
 *   postLabel(post)   // -> 'post 12 ("Join us this Saturday for the garden...")'
 *
 * Takes:
 *   post - { id, caption }
 *
 * Returns:
 *   'post <id> ("<caption start>")', or 'post <id>' with no caption. The caption's spaces are
 *   squeezed and it is cut to notificationCaptionChars (settings.js), ending in "...".
 */
export function postLabel(post) {
  const caption = (post.caption ?? '').replace(/\s+/g, ' ').trim();
  const start = caption.length > notificationCaptionChars ? `${caption.slice(0, notificationCaptionChars - 3)}...` : caption;
  return start ? `post ${post.id} ("${start}")` : `post ${post.id}`;
}

// Made on each call (not cached), so they always follow config.timezone
const dayFormat = () => new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, weekday: 'short', month: 'short', day: 'numeric' });
const timeFormat = () => new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

/**
 * A day in words, in the app time zone, for notification text.
 *
 * Usage:
 *   dayText(new Date(slot.scheduledAt))   // -> 'Tue, Oct 6'
 */
export const dayText = (date) => dayFormat().format(date);

/**
 * A day and time in words, in the app time zone, for notification text.
 *
 * Usage:
 *   whenText(start)   // -> 'Tue, Oct 6 at 12:00 PM EDT'
 */
export const whenText = (date) => `${dayText(date)} at ${timeFormat().format(date)}`;

/**
 * Adds a notification.
 *
 * Usage:
 *   await notify(db, { kind: 'daySkipped', postId, platformId, title, body, data });
 *
 * Takes:
 *   kind       - one of KINDS
 *   postId     - the post it is about, or null
 *   platformId - the platform, or null
 *   title      - one line; cut at 250 characters to fit the notification.title column
 *   body       - the full text ('' by default)
 *   data       - anything JSON-able the page needs (stored as JSON text), or null
 *
 * Returns:
 *   The new notification's id.
 *
 * When editing:
 *   lastInsertRowid comes from db/client.js on both SQLite and MariaDB.
 */
export async function notify(db, { kind, postId = null, platformId = null, title, body = '', data = null }) {
  const { lastInsertRowid } = await db.run('INSERT INTO notification (kind, postId, platformId, title, body, data) VALUES (?, ?, ?, ?, ?, ?)',
    [kind, postId, platformId, title.slice(0, 250), body, data === null ? null : JSON.stringify(data)]);
  return lastInsertRowid;
}

/**
 * The open (unresolved) notification of that kind about a post, if any (the newest one).
 *
 * Usage:
 *   const open = await openNotification(db, 'calendarTextEdit', post.id);
 *
 * Returns:
 *   A promise for the row, or undefined.
 */
export const openNotification = (db, kind, postId) =>
  db.get('SELECT * FROM notification WHERE kind = ? AND postId = ? AND resolvedAt IS NULL ORDER BY id DESC', [kind, postId]);

/**
 * The posts whose event text was edited in Google Calendar and still waits for a choice;
 * sync.js writes only their time.
 *
 * Usage:
 *   const held = await textHolds(db);   // held.has(post.id)
 *
 * Returns:
 *   A Set of post ids.
 */
export async function textHolds(db) {
  const rows = await db.all("SELECT DISTINCT postId FROM notification WHERE kind = 'calendarTextEdit' AND resolvedAt IS NULL AND postId IS NOT NULL");
  return new Set(rows.map((r) => r.postId));
}

// ---- Failed posts (3c) ----

// One scan at a time, so the bell and the background timer never add the same failure twice
let scanning = Promise.resolve();

/**
 * Adds a notification for every failed post that has no open one, and closes the open ones
 * whose post is no longer failed (requeued or deleted), so a later failure gets its own.
 * Failures come from the dispatcher, n8n's status callback, sync.js and calendarPull.js;
 * scanning catches them all without hooking each place.
 *
 * Usage:
 *   await notifyFailures(db);   // index.js every notificationScanMs, the bell's count and
 *                               // list (routes/notifications.js), and after each calendar pull
 *
 * Returns:
 *   A promise for the number of notifications added. Rejects on a database error.
 *
 * How it works:
 *   Queues scanFailures behind any scan still running (its own small queue, not lock.js).
 */
export function notifyFailures(db) {
  const run = scanning.then(() => scanFailures(db));
  scanning = run.catch(() => {});
  return run;
}

/**
 * The scan itself (notifyFailures queues it).
 *
 * How it works:
 *   1. Closes open postFailed notifications whose post is gone or no longer failed.
 *   2. For each failed post without an open one, adds a postFailed notification. A failure
 *      whose lastError says "pick a new date" or "Requeue it with a new date" (from calendar
 *      sync) was never sent, so it is titled "needs a new date"; everything else was tried
 *      and failed, so "failed to send".
 *
 * When editing:
 *   That wording check depends on the lastError texts in calendarPull.js (DELETED_REASON and
 *   the moved-into-the-past message) and sync.js (the paused message); keep them matching.
 */
async function scanFailures(db) {
  await db.run(`UPDATE notification SET resolvedAt = datetime('now') WHERE kind = 'postFailed' AND resolvedAt IS NULL
                  AND (postId IS NULL OR NOT EXISTS (SELECT 1 FROM post WHERE post.id = notification.postId AND post.status = 'failed'))`);
  const fresh = await db.all(`SELECT post.*, platform.name AS platformName FROM post JOIN platform ON platform.id = post.platformId
                              WHERE post.status = 'failed' AND NOT EXISTS (SELECT 1 FROM notification
                                WHERE notification.postId = post.id AND notification.kind = 'postFailed' AND notification.resolvedAt IS NULL)
                              ORDER BY post.id`);
  for (const post of fresh) {
    // Matches the lastError texts of calendarPull.js and sync.js
    const needsDate = /pick a new date|Requeue it with a new date/i.test(post.lastError ?? '');
    await notify(db, {
      kind: 'postFailed',
      postId: post.id,
      platformId: post.platformId,
      title: needsDate ? `${post.platformName} post needs a new date` : `${post.platformName} post failed to send`,
      body: `${postLabel(post)[0].toUpperCase()}${postLabel(post).slice(1)}: ${post.lastError ?? 'no reason given'}. `
        + (needsDate ? 'Requeue it with a new date on the Library page.' : 'Check it, then requeue it on the Library page.'),
      data: { lastError: post.lastError ?? null, kind: post.kind },
    });
  }
  return fresh.length;
}

// ---- Text edited in Google Calendar (3b) ----

/**
 * Plain text from an event description; Google Calendar's editor saves HTML (<br>, <a>, &amp;).
 *
 * Usage:
 *   descriptionText(event.description)
 *
 * Returns:
 *   The text with line breaks for <br> and closing </p>, </div>, </li>, other tags removed,
 *   common entities decoded, \r\n made \n, and trimmed. '' for an empty description.
 *
 * When editing:
 *   &amp; is decoded last on purpose, so "&amp;lt;" becomes "&lt;" and not "<".
 */
export function descriptionText(description) {
  return String(description ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\r\n/g, '\n')
    .trim();
}

/**
 * Splits Google's description back into the post's caption and hashtags.
 *
 * Usage:
 *   const google = captionFromDescription(event.description, post, media);
 *
 * Takes:
 *   description - the event description from Google (may be HTML)
 *   post        - { hashtags }
 *   media       - the post's media row ({ link }), or null
 *
 * Returns:
 *   { caption, hashtags }
 *
 * How it works:
 *   1. The image link line the app adds is dropped: the app's link, or another image link of
 *      the app's kind on the last line (/api/media/<id> or drive.google.com; the image may
 *      have changed since).
 *   2. The hashtags stay separate when that block is still unchanged at the end; otherwise
 *      everything becomes the caption and hashtags are cleared, so nothing is doubled.
 */
export function captionFromDescription(description, post, media) {
  let text = descriptionText(description);
  const link = absoluteUrl(media?.link);
  const lines = text.split('\n');
  const last = lines.at(-1)?.trim() ?? '';
  const imageLink = /^https?:\/\/\S+$/.test(last) && /\/api\/media\/\d+|drive\.google\.com/.test(last);
  if (last && (last === link || imageLink)) text = lines.slice(0, -1).join('\n').trim();
  const hashtags = (post.hashtags ?? '').trim();
  if (hashtags && text.endsWith(hashtags)) {
    return { caption: text.slice(0, -hashtags.length).trim(), hashtags };
  }
  return { caption: text, hashtags: '' };
}

/**
 * Compares an event read back from Google with what the app writes for the post.
 *
 * Usage:
 *   await checkTextEdit(db, post, event, appTime);   // services/calendarPull.js
 *
 * Takes:
 *   post    - the post row
 *   event   - the event as Google has it
 *   appTime - the post's time in the app (a Date), so the app's event can be rebuilt
 *
 * Returns:
 *   true when Google's summary or description differs from the app's, otherwise false.
 *
 * How it works:
 *   1. Rebuilds the app's event (buildEvent) and compares title and plain-text description.
 *   2. Same text: closes an open calendarTextEdit notification, if any.
 *   3. Different: takes Google's etag on the post, so the app can still move the event (time
 *      only) without a 412. Then opens a calendarTextEdit notification with both versions in
 *      data, or, when one is already open (edited again before anyone chose), updates it to
 *      the latest text and marks it unread again.
 *
 * When editing:
 *   The data fields (googleCaption, appCaption, ...) are what the Notifications page shows
 *   and what resolveTextEdit applies.
 */
export async function checkTextEdit(db, post, event, appTime) {
  const platform = await db.get('SELECT * FROM platform WHERE id = ?', [post.platformId]);
  const media = post.mediaId ? await db.get('SELECT * FROM media WHERE id = ?', [post.mediaId]) : null;
  const app = buildEvent({ platform, post, media, slot: appTime });
  const googleSummary = String(event.summary ?? '').trim();
  const googleText = descriptionText(event.description);
  const open = await openNotification(db, 'calendarTextEdit', post.id);
  if (googleSummary === app.summary.trim() && googleText === descriptionText(app.description)) {
    if (open) await db.run("UPDATE notification SET resolvedAt = datetime('now') WHERE id = ?", [open.id]);
    return false;
  }
  const google = captionFromDescription(event.description, post, media);
  const data = {
    eventId: event.id,
    googleSummary,
    appSummary: app.summary,
    googleDescription: googleText,
    appDescription: app.description,
    googleCaption: google.caption,
    googleHashtags: google.hashtags,
    appCaption: post.caption,
    appHashtags: post.hashtags ?? '',
  };
  const what = googleSummary !== app.summary.trim() ? (googleText !== descriptionText(app.description) ? 'title and description' : 'title') : 'description';
  const title = `${platform.name} event text was changed in Google Calendar`;
  const body = `Someone changed the ${what} of the calendar event for ${postLabel(post)}. `
    + "The app will not overwrite it until someone chooses which caption to keep.";
  await db.run('UPDATE post SET calendarEventEtag = ? WHERE id = ?', [event.etag ?? null, post.id]);
  if (open) {
    // Edited again before anyone chose: latest text, unread again
    await db.run('UPDATE notification SET title = ?, body = ?, data = ?, readAt = NULL WHERE id = ?', [title, body, JSON.stringify(data), open.id]);
  } else {
    await notify(db, { kind: 'calendarTextEdit', postId: post.id, platformId: post.platformId, title, body, data });
  }
  return true;
}

/**
 * Settles a calendarTextEdit notification. "google" puts Google's caption on the post; "app"
 * keeps the post as it is and makes the next sync write the app's text to the event.
 *
 * Usage:
 *   const { notification, platformId } = await resolveTextEdit(db, id, 'google', req.user?.id);
 *   // POST /api/notifications/:id/resolve, which then syncs platformId
 *
 * Takes:
 *   id     - the notification id
 *   choice - 'google' or 'app'
 *   userId - who chose (stored on the post, the notification data and the audit row), or null
 *
 * Returns:
 *   { notification (notificationView shape), platformId (null when the post is gone) }.
 *   Throws { status, error }: 400 bad choice, not a text-edit notification, Google's text has
 *   no caption, or the caption is over the platform's charLimit; 404 not found; 409 already
 *   settled, or (for 'google') the post was deleted or is no longer queued.
 *
 * How it works:
 *   In one transaction: for 'google', writes Google's caption and hashtags to the post; for
 *   'app', forgets the stored event hash, which makes the next sync write the whole event
 *   again. Then marks the notification resolved (and read), saves the choice in its data, and
 *   writes an audit row (post.textChoice).
 *
 * When editing:
 *   The caller must sync the platform afterwards, or the event keeps Google's text. The
 *   length check counts the hashtags plus the blank line between them (2 characters).
 */
export async function resolveTextEdit(db, id, choice, userId) {
  if (choice !== 'google' && choice !== 'app') throw { status: 400, error: 'choice must be "google" or "app"' };
  const row = await db.get('SELECT * FROM notification WHERE id = ?', [id]);
  if (!row) throw { status: 404, error: 'Notification not found' };
  if (row.kind !== 'calendarTextEdit') throw { status: 400, error: 'Only a calendar text change has a choice to make' };
  if (row.resolvedAt) throw { status: 409, error: 'This was already settled' };
  const data = JSON.parse(row.data);
  const post = row.postId ? await db.get('SELECT * FROM post WHERE id = ?', [row.postId]) : null;
  if (choice === 'google') {
    if (!post) throw { status: 409, error: 'The post was deleted' };
    if (post.status !== 'queued') throw { status: 409, error: `Post is ${post.status} and can no longer be edited` };
    if (!data.googleCaption) throw { status: 400, error: "Google's description has no caption text; keep the app's caption instead" };
    const platform = await db.get('SELECT name, charLimit FROM platform WHERE id = ?', [post.platformId]);
    const length = data.googleCaption.length + (data.googleHashtags ? data.googleHashtags.length + 2 : 0);
    if (platform.charLimit && length > platform.charLimit) {
      throw { status: 400, error: `Google's caption is ${length} characters; ${platform.name} allows ${platform.charLimit}` };
    }
  }
  const resolved = { ...data, resolution: choice, resolvedBy: userId ?? null };
  await db.transaction(async (tx) => {
    if (post && choice === 'google') {
      await tx.run(`UPDATE post SET caption = ?, hashtags = ?, updatedBy = ?, updatedAt = datetime('now') WHERE id = ?`,
        [data.googleCaption, data.googleHashtags, userId ?? null, post.id]);
    } else if (post) {
      // Forgetting what was written makes the next sync write the whole event again
      await tx.run('UPDATE post SET calendarEventHash = NULL WHERE id = ?', [post.id]);
    }
    await tx.run(`UPDATE notification SET resolvedAt = datetime('now'), readAt = COALESCE(readAt, datetime('now')), data = ? WHERE id = ?`,
      [JSON.stringify(resolved), row.id]);
    if (post) {
      await writeAudit(tx, {
        userId: userId ?? null, action: 'post.textChoice', entityType: 'post', entityId: post.id,
        summary: choice === 'google'
          ? "Used Google Calendar's caption (someone had edited the event's text there)"
          : "Kept the app's caption; the calendar event gets the app's text again",
      });
    }
  });
  return { notification: notificationView(await db.get('SELECT * FROM notification WHERE id = ?', [row.id])), platformId: post?.platformId ?? null };
}
