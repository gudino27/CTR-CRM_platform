// Projected schedule (Deliverables 2 and 3): assigns every queued post on a
// platform to the next free posting slot from that platform's cadence.
import { WEEKDAYS, atLocalTime, localDateString, zonedTime } from './time.js';

// Stop looking for slots after this many days (guards against sparse cadences)
const HORIZON_DAYS = 730;

/** The platform's posting time used for override dates and Next posts (the earliest one). */
export const defaultTime = (platform) => [...platform.postingTimes].sort()[0] ?? null;

/**
 * @param {object} platform  row with parsed postingDays / postingTimes
 * @param {object[]} posts   queued posts for that platform
 * @param {Date} from        app-clock now; only slots after it are used
 * @param {string} timeZone  IANA zone the cadence is expressed in
 * @returns {{ postId: number, slot: Date | null }[]}  slot is null when the platform has no free slot
 */
export function projectPlatform(platform, posts, from, timeZone) {
  const fixed = posts.filter((p) => p.overrideDate);
  const flexible = posts
    .filter((p) => !p.overrideDate)
    .sort((a, b) => b.priority - a.priority || a.queuePosition - b.queuePosition);
  const time = defaultTime(platform);
  const result = fixed.map((p) => ({ postId: p.id, slot: time ? atLocalTime(p.overrideDate, time, timeZone) : null }));

  // Each override uses up one cadence slot on its day, so the platform
  // doesn't post twice that day. Value = slots still to skip on that day.
  const overridesPerDay = new Map();
  for (const p of fixed) overridesPerDay.set(p.overrideDate, (overridesPerDay.get(p.overrideDate) ?? 0) + 1);

  const days = new Set(platform.postingDays);
  const times = [...platform.postingTimes].sort().map((t) => t.split(':').map(Number));
  const [startYear, startMonth, startDay] = localDateString(from, timeZone).split('-').map(Number);
  let next = 0;

  if (!platform.paused && times.length > 0) {
    for (let i = 0; i < HORIZON_DAYS && next < flexible.length; i++) {
      const date = new Date(Date.UTC(startYear, startMonth - 1, startDay + i));
      if (!days.has(WEEKDAYS[date.getUTCDay()])) continue;
      const key = date.toISOString().slice(0, 10);

      for (const [hour, minute] of times) {
        if (next >= flexible.length) break;
        const slot = zonedTime(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour, minute, timeZone);
        if (slot <= from) continue;
        if (overridesPerDay.get(key) > 0) {
          overridesPerDay.set(key, overridesPerDay.get(key) - 1);
          continue;
        }
        result.push({ postId: flexible[next++].id, slot });
      }
    }
  }

  for (const p of flexible.slice(next)) result.push({ postId: p.id, slot: null });
  return result;
}
