/**
 * Dates and times for display. Dates are shown in the app time zone (TIMEZONE in .env, sent
 * by /api/status), not the browser's. Every shown time carries its zone ("10:00 AM ET");
 * when the viewer's browser is on a different UTC offset at that moment, their own time
 * follows in brackets ("10:00 AM ET (7:00 AM PT, your time)"). Times are still entered and
 * stored in the app zone.
 *
 * What lives here:
 *   setAppTimeZone, appTimeZone, viewerTimeZone, zoneCity, zoneAbbr   the zones and their names
 *   zonedParts, zonedToInstant                                       converting between a moment
 *                                                                    and a wall-clock date + time
 *   viewerIsAway, viewerTime, viewerHint, awayNote                   the viewer's own time
 *   formatTime, formatDateTime, formatClock, formatSlotTime,
 *   formatLocal, formatDate, formatStamp                             display text
 *   monthKey, shiftMonth                                             "YYYY-MM" months
 *   weekOfYear                                                       the US week number ("Wk 45")
 *
 * When editing:
 *   The viewer's zone is a parameter (defaulting to the browser's) so these can be checked
 *   with any zone. The server has its own zone math (server/src/services/time.js); a stored
 *   fixedAt or slot date/time is wall-clock time in the app zone on both sides.
 */

// Used until a page has heard the real zone from /api/status (config TIMEZONE)
let appZone = 'America/New_York';

/**
 * Remembers the app time zone from /api/status, for helpers called without one.
 *
 * Usage:
 *   setAppTimeZone(status.timezone);   (components/TimeZone.jsx)
 *
 * Takes:
 *   timeZone - an IANA zone name ("America/New_York"); empty values are ignored
 */
export function setAppTimeZone(timeZone) {
  if (timeZone) appZone = timeZone;
}

/**
 * The app time zone as last heard from /api/status ("America/New_York" until then).
 *
 * Usage:
 *   appTimeZone()   (pages/Platforms.jsx)
 */
export function appTimeZone() {
  return appZone;
}

/**
 * The browser's time zone, "UTC" if the browser does not say.
 *
 * Usage:
 *   viewerTimeZone()   (the default `viewer` of the helpers below)
 */
export function viewerTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * The city part of a zone name, for field labels.
 *
 * Usage:
 *   zoneCity('America/New_York')   // "New York"
 *
 * Takes:
 *   timeZone - IANA zone name; defaults to the app zone
 */
export function zoneCity(timeZone = appZone) {
  return timeZone.split('/').pop().replace(/_/g, ' ');
}

/**
 * The wall-clock date and time of a moment in a zone.
 *
 * Usage:
 *   zonedParts('2026-11-09T15:00:00Z', 'America/New_York')   // { date: "2026-11-09", time: "10:00" }
 *
 * Takes:
 *   iso      - a UTC ISO string, a Date or a ms timestamp
 *   timeZone - IANA zone name (required)
 *
 * Returns:
 *   { date: "YYYY-MM-DD", time: "HH:MM" } (24-hour).
 */
export function zonedParts(iso, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/**
 * Minutes the zone is ahead of UTC at that moment (New York in winter: -300).
 *
 * How it works:
 *   Reads the zone's wall clock at the moment, treats it as if it were UTC, and subtracts the
 *   real moment (rounded down to the minute, since zonedParts drops seconds).
 */
function offsetMinutes(instant, timeZone) {
  const { date, time } = zonedParts(instant, timeZone);
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, day, hours, minutes);
  return Math.round((wall - Math.floor(new Date(instant).getTime() / 60000) * 60000) / 60000);
}

/**
 * The moment a wall-clock date and time in a zone happens.
 *
 * Usage:
 *   zonedToInstant('2026-11-09', '10:00')   // Date for 15:00 UTC
 *
 * Takes:
 *   date     - "YYYY-MM-DD"
 *   time     - "HH:MM"; empty means midnight
 *   timeZone - defaults to the app zone
 *
 * Returns:
 *   A Date.
 *
 * How it works:
 *   Guesses with the zone's offset at the wall time, then corrects once with the offset at
 *   the guess, which is enough around daylight-saving changes.
 */
