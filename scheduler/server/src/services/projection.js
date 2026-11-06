/**
 * Turns a platform's schedule rules into slots: which dates and times it posts on, the post
 * type each slot wants, and its Blue/Purple color. Pure functions only (no database); the
 * database side is services/sync.js.
 *
 * What lives here: monthBlueprint (all slots of one month), parseRule, fillSlots and fitsSlot
 * (which library post goes in which slot), month helpers (parseMonth, monthsFrom,
 * monthsBetween), blackoutOn, oppositeColor, and the COLORS and RULE_DAYS lists.
 */
import { localDate, parseDateString, zonedTime } from './time.js';

// Stored in post.color and slot.color and checked by the API, so not a setting
export const COLORS = ['Blue', 'Purple'];
// Schedule rule day codes (RRULE style), indexed like Date.getUTCDay()
export const RULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const pad = (n) => String(n).padStart(2, '0');
const DAY_MS = 86_400_000;
// Blue/Purple alternate along the platform's slots counted from here, so the colors run on
// across months and any month gives the same answer whichever was generated first.
// Changing it would flip the color of slots already made.
const ANCHOR = Date.UTC(2026, 0, 1) / DAY_MS;
const cycle = (i, n) => ((i % n) + n) % n;
/** Days since 1970-01-01 for a "YYYY-MM-DD" date. */
const dayNumber = (date) => {
  const [y, m, d] = parseDateString(date);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};
// Weeks start on Sunday, as on US calendars (RRULE WKST=SU), so "every other week"
// counts the week holding the start date as the first; day 0 was a Thursday.
// Not yet confirmed: Sunday-start weeks, with the start date's week as week 1.
const weekOf = (day) => Math.floor((day + 4) / 7);

/**
 * Makes a scheduleRule row ready for slot generation.
 *
 * Usage:
 *   const rule = parseRule(row);   // monthBlueprint does this for rows not parsed yet
 *
 * Takes:
 *   row - a scheduleRule row: { byDay 'MO,WE', time 'HH:MM', startDate, endDate (or null),
 *         intervalWeeks, postTypeIds (JSON text or array), active, sortOrder, id }, plus
 *         optional typeChanges (ruleTypeChange rows, see sync.js withTypeChanges)
 *
 * Returns:
 *   The row with: active as a boolean (missing = true), postTypeIds as a list, days as a Set
 *   of weekday numbers (0 = Sunday), start and end as day numbers (no end date = Infinity),
 *   intervalWeeks (default 1), and typeChanges with their day numbers, sorted in the order
 *   they apply (by date, then id).
 *
 * When editing:
 *   monthBlueprint tells a parsed rule from a raw row by whether it has `days`.
 */
export function parseRule(row) {
  const postTypeIds = typeof row.postTypeIds === 'string' ? JSON.parse(row.postTypeIds) : row.postTypeIds ?? [];
  return {
    ...row,
    active: row.active === undefined ? true : Boolean(row.active),
    postTypeIds,
    days: new Set(String(row.byDay).split(',').filter(Boolean).map((code) => RULE_DAYS.indexOf(code))),
    start: dayNumber(row.startDate),
    end: row.endDate ? dayNumber(row.endDate) : Infinity,
    intervalWeeks: row.intervalWeeks ?? 1,
    // Type changes made from the slot panel, in the order they apply
    typeChanges: (row.typeChanges ?? []).map((c) => ({ ...c, day: dayNumber(c.date) }))
      .sort((a, b) => a.day - b.day || (a.id ?? 0) - (b.id ?? 0)),
  };
}

/** Whether the rule posts on that day: on one of its weekdays, inside its dates, in one of its weeks. */
const occursOn = (rule, day) =>
  day >= rule.start && day <= rule.end && rule.days.has(cycle(day + 4, 7)) &&
  cycle(weekOf(day) - weekOf(rule.start), rule.intervalWeeks) === 0;

/**
 * How many times a rule posts on days [from, to). Its post type sequence counts from its
 * start date, so this is where in the sequence a month begins.
 */
function countBetween(rule, from, to) {
  let count = 0;
  for (let day = Math.max(from, rule.start); day < Math.min(to, rule.end + 1); day++) if (occursOn(rule, day)) count++;
  return count;
}

/**
 * How many slots the platform has on days [from, to): one per date and time, whichever rules
 * made it. Used to count the Blue/Purple alternation from ANCHOR.
 */
function unionBetween(rules, from, to) {
  let count = 0;
  for (let day = from; day < to; day++) count += new Set(rules.filter((r) => occursOn(r, day)).map((r) => r.time)).size;
  return count;
}

