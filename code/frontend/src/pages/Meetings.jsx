/**
 * Meetings.jsx — Meeting instances page: filterable list + detail modal
 *
 * In the Baserow schema, a "meeting instance" is one specific occurrence of a
 * recurring meeting (e.g. "the Monday 10am visit on Feb 24, 2026").
 * This page lists all instances, sortable and filterable by status.
 *
 * Data model (current mock data):
 *   meetingInstances — one row per individual occurrence (date, status, notes)
 *   meetings         — the parent template (senior, volunteer, day/time)
 *   The two are joined via meetingId to display senior + volunteer names.
 *
 * Substitution handling:
 *   If an instance has a substituteVolunteerId set, volunteerForInstance()
 *   shows the substitute's name instead of the original volunteer's name.
 *
 * TODO (Sprint 3): Replace mock data with Baserow API reads from:
 *   - MEETING_INSTANCE table (instance_date, instance_status, notes, calendar_event_id)
 *   - MEETING table (joined via meeting_instance.meeting link)
 *   - VOLUNTEER_TEAM table (joined via meeting.team link → senior, volunteers)
 *   - MEETING_ATTENDANCE table (attendance_status per volunteer)
 */
import { useState } from "react";
import DataTable from "../components/ui/DataTable";
import Badge from "../components/ui/Badge";
import Modal from "../components/ui/Modal";
import { meetingInstances } from "../mock/meetingInstances";
import { meetings } from "../mock/meetings";
import { seniors } from "../mock/seniors";
import { volunteers } from "../mock/volunteers";
import "./Meetings.css";

/**
 * Looks up the senior for a meeting instance by joining:
 *   instance.meetingId → meeting.seniorId → senior record
 */
function seniorForInstance(mi) {
  const mtg = meetings.find((m) => m.id === mi.meetingId);
  if (!mtg) return null;
  return seniors.find((s) => s.id === mtg.seniorId);
}

/**
 * Looks up the volunteer for a meeting instance.
 * Uses substituteVolunteerId first (if a substitute was assigned),
 * otherwise falls back to the meeting template's regular volunteerId.
 */
function volunteerForInstance(mi) {
  const volunteerId = mi.substituteVolunteerId
    ? mi.substituteVolunteerId
    : meetings.find((m) => m.id === mi.meetingId)?.volunteerId;
  return volunteers.find((v) => v.id === volunteerId);
}

/** Filter options for the status dropdown */
const statusOptions = ["all", "scheduled", "completed", "paused", "cancelled"];

/** DataTable column definitions */
const columns = [
  {
    key: "senior",
    label: "Senior",
    render: (r) => {
      const s = seniorForInstance(r);
      return s ? `${s.firstName} ${s.lastName}` : "—";
    },
  },
  {
    key: "volunteer",
    label: "Volunteer",
    render: (r) => {
      const v = volunteerForInstance(r);
      return v ? `${v.firstName} ${v.lastName}` : "—";
    },
  },
  { key: "instanceDate", label: "Date" },
  {
    key: "status",
    label: "Status",
    render: (r) => <Badge label={r.status} variant={r.status} />,
  },
];

// ─── Main page component ──────────────────────────────────────────────────

export default function Meetings() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected,     setSelected]     = useState(null);

  // Filter by status and sort newest-first
  const filtered = meetingInstances
    .filter((mi) => statusFilter === "all" || mi.status === statusFilter)
    .sort((a, b) => new Date(b.instanceDate) - new Date(a.instanceDate));

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Meeting Instances</h1>
        <p className="page-subtitle">{meetingInstances.length} total instances</p>
      </div>

      {/* Status filter dropdown */}
      <div className="meetings-filters">
        <select
          className="meetings-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          {statusOptions.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All statuses" : s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {/* Clicking a row opens the detail modal */}
      <DataTable
        columns={columns}
        rows={filtered}
        onRowClick={(row) => setSelected(row)}
      />

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title="Meeting Instance"
      >
        {selected && <InstanceDetail instance={selected} />}
      </Modal>
    </div>
  );
}

// ─── InstanceDetail — read-only detail view inside the modal ─────────────

/**
 * InstanceDetail — displays full details of a single meeting instance.
 *
 * Shows: status, date, senior, volunteer (or substitute),
 * day/time from the parent meeting template, and any notes.
 *
 * Props:
 *   instance {object} — The meeting instance record to display
 */
function InstanceDetail({ instance }) {
  const senior    = seniorForInstance(instance);
  const volunteer = volunteerForInstance(instance);
  const mtg       = meetings.find((m) => m.id === instance.meetingId);

  return (
    <div className="instance-detail">
      <div className="detail-row">
        <span className="detail-label">Status</span>
        <Badge label={instance.status} variant={instance.status} />
      </div>
      <div className="detail-row">
        <span className="detail-label">Date</span>
        <span>{instance.instanceDate}</span>
      </div>
      <div className="detail-row">
        <span className="detail-label">Senior</span>
        <span>{senior ? `${senior.firstName} ${senior.lastName}` : "—"}</span>
      </div>
      <div className="detail-row">
        <span className="detail-label">Volunteer</span>
        <span>{volunteer ? `${volunteer.firstName} ${volunteer.lastName}` : "—"}</span>
      </div>
      {/* Substitute badge — only shown when a substitute was assigned */}
      {instance.substituteVolunteerId && (
        <div className="detail-row">
          <span className="detail-label">Substitute</span>
          <Badge label="substitute assigned" variant="scheduled" />
        </div>
      )}
      {/* Day/time from the parent meeting template */}
      {mtg && (
        <div className="detail-row">
          <span className="detail-label">Day / Time</span>
          <span>{mtg.dayOfWeek} at {mtg.meetingTime}</span>
        </div>
      )}
      {instance.dateNotes && (
        <div className="detail-section">
          <span className="detail-label">Date Notes</span>
          <p className="detail-notes">{instance.dateNotes}</p>
        </div>
      )}
      {instance.statusNotes && (
        <div className="detail-section">
          <span className="detail-label">Status Notes</span>
          <p className="detail-notes">{instance.statusNotes}</p>
        </div>
      )}
    </div>
  );
}
