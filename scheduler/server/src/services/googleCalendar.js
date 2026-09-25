// Google Calendar integration (Deliverable 3). The app writes one event per
// projected post; the client's n8n watches the calendar and publishes.
import { config } from '../config.js';

/**
 * Client-required event format: summary = platform name,
 * description = caption, hashtags, image link; color = platform color.
 */
export function buildEvent({ platform, post, media, slot, durationMinutes = 15 }) {
  const description = [post.caption, post.hashtags, media?.link].filter(Boolean).join('\n\n');
  return {
    summary: platform.name,
    description,
    colorId: platform.calendar_color_id ?? undefined,
    start: { dateTime: slot.toISOString(), timeZone: config.timezone },
    end: { dateTime: new Date(slot.getTime() + durationMinutes * 60_000).toISOString(), timeZone: config.timezone },
    // Lets sync find our events and ignore unrelated ones
    extendedProperties: { private: { postId: String(post.id) } },
  };
}

// TODO(Sprint 4): OAuth2 client from config.google, then insert/patch/delete
// against config.google.calendarId. Only patch events whose slot or content changed.
