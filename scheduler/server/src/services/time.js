/**
 *Wall-clock <-> UTC conversion for the app TIMEZONE, using only Intl.
 *
 * What lives here: readers that turn an instant into local parts or strings 
 (localDate, localDateString, localDateTimeString, offsetIso), makers that turn local
 * values into an instant (zonedTime, atLocalTime, parseLocalDateTime), parseDateString, and
 * weekOfYear (the US week number of a date). Every function that needs a zone takes it as an
 * argument; callers pass config.timezone (TIMEZONE in .env).
 */


const formatters = new Map();

/**
 * The local calendar parts of an instant in a zone.
 *
 * Takes:
 *   date     - a Date
 *   timeZone - an IANA zone name, e.g. 'America/New_York'
 *
 * Returns:
 *   { year, month, day, hour, minute, second } as numbers (month 1-12, hour 0-23).
 *
 * How it works:
 *   Formats the date with an Intl formatter for the zone (one formatter per zone, kept for
 *   reuse since making them is slow) and reads the parts back as numbers.
 *
 * When editing:
 *   hourCycle 'h23' matters: without it midnight can come back as hour 24.
 */
function partsIn(date, timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  const p = Object.fromEntries(formatters.get(timeZone).formatToParts(date).map((x) => [x.type, Number(x.value)]));
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second };
}

/**
 * The zone's offset from UTC at an instant, in milliseconds (negative west of UTC, e.g.
 * -4 hours for New York in summer).
 *
 * How it works:
 *   Reads the local parts, treats them as if they were UTC, and subtracts the real instant
 *   (rounded down to the second, since the parts have no milliseconds).
 */