/**
 * How a rule's type changes reshape its post type sequence, as steps in date order.
 *
 * Takes:
 *   rule       - a parsed rule with typeChanges ({ kind 'later' | 'rotation', day, fromTypeId, toTypeId })
 *   sequence   - the rule's post type ids in order
 *   inRotation - Set of type ids still in the rotation
 *
 * Returns:
 *   [{ day, offset, swaps }], the first one { day: -Infinity, offset: 0, swaps: [] }.
 *
 * How it works:
 *   From each step's day on, the occurrence counted i takes sequence[i + offset], and then
 *   each "later" swap (fromTypeId becomes toTypeId) in turn.
 *   - A "later" change ("This and later slots") adds a swap.
 *   - A "rotation" change ("Shift the rotation") finds the nearest place at or after that
 *     day's occurrence where the sequence (with the swaps so far) gives its type, and moves
 *     the offset there, so the rotation carries on from that type.
 *   Swaps to a type that has since left the rotation, and rotation changes to a type no
 *   longer in the sequence, are skipped.
 *
 * When editing:
 *   Steps build on each other in date order, so the sort in parseRule matters. Slots already
 *   stored only change when sync regenerates them.
 */
function typeSteps(rule, sequence, inRotation) {
  const steps = [{ day: -Infinity, offset: 0, swaps: [] }];
  for (const change of rule.typeChanges ?? []) {
    const { offset, swaps } = steps.at(-1);
    if (change.kind === 'later') {
      if (inRotation.has(change.toTypeId)) steps.push({ day: change.day, offset, swaps: [...swaps, change] });
      continue;
    }
    const first = countBetween(rule, -Infinity, change.day) + offset;
    for (let k = 0; k < sequence.length; k++) {
      if (swapped(sequence[cycle(first + k, sequence.length)], swaps) === change.toTypeId) {
        steps.push({ day: change.day, offset: offset + k, swaps });
        break;
      }
    }
  }
  return steps;
}
// A type id after the swaps, applied in order
const swapped = (typeId, swaps) => swaps.reduce((t, s) => (t === s.fromTypeId ? s.toTypeId : t), typeId);
/** The rule's type for its occurrence counted i, on that day (null when the sequence is empty). */
function typeOn(steps, sequence, i, day) {
  if (!sequence.length) return null;
  let step = steps[0];
  for (const s of steps) if (s.day <= day) step = s;
  return swapped(sequence[cycle(i + step.offset, sequence.length)], step.swaps);
}

// The other one of Blue and Purple (Blue for anything else, e.g. no color before)
const opposite = (color) => (color === COLORS[0] ? COLORS[1] : COLORS[0]);

/**
 * Walks one day of the Blue/Purple timeline: that day's slots and color anchors
 * in time order, each slot taking the opposite of the item before it.
 *
 * Usage:
 *   prev = walkColorDay(times, anchorsByDay.get(day) ?? [], blockedDays.has(day), prev, colors);
 *
 * Takes:
 *   times   - the day's slot times ("HH:MM"), sorted
 *   anchors - the day's color anchors ({ time, color }), sorted by time
 *   blocked - true when a Specific Date post with a color is on that day
 *   prev    - the color of the item before the day (undefined when unknown)
 *   colors  - optional Map; gets time -> color for each slot
 *
 * Returns:
 *   The color of the day's last item, for the next day.
 *
 * How it works:
 *   - An anchor sets the color; the next slot takes the opposite.
 *   - A slot at the same time as an anchor (a kept slot) is that anchor: it takes the
 *     anchor's color and does not count again.
 *   - On a blocked day the Specific Date post takes the day's place, so its library slots
 *     (which stay empty) do not count; they get a color but don't move the alternation.
 */
function walkColorDay(times, anchors, blocked, prev, colors) {
  const anchorAt = new Map(anchors.map((a) => [a.time, a.color]));
  const items = [...times.map((time) => ({ time })), ...anchors.map((a) => ({ time: a.time, anchor: a }))]
    .sort((a, b) => a.time.localeCompare(b.time) || (a.anchor ? -1 : 0) - (b.anchor ? -1 : 0));
  for (const item of items) {
    if (item.anchor) {
      prev = item.anchor.color;
      continue;
    }
    const color = anchorAt.get(item.time) ?? opposite(prev);
    if (!blocked && !anchorAt.has(item.time)) prev = color;
    colors?.set(item.time, color);
  }
  return prev;
}

/**
 * The slot times a set of active rules makes on one day (one slot per time).
 */
const timesOn = (rules, day) => [...new Set(rules.filter((r) => occursOn(r, day)).map((r) => r.time))].sort();

/**
 * Checks a "YYYY-MM" month string and splits it.
 *
 * Usage:
 *   if (!parseMonth(month)) return res.status(400).json({ error: 'month must be "YYYY-MM"' });   // routes/slots.js
 *
 * Returns:
 *   [year, month] as numbers (month 1-12), or null.
 */
