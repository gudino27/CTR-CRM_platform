/**
 * Google Calendar integration (Deliverable 3). The app writes one event per projected post,
 * so the calendar shows the schedule; publishing is done by the dispatcher calling n8n
 * (services/dispatch.js).
 *
 * What lives here: buildEvent (what an event says) and createCalendarClient (the calls to
 * Google). sync.js writes events, calendarPull.js reads them back.
 */
import { calendar } from '@googleapis/calendar';
import { absoluteUrl, config } from '../config.js';
import { googleOAuthClient } from './googleAuth.js';
import { eventMinutes } from '../settings.js';

/**
 * Builds the Calendar event for a scheduled post, in the required event format:
 * summary = platform name; description = caption, hashtags, image link; color = platform color.
 *
 * Usage:
 *   const event = buildEvent({ platform, post, media, slot });   // services/sync.js
 *
 * Takes:
 *   platform        - platform row: { name, calendarColorId }
 *   post            - post row: { id, caption, hashtags }
 *   media           - media row with { link }, or null for a post with no image
 *   slot            - a Date: when the post goes out (the event's start)
 *   durationMinutes - event length; defaults to eventMinutes in settings.js
 *
 * Returns:
 *   A Google event body: { summary, description, colorId, start, end, extendedProperties }.
 *   start and end are in config.timezone; extendedProperties.private.postId is the post id as text.
 *
 * How it works:
 *   Joins caption, hashtags and the absolute image link with blank lines (skipping empty
 *   ones), and adds the postId private property, which lets sync and the calendar pull find
 *   the app's events and ignore unrelated ones.
 *
 * When editing:
 *   The summary/description layout is the required event format (the production
 *   calendar is the one n8n reads, see CALENDAR_ID in the README); change it only together with
 *   the n8n publish workflow.
 *   sync.js hashes this whole object to tell whether an event needs
 *   rewriting, so any change here rewrites every future event on the next sync.
 *   notifications.js (checkTextEdit) compares Google's copy against this to spot hand edits.
 */
export function buildEvent({ platform, post, media, slot, durationMinutes = eventMinutes }) {
  const description = [post.caption, post.hashtags, absoluteUrl(media?.link)].filter(Boolean).join('\n\n');
  return {
    summary: platform.name,
    description,
    colorId: platform.calendarColorId ?? undefined,
    start: { dateTime: slot.toISOString(), timeZone: config.timezone },
    end: { dateTime: new Date(slot.getTime() + durationMinutes * 60_000).toISOString(), timeZone: config.timezone },
    extendedProperties: { private: { postId: String(post.id) } },
  };
}

/**
 * Makes the small Calendar client the app uses, bound to one calendar.
 *
 * Usage:
 *   let calendarClient = createCalendarClient();   // services/sync.js, services/calendarPull.js
 *
 * Takes:
 *   google - { clientId, clientSecret, refreshToken, calendarId }; defaults to config.google
 *
 * Returns:
 *   { insert, patch, remove, list, read } bound to google.calendarId, or null when the
 *   credentials or the calendar ID are missing (sync then only updates the database).
 *   insert(event)                 - resolves to { id, etag }
 *   patch(eventId, event, etag)   - resolves to { id, etag }. With an etag, Google answers 412
 *                                   if the event was edited since the app wrote it.
 *   remove(eventId)               - resolves when gone; an event already gone (404/410, deleted
 *                                   by hand in Calendar) counts as done
 *   list({ syncToken, pageToken }) - one page of events (see below)
 *   read(eventId)                 - the event as Google has it, or null if it does not exist
 *   Other Google errors are thrown as they are (err.code holds the HTTP status).
 *
 * How it works:
 *   list() is for reading back (two-way sync, services/calendarPull.js). With a syncToken it
 *   returns only events changed since that token, without one every event. Deleted events
 *   are included (showDeleted, status "cancelled"), since that is how a deletion in Google
 *   Calendar shows up. It asks for 250 per page and resolves to
 *   { items, nextPageToken, nextSyncToken } (nextSyncToken on the last page only).
 *   An expired syncToken fails with code 410; the caller then reads everything again.
 *
 * When editing:
 *   sync.js and calendarPull.js each hold their own client and can be given a fake one with
 *   the same five methods (setCalendarClient, setPullCalendarClient); keep the shapes the same.
 */
export function createCalendarClient(google = config.google) {
  const oauth = googleOAuthClient(google);
  if (!oauth || !google.calendarId) return null;
  const { calendarId } = google;
  const events = calendar({ version: 'v3', auth: oauth }).events;

  return {
    async insert(event) {
      const { data } = await events.insert({ calendarId, requestBody: event });
      return { id: data.id, etag: data.etag };
    },
    async patch(eventId, event, etag) {
      const { data } = await events.patch(
        { calendarId, eventId, requestBody: event },
        etag ? { headers: { 'If-Match': etag } } : {},
      );
      return { id: data.id, etag: data.etag };
    },
    async remove(eventId) {
      try {
        await events.delete({ calendarId, eventId });
      } catch (err) {
        // Already gone (deleted by hand in Calendar) is fine
        if (err.code !== 404 && err.code !== 410) throw err;
      }
    },
    async list({ syncToken, pageToken } = {}) {
      const { data } = await events.list({
        calendarId,
        syncToken: syncToken || undefined,
        pageToken: pageToken || undefined,
        showDeleted: true,
        maxResults: 250,
      });
      return { items: data.items ?? [], nextPageToken: data.nextPageToken ?? null, nextSyncToken: data.nextSyncToken ?? null };
    },
    async read(eventId) {
      try {
        const { data } = await events.get({ calendarId, eventId });
        return data;
      } catch (err) {
        if (err.code === 404 || err.code === 410) return null;
        throw err;
      }
    },
  };
}