function offsetMs(date, timeZone) {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The local calendar date of an instant in a zone.
 *
 * Usage:
 *   const { year, month } = localDate(clock.now(), config.timezone);   // services/projection.js
 *
 * Returns:
 *   { year, month, day } (month 1-12).
 */
export function localDate(date, timeZone) {
  const { year, month, day } = partsIn(date, timeZone);
  return { year, month, day };
}

/**
 * The UTC instant for a local wall-clock time in a zone.
 *
 * Usage:
 *   zonedTime(2026, 11, 2, 9, 0, 'America/New_York')   // -> Date for 2026-11-02T14:00:00Z
 *
 * Takes:
 *   year, month (1-based), day, hour, minute - the local time
 *   timeZone - an IANA zone name
 *
 * Returns:
 *   A Date.
 *
 * How it works:
 *   Guesses by treating the local time as UTC, subtracts the zone's offset at that guess, then
 *   does it once more with the offset at the first result. The second pass settles instants
 *   near a DST change, where the offset at the guess and at the answer differ.
 *
 * When editing:
 *   A local time that does not exist (skipped by a spring-forward change) or happens twice
 *   (fall-back) still gets one answer; slot times rely on this never throwing.
 */
export function zonedTime(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let result = guess - offsetMs(new Date(guess), timeZone);
  result = guess - offsetMs(new Date(result), timeZone);
  return new Date(result);
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * "YYYY-MM-DD" for the local date of an instant in a zone.
 *
 * Usage:
 *   localDateString(clock.now(), config.timezone)   // routes/platforms.js
 */
export function localDateString(date, timeZone) {
  const { year, month, day } = localDate(date, timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Checks a "YYYY-MM-DD" date string and splits it.
 *
 * Usage:
 *   if (!parseDateString(body.startDate)) throw 'startDate must be a date "YYYY-MM-DD"';   // routes/platforms.js
 *
 * Takes:
 *   value - anything; only a real calendar date in that exact format passes
 *
 * Returns:
 *   [year, month, day] as numbers, or null (wrong format, or a date like 2026-02-30).
 */
export function parseDateString(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!m) return null;
  const [year, month, day] = m.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? [year, month, day] : null;
}

/**
 * The instant of "HH:MM" on local date "YYYY-MM-DD" in a zone.
 *
 * Usage:
 *   atLocalTime('2026-11-02', '09:00', config.timezone)
 *
 * Returns:
 *   A Date. Throws if dateString is not a valid date, so check it first (parseLocalDateTime does).
 */
export function atLocalTime(dateString, time, timeZone) {
  const [year, month, day] = parseDateString(dateString);
  const [hour, minute] = time.split(':').map(Number);
  return zonedTime(year, month, day, hour, minute, timeZone);
}

/**
 * An ISO string with the zone's UTC offset, the format of the webhook payload's times.
 *
 * Usage:
 *   offsetIso(new Date(post.scheduledAt), config.timezone)   // -> "2026-10-06T12:00:00-07:00"
 *
 * Returns:
 *   "YYYY-MM-DDTHH:MM:SS+HH:MM" (or -HH:MM) in local time.
 *
 * When editing:
 *   n8n receives this format (services/dispatch.js), so keep it the same.
 */
export function offsetIso(date, timeZone) {
  const p = partsIn(date, timeZone);
  const offsetMinutes = Math.round(offsetMs(date, timeZone) / 60_000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * Checks a local "YYYY-MM-DDTHH:MM" (a Specific Date post's fixedAt) and gives its instant.
 *
 * Usage:
 *   parseLocalDateTime(post.fixedAt, config.timezone)?.toISOString()   // services/sync.js
 *
 * Takes:
 *   value    - anything; only that exact format with a real date and a 00:00-23:59 time passes
 *   timeZone - the zone the wall-clock time is in
 *
 * Returns:
 *   A Date, or null when value is not valid.
 */
export function parseLocalDateTime(value, timeZone) {
  const m = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/.exec(typeof value === 'string' ? value : '');
  if (!m || !parseDateString(m[1])) return null;
  return atLocalTime(m[1], `${m[2]}:${m[3]}`, timeZone);
}

/**
 * The local "YYYY-MM-DDTHH:MM" of an instant in a zone (the fixedAt format).
 *
 * Usage:
 *   const fixedAt = localDateTimeString(start, config.timezone);   // services/calendarPull.js
 */
export function localDateTimeString(date, timeZone) {
  const p = partsIn(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * The week of the year for a date, US style: weeks run Sunday to Saturday and week 1 is the
 * week that contains January 1. For display only (the Calendar's "Wk 45").
 *
 * Usage:
 *   weekOfYear('2026-11-05')   // 45
 *
 * Takes:
 *   dateString - a local calendar date "YYYY-MM-DD" (already in the app zone)
 *
 * Returns:
 *   The week number, 1 to 53. Throws if dateString is not a valid date, so check it first
 *   (parseDateString).
 *
 * How it works:
 *   1. If the Sunday-to-Saturday week of the date contains January 1 of the next year, it is
 *      week 1 of that year (so Dec 27-31, 2026 are week 1, like Jan 1-2, 2027).
 *   2. Otherwise it counts whole weeks from the Sunday on or before January 1 of the date's year:
 *      the day of the year (0 for Jan 1) plus Jan 1's weekday (0 = Sunday), divided by 7, plus 1.
 *   Worked out in UTC, so no time zone can move the date.
 *
 * When editing:
 *   The client has the same rule (client/src/time.js weekOfYear); change both together. It is
 *   not used for "every other week" rules: those count weeks from the rule's startDate
 *   (services/projection.js)
 */
export function weekOfYear(dateString) {
  const [year, month, day] = parseDateString(dateString);
  const date = Date.UTC(year, month - 1, day);
  const saturday = date + (6 - new Date(date).getUTCDay()) * 86_400_000;
  if (new Date(saturday).getUTCFullYear() > year) return 1;
  const jan1 = Date.UTC(year, 0, 1);
  const dayOfYear = Math.round((date - jan1) / 86_400_000);
  return Math.floor((dayOfYear + new Date(jan1).getUTCDay()) / 7) + 1;
}