export function zonedToInstant(date, time, timeZone = appZone) {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = (time || '00:00').split(':').map(Number);
  const wall = Date.UTC(year, month - 1, day, hours, minutes);
  // two passes on purpose (daylight-saving changes)
  let instant = wall - offsetMinutes(wall, timeZone) * 60000;
  instant = wall - offsetMinutes(instant, timeZone) * 60000;
  return new Date(instant);
}

/**
 * The short zone name at that moment.
 *
 * Usage:
 *   zoneAbbr(new Date(), 'America/New_York')   // "ET"
 *
 * Returns:
 *   "ET", "PT", ...; places without a short name get the offset, e.g. "GMT+1".
 *
 * How it works:
 *   Tries the browser's shortGeneric name, which gives "ET" for New York but "Germany Time"
 *   for Berlin; a name with a space falls back to the short name ("GMT+1").
 */
export function zoneAbbr(instant, timeZone) {
  const name = (style) => new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: style })
    .formatToParts(new Date(instant)).find((p) => p.type === 'timeZoneName')?.value;
  const generic = name('shortGeneric');
  return generic && !generic.includes(' ') ? generic : name('short');
}

/**
 * Whether the viewer's clock differs from the app's at that moment.
 *
 * Usage:
 *   viewerIsAway()   // true for a viewer in Los Angeles when the app is on New York time
 *
 * Takes:
 *   instant  - the moment to compare at (defaults to now); offsets differ around DST changes
 *   timeZone - the app zone (default appZone)
 *   viewer   - the viewer's zone (default the browser's)
 *
 * Returns:
 *   true or false; false when either zone is missing.
 */
export function viewerIsAway(instant = new Date(), timeZone = appZone, viewer = viewerTimeZone()) {
  if (!timeZone || !viewer) return false;
  return offsetMinutes(instant, timeZone) !== offsetMinutes(instant, viewer);
}

const clockOf = (instant, timeZone) => new Date(instant).toLocaleTimeString('en-US', {
  timeZone, hour: 'numeric', minute: '2-digit',
});
const dayOf = (instant, timeZone) => new Date(instant).toLocaleDateString('en-US', {
  timeZone, weekday: 'short', month: 'short', day: 'numeric',
});

/**
 * The viewer's own time for a moment.
 *
 * Usage:
 *   viewerTime(zonedToInstant(date, time))   (pages/Platforms.jsx)
 *
 * Returns:
 *   "7:00 AM PT"; with the day too when it falls on a different date than in the app zone
 *   ("Sun, Nov 8, 11:00 PM PT"); "" when the viewer is not away.
 */
export function viewerTime(instant, timeZone = appZone, viewer = viewerTimeZone()) {
  if (!viewerIsAway(instant, timeZone, viewer)) return '';
  const clock = `${clockOf(instant, viewer)} ${zoneAbbr(instant, viewer)}`;
  const otherDay = zonedParts(instant, viewer).date !== zonedParts(instant, timeZone).date;
  return otherDay ? `${dayOf(instant, viewer)}, ${clock}` : clock;
}

/** " (7:00 AM PT, your time)", or "" when the viewer is not away. */
function yourTimeSuffix(instant, timeZone, viewer) {
  const local = viewerTime(instant, timeZone, viewer);
  return local ? ` (${local}, your time)` : '';
}

/**
 * A hint for under a date/time field: the chosen time in the viewer's own zone.
 *
 * Usage:
 *   viewerHint('2026-11-09', '10:00')   // "Your time: Mon, Nov 9, 7:00 AM PT"
 *
 * Takes:
 *   date, time - "YYYY-MM-DD" and "HH:MM" in the app zone, as typed in the form
 *
 * Returns:
 *   The hint (always with the day), or "" when either is empty or the viewer is not away.
 */
