// Wall-clock <-> UTC conversion for the app TIMEZONE, using only Intl.

export const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const formatters = new Map();
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

function offsetMs(date, timeZone) {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Local calendar date of an instant in timeZone: { year, month, day }. */
export function localDate(date, timeZone) {
  const { year, month, day } = partsIn(date, timeZone);
  return { year, month, day };
}

/** The UTC instant for a local wall-clock time in timeZone (month is 1-based). */
export function zonedTime(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let result = guess - offsetMs(new Date(guess), timeZone);
  // Second pass settles instants near a DST change
  result = guess - offsetMs(new Date(result), timeZone);
  return new Date(result);
}

const pad = (n) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" for the local date of an instant in timeZone. */
export function localDateString(date, timeZone) {
  const { year, month, day } = localDate(date, timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** "YYYY-MM-DD" for the day after the local date of `date`. */
export function nextDateString(date, timeZone) {
  const { year, month, day } = localDate(date, timeZone);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** Validates "YYYY-MM-DD" and returns [year, month, day], or null. */
export function parseDateString(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!m) return null;
  const [year, month, day] = m.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? [year, month, day] : null;
}

/** The instant of "HH:MM" on local date "YYYY-MM-DD" in timeZone. */
export function atLocalTime(dateString, time, timeZone) {
  const [year, month, day] = parseDateString(dateString);
  const [hour, minute] = time.split(':').map(Number);
  return zonedTime(year, month, day, hour, minute, timeZone);
}

/** ISO string with the zone's UTC offset, e.g. "2026-10-06T12:00:00-07:00" (webhook payload format). */
export function offsetIso(date, timeZone) {
  const p = partsIn(date, timeZone);
  const offsetMinutes = Math.round(offsetMs(date, timeZone) / 60_000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
