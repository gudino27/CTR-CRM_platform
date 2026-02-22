/**
 * MeetingChip.jsx — Visit event pill for the weekly schedule grid
 *
 * A compact card rendered inside a day column on the Schedule and WeekGrid views.
 * Displays the senior's first name and the assigned volunteer's initials.
 * A colored left border indicates the visit status at a glance.
 *
 * Props:
 *   seniorName       {string} — Senior's first name (or "—" if unknown)
 *   volunteerInitial {string} — Two-letter initials of the assigned volunteer (e.g. "JD").
 *                               If absent (unscheduled), this section is hidden.
 *   status           {string} — Visit status; controls the left border color.
 *                               Defaults to "scheduled" if omitted or unrecognized.
 *
 * Status → border color mapping:
 *   active / scheduled → teal   (#2B8F8A)
 *   completed          → green  (#27AE60)
 *   paused             → amber  (#F39C12)
 *   cancelled          → red    (#E74C3C)
 */
import "./MeetingChip.css";

const statusBorderColor = {
  active:    "#2B8F8A",
  scheduled: "#2B8F8A",
  completed: "#27AE60",
  paused:    "#F39C12",
  cancelled: "#E74C3C",
};

export default function MeetingChip({ seniorName, volunteerInitial, status = "scheduled" }) {
  // Fall back to scheduled color for any unrecognized status
  const borderColor = statusBorderColor[status] ?? statusBorderColor.scheduled;

  return (
    <div className="meeting-chip" style={{ borderLeftColor: borderColor }}>
      <span className="meeting-chip__senior">{seniorName}</span>
      {/* Volunteer initials — hidden when no volunteer is assigned yet */}
      {volunteerInitial && (
        <span className="meeting-chip__vol">{volunteerInitial}</span>
      )}
    </div>
  );
}