export function parseMonth(value) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(typeof value === 'string' ? value : '');
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * A run of "YYYY-MM" months, starting with the local month of `date`.
 *
 * Usage:
 *   monthsFrom(clock.now(), syncMonthsAhead, config.timezone)   // -> ['2026-11', '2026-12', ...]
 *
 * Takes:
 *   date     - a Date; its month in timeZone is the first one
 *   count    - how many months
 *   timeZone - the app's zone (config.timezone)
 */
export function monthsFrom(date, count, timeZone) {
  const { year, month } = localDate(date, timeZone);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1 + i, 1));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  });
}

/**
 * Every "YYYY-MM" month from the local month of `from` to that of `to`, both included.
 *
 * Usage:
 *   monthsBetween(now, to, config.timezone)   // routes/inventory.js
 */
export function monthsBetween(from, to, timeZone) {
  const a = localDate(from, timeZone);
  const b = localDate(to, timeZone);
  return monthsFrom(from, (b.year - a.year) * 12 + b.month - a.month + 1, timeZone);
}

/**
 * Every slot of a month, in time order: the union of the platform's active schedule rules.
 *
 * Usage:
 *   monthBlueprint(platform, rules, types, 2026, 11, config.timezone)   // services/sync.js, routes/slots.js
 *   monthBlueprint(platform, rules, types, 2026, 11, config.timezone, anchors)   // with color anchors
 *
 * Takes:
 *   platform  - platform row; only usesColors is read
 *   rules     - scheduleRule rows or parsed rules (inactive ones are ignored), with typeChanges
 *   postTypes - the platform's rotation post types: [{ id, sortOrder }]
 *   year, month - the month (month 1-12)
 *   timeZone  - the app's zone; slot times are wall-clock times there
 *   anchors   - optional color anchors, from views.js colorAnchorsOf:
 *               [{ date 'YYYY-MM-DD', time 'HH:MM', color, blocksDay }]. Specific Date posts
 *               with a color (blocksDay true) and kept slots (blocksDay false). Default none.
 *
 * Returns:
 *   [{ date 'YYYY-MM-DD', time 'HH:MM', scheduledAt (UTC ISO), color ('Blue' | 'Purple' | null),
 *      postTypeId (or null), ruleId (or null) }], ordered by date then time.
 *
 * How it works:
 *   1. Orders the rotation types by sortOrder (then id) and the active rules by sortOrder (then id).
 *   2. Each rule cycles its own post type sequence (empty = the rotation types in sortOrder);
 *      types that left the rotation drop out of it. The sequence counts from the rule's start
 *      date, so it continues across months.
 *   3. A rule's typeChanges (see typeSteps) reshape its sequence from their dates on.
 *   4. Walks each day of the month; where two rules post at the same date and time, the first
 *      by sortOrder makes the slot (the other still counts the occurrence in its own sequence).
 *   5. Colors alternate Blue, Purple along all the platform's slots, counted from ANCHOR, and
 *      only when the platform uses colors.
 *   6. Specific Date colors shift the whole schedule: color anchors keep their
 *      own color and each slot after one takes the opposite of the item before it. So a slot's
 *      color depends only on the latest anchor before it and the slots in between: the walk
 *      starts at the day of the latest anchor before this month (walkColorDay), or uses the
 *      ANCHOR count of step 5 when there is none. Library slots on a day with a Specific Date
 *      post that has a color are left out of the count (that post takes the day's place).
 *
 * When editing:
 *   The same inputs must always give the same slots, whichever month is made first: sync
 *   matches stored slots to this output by date and time. Blackouts are not applied here;
 *   sync.js leaves blackout days out, and they keep their place in the color and type
 *   sequence. routes/platforms.js lists types in this same order (sortOrder, id).
 *   The anchors must be the same on every call for a platform (sync.js and the color
 *   suggestion both read them with colorAnchorsOf), or months would disagree.
 */
