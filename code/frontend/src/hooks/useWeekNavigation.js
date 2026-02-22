/**
 * useWeekNavigation.js — Custom hook for week-based date navigation
 *
 * Tracks a "week offset" (integer) relative to the current week.
 *   offset 0  = current week (today's Mon–Sun)
 *   offset 1  = next week
 *   offset -1 = last week
 *
 * All date math uses date-fns; weeks start on Monday (weekStartsOn: 1).
 *
 * Returns:
 *   currentWeekDates  {Date[7]} — Array of 7 Date objects [Mon, Tue, …, Sun]
 *   weekLabel         {string}  — Human-readable range, e.g. "Feb 17 – Feb 23, 2026"
 *   prevWeek          {fn}      — Navigate to the previous week
 *   nextWeek          {fn}      — Navigate to the next week
 *   goToCurrentWeek   {fn}      — Jump back to today's week (reset offset to 0)
 *
 * Usage:
 *   const { currentWeekDates, weekLabel, prevWeek, nextWeek, goToCurrentWeek } = useWeekNavigation();
 */
import { useState } from "react";
import { startOfWeek, addDays, addWeeks, format } from "date-fns";

/**
 * Given a week offset (relative to today), returns an array of 7 Date objects
 * representing Monday through Sunday of that week.
 */
function buildWeekDates(offset) {
  // startOfWeek with weekStartsOn:1 gives Monday; addWeeks shifts by offset
  const weekStart = addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), offset);
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function useWeekNavigation() {
  // 0 = current week; positive = future; negative = past
  const [weekOffset, setWeekOffset] = useState(0);

  const currentWeekDates = buildWeekDates(weekOffset);

  // Format: "Feb 17 – Feb 23, 2026"
  const weekLabel =
    format(currentWeekDates[0], "MMM d") +
    " – " +
    format(currentWeekDates[6], "MMM d, yyyy");

  return {
    currentWeekDates,
    weekLabel,
    prevWeek:        () => setWeekOffset((n) => n - 1),
    nextWeek:        () => setWeekOffset((n) => n + 1),
    goToCurrentWeek: () => setWeekOffset(0),
  };
}
