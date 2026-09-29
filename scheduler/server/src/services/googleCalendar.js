// Google Calendar integration (Deliverable 3). The app writes one event per
// projected post, so the calendar shows the schedule; publishing is done by
// the dispatcher calling n8n (services/dispatch.js).
import { calendar } from '@googleapis/calendar';
import { absoluteUrl, config } from '../config.js';
import { googleOAuthClient } from './googleAuth.js';

/**
 * Client-required event format: summary = platform name,
 * description = caption, hashtags, image link; color = platform color.
 */
export function buildEvent({ platform, post, media, slot, durationMinutes = 15 }) {
  const description = [post.caption, post.hashtags, absoluteUrl(media?.link)].filter(Boolean).join('\n\n');
  return {
    summary: platform.name,
    description,
    colorId: platform.calendarColorId ?? undefined,
    start: { dateTime: slot.toISOString(), timeZone: config.timezone },
    end: { dateTime: new Date(slot.getTime() + durationMinutes * 60_000).toISOString(), timeZone: config.timezone },
    // Lets sync find our events and ignore unrelated ones
    extendedProperties: { private: { postId: String(post.id) } },
  };
}

/**
 * Returns { insert, patch, remove } bound to config.google.calendarId, or null
 * when credentials or the calendar ID are missing (sync then only updates the DB).
 * insert and patch resolve to { id, etag }.
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
    // With an etag, Google answers 412 if the event was edited since we wrote it
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
  };
}