export function monthBlueprint(platform, rules, postTypes, year, month, timeZone, anchors = []) {
  const rotation = [...postTypes].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id).map((t) => t.id);
  const inRotation = new Set(rotation);
  const active = rules.map((r) => (r.days ? r : parseRule(r))).filter((r) => r.active)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.id ?? 0) - (b.id ?? 0));
  const first = Date.UTC(year, month - 1, 1) / DAY_MS;
  const last = Date.UTC(year, month, 1) / DAY_MS;
  const sequences = new Map(active.map((r) => {
    const own = r.postTypeIds.filter((id) => inRotation.has(id));
    return [r, own.length ? own : rotation];
  }));
  const steps = new Map(active.map((r) => [r, typeSteps(r, sequences.get(r), inRotation)]));
  const seen = new Map(active.map((r) => [r, countBetween(r, -Infinity, first)]));
  // Color anchors by day, and the days whose slots a Specific Date post replaces
  const anchorsByDay = new Map();
  for (const a of [...anchors].sort((x, y) => x.date.localeCompare(y.date) || x.time.localeCompare(y.time))) {
    const day = dayNumber(a.date);
    if (!anchorsByDay.has(day)) anchorsByDay.set(day, []);
    anchorsByDay.get(day).push(a);
  }
  const blockedDays = new Set(anchors.filter((a) => a.blocksDay).map((a) => dayNumber(a.date)));
  const anchorDaysBefore = [...anchorsByDay.keys()].filter((day) => day < first);
  let prevColor;
  if (anchorDaysBefore.length) {
    for (let day = Math.max(...anchorDaysBefore); day < first; day++) {
      prevColor = walkColorDay(timesOn(active, day), anchorsByDay.get(day) ?? [], blockedDays.has(day), prevColor);
    }
  } else {
    const colorIndex = first >= ANCHOR ? unionBetween(active, ANCHOR, first) : -unionBetween(active, first, ANCHOR);
    prevColor = COLORS[cycle(colorIndex - 1, 2)];
  }
  const slots = [];
  for (let day = first; day < last; day++) {
    const byTime = new Map();
    for (const rule of active) {
      if (!occursOn(rule, day)) continue;
      const i = seen.get(rule);
      seen.set(rule, i + 1);
      if (!byTime.has(rule.time)) byTime.set(rule.time, { rule, i });
    }
    const date = new Date(day * DAY_MS);
    const d = date.getUTCDate();
    const dayColors = new Map();
    prevColor = walkColorDay([...byTime.keys()].sort(), anchorsByDay.get(day) ?? [], blockedDays.has(day), prevColor, dayColors);
    for (const time of [...byTime.keys()].sort()) {
      const { rule, i } = byTime.get(time);
      const [hour, minute] = time.split(':').map(Number);
      slots.push({
        date: `${year}-${pad(month)}-${pad(d)}`,
        time,
        scheduledAt: zonedTime(year, month, d, hour, minute, timeZone).toISOString(),
        color: platform.usesColors ? dayColors.get(time) : null,
        postTypeId: typeOn(steps.get(rule), sequences.get(rule), i, day),
        ruleId: rule.id ?? null,
      });
    }
  }
  return slots;
}

/**
 * Whether a library post may go in a slot: same post type, and the same color when the
 * platform uses colors.
 *
 * Usage:
 *   if (!fitsSlot(slot, post, platform.usesColors)) ...   // services/sync.js, routes/slots.js
 *
 * Returns:
 *   true or false.
 */
export const fitsSlot = (slot, post, usesColors) =>
  post.postTypeId === slot.postTypeId && (!usesColors || post.color === slot.color);

/**
 * Pairs open slots with library posts: each slot, earliest first, takes the oldest post that
 * fits it.
 *
 * Usage:
 *   for (const { slotId, postId } of fillSlots(open, pool, platform.usesColors)) ...   // services/sync.js
 *
 * Takes:
 *   slots      - the open slots: [{ id, scheduledAt, postTypeId, color }]
 *   pool       - the unplaced library posts: [{ id, createdAt, postTypeId, color }]
 *   usesColors - the platform's usesColors
 *
 * Returns:
 *   [{ slotId, postId }]; slots with no fitting post are left out. Each post is used once.
 *
 * When editing:
 *   Oldest first (createdAt, then id) decides which post goes out first. Neither input
 *   array is changed.
 */
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

/**
 * The blackout that covers a local date, if any.
 *
 * Usage:
 *   if (blackoutOn(blackouts, slot.date)) ...   // services/sync.js, services/views.js, services/calendarPull.js
 *
 * Takes:
 *   blackouts - rows with startDate and endDate ("YYYY-MM-DD", both days included), e.g. from
 *               views.js blackoutsFor
 *   date      - a local date "YYYY-MM-DD"
 *
 * Returns:
 *   The first matching blackout row, or undefined.
 *
 * How it works:
 *   Same-length date strings compare in date order, so plain string comparison is enough.
 */
export const blackoutOn = (blackouts, date) => blackouts.find((b) => b.startDate <= date && date <= b.endDate);

/**
 * The other color of Blue and Purple, for the color suggestion.
 *
 * Usage:
 *   oppositeColor('Blue')   // 'Purple'
 *
 * Returns:
 *   'Purple' for 'Blue', otherwise 'Blue'.
 */
export const oppositeColor = opposite;
