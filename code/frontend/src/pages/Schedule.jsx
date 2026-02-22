/**
 * Schedule.jsx — Weekly visit schedule grid
 *
 * Renders a 7-column grid (Monday–Sunday) showing all visits scheduled for the
 * currently viewed week. Each day column contains "meeting chip" cards for every
 * visit that falls on that day.
 *
 * Navigation:
 *   ‹ prev / label (click to return to current week) / next ›
 *   Powered by useWeekNavigation hook (week offset relative to today).
 *
 * Data model (rotation-based, more detailed than WeekGrid component):
 *   visitTeams  — defines which seniors have visits and on which days/times
 *   rotations   — tracks which volunteer is assigned for a specific week
 *
 * visitsOnDay() cross-references these two sources:
 *   1. Finds all team schedule slots whose dayOfWeek matches the given date
 *   2. Looks up the rotation record for that team + slot + week's Monday date
 *   3. Returns visits sorted by time (earliest first)
 *
 * Visit chip colors (left border):
 *   completed   → green
 *   scheduled   → teal
 *   unscheduled → gray (no rotation record found for that week)
 *
 * TODO (Sprint 3): Replace mock data with live Baserow data from:
 *   - VOLUNTEER_TEAM table (team.seniorId, team.schedule slots)
 *   - MEETING_INSTANCE table (instances for the current week, with volunteer assignments)
 *   - MEETING_ATTENDANCE table (attendance_status per volunteer per instance)
 */
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { useWeekNavigation } from "../hooks/useWeekNavigation";
import { visitTeams } from "../mock/groups";
import { rotations } from "../mock/rotations";
import { seniors } from "../mock/seniors";
import { volunteers } from "../mock/volunteers";
import { format, startOfWeek, isSameDay } from "date-fns";
import "./Schedule.css";
import "../components/calendar/WeekGrid.css";
import "../components/calendar/MeetingChip.css";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Maps rotation status to the chip's left-border color CSS variable */
const statusBorder = {
  completed:   "var(--green)",
  scheduled:   "var(--teal)",
  unscheduled: "var(--border)",  // gray — visit exists but no volunteer assigned yet
};

/**
 * Returns all visits occurring on a given calendar date, each enriched with
 * the rotation data (which volunteer is assigned) for the current week.
 *
 * @param {Date}   dayDate      - The specific calendar date to query
 * @param {Array}  teams        - Visit team records with schedule slots
 * @param {Array}  allRotations - All rotation records
 * @returns {Array} Sorted array of visit objects { key, seniorId, timeOfDay, assignedVolunteerId, status }
 */
function visitsOnDay(dayDate, teams, allRotations) {
  const dow = dayDate.getDay(); // 0=Sun … 6=Sat (matches slot.dayOfWeek)

  // The week's Monday as "yyyy-MM-dd" string — rotation records are keyed by this
  const mondayStr = format(startOfWeek(dayDate, { weekStartsOn: 1 }), "yyyy-MM-dd");

  const visits = [];
  for (const team of teams) {
    team.schedule.forEach((slot, si) => {
      if (slot.dayOfWeek === dow) {
        // Look up the rotation record for this team, this schedule slot, this week
        const rotation = allRotations.find(
          (r) =>
            r.teamId === team.id &&
            (r.scheduleIndex ?? 0) === si &&
            r.weekStartDate === mondayStr
        );
        visits.push({
          key:                 `${team.id}-${si}`,          // unique React key
          seniorId:            team.seniorId,
          timeOfDay:           slot.timeOfDay,               // "HH:MM"
          assignedVolunteerId: rotation?.assignedVolunteerId ?? null,
          status:              rotation?.status ?? "unscheduled",
        });
      }
    });
  }

  // Sort chronologically so chips appear in time order within each day column
  return visits.sort((a, b) => a.timeOfDay.localeCompare(b.timeOfDay));
}

export default function Schedule() {
  const { currentWeekDates, weekLabel, prevWeek, nextWeek, goToCurrentWeek } =
    useWeekNavigation();

  const today = new Date();

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Schedule</h1>
        <p className="page-subtitle">Weekly visit overview</p>
      </div>

      {/* Week navigation bar: prev / current-week-label (clickable) / next */}
      <div className="schedule-nav">
        <button className="schedule-nav__btn" onClick={prevWeek} aria-label="Previous week">
          <ChevronLeft size={18} />
        </button>
        <button className="schedule-nav__label" onClick={goToCurrentWeek}>
          <CalendarDays size={14} />
          {weekLabel}
        </button>
        <button className="schedule-nav__btn" onClick={nextWeek} aria-label="Next week">
          <ChevronRight size={18} />
        </button>
      </div>

      {/* 7-column week grid — horizontally scrollable on narrow screens */}
      <div className="week-grid-scroll">
        <div className="week-grid">
          {currentWeekDates.map((date, i) => {
            const visits  = visitsOnDay(date, visitTeams, rotations);
            const isToday = isSameDay(date, today);

            return (
              <div
                key={i}
                className={`week-grid__col${isToday ? " week-grid__col--today" : ""}`}
              >
                {/* Day header: abbreviated label + date number, highlighted if today */}
                <div className="week-grid__day-label">
                  <span className="week-grid__day-name">{DAY_LABELS[i]}</span>
                  <span className={`week-grid__day-num${isToday ? " week-grid__day-num--today" : ""}`}>
                    {format(date, "d")}
                  </span>
                </div>

                {/* Visit chips for this day */}
                <div className="week-grid__chips">
                  {visits.length === 0 && (
                    <span className="week-grid__empty">No visits</span>
                  )}
                  {visits.map((v) => {
                    const senior    = seniors.find((s) => s.id === v.seniorId);
                    const volunteer = volunteers.find((vol) => vol.id === v.assignedVolunteerId);
                    // Volunteer initials (e.g. "JD") or "—" when unassigned
                    const volLabel  = volunteer
                      ? `${volunteer.firstName[0]}${volunteer.lastName[0]}`
                      : "—";
                    return (
                      <div
                        key={v.key}
                        className="meeting-chip"
                        style={{ borderLeftColor: statusBorder[v.status] ?? statusBorder.scheduled }}
                      >
                        <span className="meeting-chip__senior">
                          {senior ? senior.firstName : "—"}
                        </span>
                        <div className="schedule-chip__meta">
                          <span className="schedule-chip__time">{v.timeOfDay}</span>
                          <span className="meeting-chip__vol">{volLabel}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