export function viewerHint(date, time, timeZone = appZone, viewer = viewerTimeZone()) {
  if (!date || !time) return '';
  const instant = zonedToInstant(date, time, timeZone);
  if (!viewerIsAway(instant, timeZone, viewer)) return '';
  return `Your time: ${dayOf(instant, viewer)}, ${clockOf(instant, viewer)} ${zoneAbbr(instant, viewer)}`;
}

/**
 * A moment's time in the app zone, with the viewer's own time when they are away.
 *
 * Usage:
 *   formatTime('2026-11-09T15:00:00Z')   // "10:00 AM ET (7:00 AM PT, your time)"
 *
 * Takes:
 *   iso - a UTC ISO string or a Date
 */
export function formatTime(iso, timeZone = appZone, viewer = viewerTimeZone()) {
  return `${clockOf(iso, timeZone)} ${zoneAbbr(iso, timeZone)}${yourTimeSuffix(iso, timeZone, viewer)}`;
}

/**
 * Like formatTime, with the day in front.
 *
 * Usage:
 *   formatDateTime(iso)   // "Mon, Nov 9, 10:00 AM ET (7:00 AM PT, your time)"
 */
export function formatDateTime(iso, timeZone = appZone, viewer = viewerTimeZone()) {
  return `${dayOf(iso, timeZone)}, ${formatTime(iso, timeZone, viewer)}`;
}

/**
 * A wall-clock "HH:MM" as 12-hour time, with no time zone (for tight spots like calendar cells).
 *
 * Usage:
 *   formatClock('09:30')   // "9:30 AM"
 */
export function formatClock(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

/**
 * A slot's wall-clock "HH:MM" in the app zone on a date, with the zone and the viewer's time.
 *
 * Usage:
 *   formatSlotTime(slot.date, slot.time)   // "9:30 AM ET (6:30 AM PT, your time)"
 *
 * Takes:
 *   date - "YYYY-MM-DD", or empty for a repeating rule time: then the zone's offset today is used
 *   time - "HH:MM"
 */
export function formatSlotTime(date, time, timeZone = appZone, viewer = viewerTimeZone()) {
  const day = date || zonedParts(new Date(), timeZone).date;
  const instant = zonedToInstant(day, time, timeZone);
  return `${formatClock(time)} ${zoneAbbr(instant, timeZone)}${yourTimeSuffix(instant, timeZone, viewer)}`;
}

/**
 * A Specific Date post's fixedAt for display.
 *
 * Usage:
 *   formatLocal(post.fixedAt)   // "Mon, Nov 9, 10:00 AM ET (7:00 AM PT, your time)"
 *
 * Takes:
 *   fixedAt - "YYYY-MM-DDTHH:MM", already wall-clock time in the app zone
 *
 * How it works:
 *   The day name is worked out from the date alone (in UTC, so no zone can shift it), the
 *   time part goes through formatSlotTime.
 */
export function formatLocal(fixedAt, timeZone = appZone, viewer = viewerTimeZone()) {
  const [date, time] = fixedAt.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const label = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
  });
  return `${label}, ${formatSlotTime(date, time, timeZone, viewer)}`;
}

/**
 * Turns a database timestamp into an ISO string the browser reads as UTC.
 *
 * How it works:
 *   createdAt comes from SQLite's datetime('now'): "YYYY-MM-DD HH:MM:SS" in UTC. The space
 *   becomes a "T", and a "Z" is added when there is no zone. Strings that already carry a zone are left as they are.
 */
function fromCreatedAt(createdAt) {
  const iso = createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T');
  return /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
}

/**
 * A database timestamp's date in the app zone.
 *
 * Usage:
 *   formatDate(post.createdAt)   // "Nov 9, 2026"
 *
 * Returns:
 *   The date, or "" when createdAt is empty.
 */
