/**
 * Google Calendar's event colors, so the Platforms page can show and pick the color each
 * platform's calendar events get. What lives here: calendarColors (the list).
 */

/**
 * Google Calendar's event colors, keyed by the colorId the API stores (platform.calendarColorId).
 *
 * Usage:
 *   Object.entries(calendarColors).map(([id, color]) => ...)   (pages/Platforms.jsx)
 *
 * Returns:
 *   { [colorId]: { name, hex } } for ids 1 to 11.
 *
 * When editing:
 *   This is Google's own list: the ids are what Google Calendar accepts as an event colorId,
 *   and the names and shades match what Google shows. Do not add or renumber entries.
 */
export const calendarColors = {
  1: { name: 'Lavender', hex: '#7986cb' },
  2: { name: 'Sage', hex: '#33b679' },
  3: { name: 'Grape', hex: '#8e24aa' },
  4: { name: 'Flamingo', hex: '#e67c73' },
  5: { name: 'Banana', hex: '#f6bf26' },
  6: { name: 'Tangerine', hex: '#f4511e' },
  7: { name: 'Peacock', hex: '#039be5' },
  8: { name: 'Graphite', hex: '#616161' },
  9: { name: 'Blueberry', hex: '#3f51b5' },
  10: { name: 'Basil', hex: '#0b8043' },
  11: { name: 'Tomato', hex: '#d50000' },
};
