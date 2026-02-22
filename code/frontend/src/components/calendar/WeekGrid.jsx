/**
 * WeekGrid.jsx — 7-column weekly schedule grid (reusable component)
 *
 * Renders a Monday–Sunday grid where each column shows the visits scheduled
 * for that day as MeetingChip pills.
 *
 * NOTE: This component is currently NOT used by Schedule.jsx — Schedule.jsx
 * builds its own inline grid using the rotation data model (which is more
 * detailed than the simpler meetings-based model this component uses).
 * WeekGrid is retained for future refactoring or alternate views.
 *
 * Props:
 *   weekDates  {Date[]}   — Array of 7 Date objects (Mon–Sun) from useWeekNavigation
 *   meetings   {Array}    — Meeting templates with dayOfWeek (e.g. "Monday"), seniorId, volunteerId, status
 *   seniors    {Array}    — Full seniors list (used to look up first name by ID)
 *   volunteers {Array}    — Full volunteers list (used to look up initials by ID)
 *
 * Today's column receives the "week-grid__col--today" highlight class.
 * Cancelled meetings are excluded from display.
 */
import { format, isSameDay } from "date-fns";
import MeetingChip from "./MeetingChip";
import "./WeekGrid.css";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function WeekGrid({ weekDates, meetings, seniors, volunteers }) {
  /**
   * Returns all non-cancelled meetings whose dayOfWeek matches the given date.
   * date-fns `format(date, "EEEE")` returns the full weekday name (e.g. "Monday").
   */
  function meetingsOnDay(dayDate) {
    const dayName = format(dayDate, "EEEE");
    return meetings.filter((m) => m.dayOfWeek === dayName && m.status !== "cancelled");
  }

  /** Look up senior's first name by ID; returns "—" if not found. */
  function seniorName(seniorId) {
    const s = seniors.find((sr) => sr.id === seniorId);
    return s ? s.firstName : "—";
  }

  /** Returns two-letter initials for a volunteer (e.g. "JD"); "?" if not found. */
  function volunteerInitial(volunteerId) {
    const v = volunteers.find((vol) => vol.id === volunteerId);
    return v ? v.firstName[0] + v.lastName[0] : "?";
  }

  const today = new Date();

  return (
    <div className="week-grid-scroll">
      <div className="week-grid">
        {weekDates.map((date, i) => {
          const dayMeetings = meetingsOnDay(date);
          const isToday     = isSameDay(date, today);

          return (
            <div key={i} className={`week-grid__col${isToday ? " week-grid__col--today" : ""}`}>
              {/* Day header: abbreviated name + date number */}
              <div className="week-grid__day-label">
                <span className="week-grid__day-name">{DAY_NAMES[i]}</span>
                <span className={`week-grid__day-num${isToday ? " week-grid__day-num--today" : ""}`}>
                  {format(date, "d")}
                </span>
              </div>

              {/* Visit chips for this day */}
              <div className="week-grid__chips">
                {dayMeetings.length === 0 && (
                  <span className="week-grid__empty">No visits</span>
                )}
                {dayMeetings.map((m) => (
                  <MeetingChip
                    key={m.id}
                    seniorName={seniorName(m.seniorId)}
                    volunteerInitial={volunteerInitial(m.volunteerId)}
                    status={m.status}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