export function formatDate(createdAt, timeZone = appZone) {
  if (!createdAt) return '';
  return new Date(fromCreatedAt(createdAt)).toLocaleDateString('en-US', { timeZone, month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * A database timestamp with its time.
 *
 * Usage:
 *   formatStamp(entry.createdAt)   // "Nov 9, 2026, 10:00 AM ET (7:00 AM PT, your time)"
 *
 * Returns:
 *   The text; "" when empty; the original string when it cannot be read as a date.
 */
export function formatStamp(createdAt, timeZone = appZone, viewer = viewerTimeZone()) {
  if (!createdAt) return '';
  const date = new Date(fromCreatedAt(createdAt));
  if (Number.isNaN(date.getTime())) return createdAt;
  return `${formatDate(createdAt, timeZone)}, ${formatTime(date, timeZone, viewer)}`;
}

/**
 * The note at the foot of every page for viewers away from the app's time zone.
 *
 * Usage:
 *   awayNote(timeZone)   (components/TimeZone.jsx)
 *
 * Returns:
 *   "Times are New York time (ET).  or "" when the
 *   viewer is on app time now.
 */
export function awayNote(timeZone = appZone, viewer = viewerTimeZone(), now = new Date()) {
  if (!viewerIsAway(now, timeZone, viewer)) return '';
  return `Times are ${zoneCity(timeZone)} time (${zoneAbbr(now, timeZone)}). Your time: ${zoneAbbr(now, viewer)} (${viewer.replace(/_/g, ' ')})`;
}

/**
 * The "YYYY-MM" month of a moment in a zone, e.g. the app's current month.
 *
 * Usage:
 *   monthKey(status.now, status.timezone)   // "2026-11"   (pages/Calendar.jsx, Inventory.jsx)
 */
export function monthKey(iso, timeZone) {
  return zonedParts(iso, timeZone).date.slice(0, 7);
}

/**
 * Moves a "YYYY-MM" month forward or back.
 *
 * Usage:
 *   shiftMonth('2026-12', 1)   // "2027-01"
 *
 * Takes:
 *   month - "YYYY-MM"
 *   delta - whole months, negative to go back
 */
export function shiftMonth(month, delta) {
  const [year, m] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The week of the year for a date, US style: weeks run Sunday to Saturday and week 1 is the
 * week that contains January 1. Shown on the Calendar as "Wk 45", display only.
 *
 * Usage:
 *   weekOfYear('2026-11-05')   // 45   (pages/Calendar.jsx)
 *
 * Takes:
 *   date - a calendar date "YYYY-MM-DD" in the app zone
 *
 * Returns:
 *   The week number, 1 to 53.
 *
 * How it works:
 *   1. If the Sunday-to-Saturday week of the date contains January 1 of the next year, it is
 *      week 1 of that year (so Dec 27-31, 2026 are week 1, like Jan 1-2, 2027).
 *   2. Otherwise it counts whole weeks from the Sunday on or before January 1 of the date's year:
 *      the day of the year (0 for Jan 1) plus Jan 1's weekday (0 = Sunday), divided by 7, plus 1.
 *   Worked out in UTC, so the viewer's zone cannot move the date.
 *
 * When editing:
 *   The server has the same rule (server/src/services/time.js weekOfYear), change both together.
 *   "Every other week" schedule rules do not use it: they count weeks from the rule's start date.
 */
export function weekOfYear(date) {
  const [year, month, day] = date.split('-').map(Number);
  const instant = Date.UTC(year, month - 1, day);
  const saturday = instant + (6 - new Date(instant).getUTCDay()) * 86_400_000;
  if (new Date(saturday).getUTCFullYear() > year) return 1;
  const jan1 = Date.UTC(year, 0, 1);
  const dayOfYear = Math.round((instant - jan1) / 86_400_000);
  return Math.floor((dayOfYear + new Date(jan1).getUTCDay()) / 7) + 1;
}
