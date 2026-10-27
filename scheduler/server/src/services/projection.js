import { WEEKDAYS, localDate, zonedTime } from './time.js';
export const COLORS = ['Blue', 'Purple'];
const pad = (n) => String(n).padStart(2, '0');
const DAY_MS = 86_400_000;
// The color/type sequence counts slots from here, so it runs on across month
// boundaries and any month gives the same answer whichever was generated first
const ANCHOR = Date.UTC(2026, 0, 1);
/** Cadence slots between ANCHOR and the first of the month  */
function slotsBefore(days, timesPerDay, year, month) {
  const start = Date.UTC(year, month - 1, 1);
  const [from, to, sign] = start >= ANCHOR ? [ANCHOR, start, 1] : [start, ANCHOR, -1];
  let count = 0;
  for (let t = from; t < to; t += DAY_MS) if (days.has(WEEKDAYS[new Date(t).getUTCDay()])) count++;
  return sign * count * timesPerDay;
}
const cycle = (i, n) => ((i % n) + n) % n;
export function parseMonth(value) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(typeof value === 'string' ? value : '');
  return m ? [Number(m[1]), Number(m[2])] : null;
}
/** `count` "YYYY-MM" months, starting with the local month of `date`. */
export function monthsFrom(date, count, timeZone) {
  const { year, month } = localDate(date, timeZone);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1 + i, 1));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  });
}
export function monthsBetween(from, to, timeZone) {
  const a = localDate(from, timeZone);
  const b = localDate(to, timeZone);
  return monthsFrom(from, (b.year - a.year) * 12 + b.month - a.month + 1, timeZone);
}

/** * Every cadence slot of a month, in time order. Colors alternate Blue, Purple*/
export function monthBlueprint(platform, postTypes, year, month, timeZone) {
  const days = new Set(platform.postingDays);
  const times = [...platform.postingTimes].sort();
  const types = [...postTypes].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const offset = slotsBefore(days, times.length, year, month);
  const slots = [];
  for (let day = 1; day <= daysInMonth; day++) {
    if (!days.has(WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()])) continue;
    for (const time of times) {
      const [hour, minute] = time.split(':').map(Number);
      const i = offset + slots.length;
      slots.push({
        date: `${year}-${pad(month)}-${pad(day)}`,
        time,
        scheduledAt: zonedTime(year, month, day, hour, minute, timeZone).toISOString(),
        color: platform.usesColors ? COLORS[cycle(i, 2)] : null,
        postTypeId: types.length ? types[cycle(i, types.length)].id : null,
      });
    }
  }
  return slots;
}

/** A library post fits a slot with the same type, and the same color when the platform uses colors. */
export const fitsSlot = (slot, post, usesColors) =>
  post.postTypeId === slot.postTypeId && (!usesColors || post.color === slot.color);
export function fillSlots(slots, pool, usesColors) {
  const left = [...pool].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
  const ordered = [...slots].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const result = [];
  for (const slot of ordered) {
    const i = left.findIndex((post) => fitsSlot(slot, post, usesColors));
    if (i === -1) continue;
    result.push({ slotId: slot.id, postId: left[i].id });
    left.splice(i, 1);
  }
  
  return result;
}