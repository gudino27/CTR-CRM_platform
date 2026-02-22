/**
 * FeedbackForms.jsx — Feedback form submissions page: filterable list + detail modal
 *
 * In production, feedback is collected via 4 shareable Baserow form view URLs
 * (one per form type). This page displays all submitted responses in a unified
 * table so staff can review and follow up.
 *
 * The 4 form types (matching FORM_TYPE table seed data in Baserow):
 *   volunteer         — Submitted by student volunteers after each visit (rating, comments, follow-up)
 *   call_support      — Submitted by call support staff (connection quality, issues)
 *   senior_monthly    — Submitted monthly about each senior (satisfaction, concerns)
 *   caregiver_monthly — Submitted monthly by/about caregivers (satisfaction, concerns)
 *
 * UI elements:
 *   Type summary cards  — clickable count cards at top, act as toggle filters
 *   Type dropdown       — redundant with cards but provides "All Types" option
 *   DataTable           — sortable by submittedAt date (newest first)
 *   Modal → FormDetail  — full field display for the selected submission
 *
 * Follow-up detection:
 *   followUpNeeded (volunteer forms) OR concernsRaised (monthly forms) → flags "Follow-up Needed"
 *
 * TODO (Sprint 4): Replace mock data with Baserow API reads from FEEDBACK_FORM table.
 *   Reads: GET rows filtered by form_type, sorted by submitted_at DESC
 *   The shareable form URLs (for submission) are configured directly in Baserow — no React code needed.
 */
import { useState } from "react";
import { ClipboardCheck } from "lucide-react";
import DataTable from "../components/ui/DataTable";
import Badge from "../components/ui/Badge";
import Modal from "../components/ui/Modal";
import { feedbackForms } from "../mock/feedbackForms";
import { seniors } from "../mock/seniors";
import { volunteers } from "../mock/volunteers";
import { meetingInstances } from "../mock/meetingInstances";
import "./FeedbackForms.css";

/** Dropdown filter options (value used for filtering, label shown to user) */
const FORM_TYPES = [
  { value: "all",               label: "All Types" },
  { value: "volunteer",         label: "Volunteer (per meeting)" },
  { value: "call_support",      label: "Call Support (per meeting)" },
  { value: "senior_monthly",    label: "Senior Monthly" },
  { value: "caregiver_monthly", label: "Caregiver Monthly" },
];

/** Human-readable labels for the 4 form type keys */
const TYPE_LABELS = {
  volunteer:         "Volunteer",
  call_support:      "Call Support",
  senior_monthly:    "Senior Monthly",
  caregiver_monthly: "Caregiver Monthly",
};

/**
 * Badge color variant per form type.
 * Each type gets a distinct color so they're visually distinguishable in the table.
 */
const TYPE_VARIANTS = {
  volunteer:         "scheduled",  // teal
  call_support:      "active",     // teal (same family)
  senior_monthly:    "completed",  // green
  caregiver_monthly: "paused",     // amber
};

/** Returns a senior's full name by ID, or "—" if not found or ID is null */
function seniorName(id) {
  if (!id) return "—";
  const s = seniors.find((sr) => sr.id === id);
  return s ? `${s.firstName} ${s.lastName}` : "—";
}

/**
 * Returns a human-readable label for who submitted the form.
 * call_support and caregiver_monthly forms don't have a volunteer submitter in the mock data,
 * so we return a generic label. For volunteer forms, we look up the volunteer by personId.
 */
function submitterLabel(personId, formType) {
  if (formType === "call_support")      return "Call Support Staff";
  if (formType === "caregiver_monthly") return "Caregiver";
  const v = volunteers.find((vol) => vol.id === personId);
  return v ? `${v.firstName} ${v.lastName}` : personId;
}

/**
 * Looks up the meetingId for a given meeting instance.
 * Currently unused in rendering but available for future join lookups.
 */
function relatedSeniorForInstance(instanceId) {
  const mi = meetingInstances.find((m) => m.id === instanceId);
  return mi ? mi.meetingId : null;
}

/** DataTable column definitions for the submissions list */
const columns = [
  {
    key: "formType",
    label: "Form Type",
    render: (r) => <Badge label={TYPE_LABELS[r.formType]} variant={TYPE_VARIANTS[r.formType]} />,
  },
  {
    key: "submittedBy",
    label: "Submitted By",
    render: (r) => submitterLabel(r.submittedByPersonId, r.formType),
  },
  {
    key: "senior",
    label: "Senior",
    render: (r) => {
      if (r.seniorId)          return seniorName(r.seniorId);      // monthly forms link directly to a senior
      if (r.meetingInstanceId) return "via meeting";               // per-meeting forms link to an instance
      return "—";
    },
  },
  {
    key: "submittedAt",
    label: "Date",
    render: (r) => r.submittedAt.slice(0, 10), // show date only, not time
  },
  {
    key: "followUp",
    label: "Follow-up",
    render: (r) => {
      // Flag if volunteer checked "follow up needed" OR monthly form has "concerns raised"
      const needed = r.followUpNeeded || r.concernsRaised;
      return needed ? <Badge label="Needed" variant="paused" /> : <Badge label="None" variant="active" />;
    },
  },
];

// ─── Main page component ──────────────────────────────────────────────────

export default function FeedbackForms() {
  const [typeFilter, setTypeFilter] = useState("all");
  const [selected,   setSelected]   = useState(null);

  // Filter by type and sort newest-first
  const filtered = feedbackForms
    .filter((f) => typeFilter === "all" || f.formType === typeFilter)
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

  // Submission counts per type (used for the clickable summary cards)
  const counts = {
    volunteer:         feedbackForms.filter((f) => f.formType === "volunteer").length,
    call_support:      feedbackForms.filter((f) => f.formType === "call_support").length,
    senior_monthly:    feedbackForms.filter((f) => f.formType === "senior_monthly").length,
    caregiver_monthly: feedbackForms.filter((f) => f.formType === "caregiver_monthly").length,
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Feedback Forms</h1>
        <p className="page-subtitle">{feedbackForms.length} total submissions</p>
      </div>

      {/* Summary cards — clicking a card toggles that type as a filter.
          Clicking the already-active type card resets to "all". */}
      <div className="feedback-summary">
        {Object.entries(TYPE_LABELS).map(([key, label]) => (
          <button
            key={key}
            className={`feedback-type-card${typeFilter === key ? " feedback-type-card--active" : ""}`}
            onClick={() => setTypeFilter(typeFilter === key ? "all" : key)}
          >
            <span className="feedback-type-card__count">{counts[key]}</span>
            <span className="feedback-type-card__label">{label}</span>
          </button>
        ))}
      </div>

      {/* Dropdown filter — duplicates the cards but includes "All Types" option */}
      <div className="feedback-filter-bar">
        <select
          className="meetings-select"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          {FORM_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      <DataTable columns={columns} rows={filtered} onRowClick={(row) => setSelected(row)} />

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${TYPE_LABELS[selected.formType]} Form` : ""}
      >
        {selected && <FormDetail form={selected} />}
      </Modal>
    </div>
  );
}

// ─── FormDetail — full field view inside the modal ───────────────────────

/**
 * FormDetail — renders all relevant fields for a feedback form submission.
 *
 * Only renders fields that are present and non-empty (since different form types
 * have different fields — e.g. only volunteer forms have "rating",
 * only call_support forms have "connectionQuality").
 *
 * Follow-up section appears at the bottom when followUpNeeded or concernsRaised is true.
 *
 * Props:
 *   form {object} — The feedback form record to display
 */
function FormDetail({ form }) {
  // Any form flagged for follow-up shows a prominent section at the bottom
  const isFollowUp = form.followUpNeeded || form.concernsRaised;

  return (
    <div className="form-detail">
      <div className="detail-row">
        <span className="detail-label">Type</span>
        <Badge label={TYPE_LABELS[form.formType]} variant={TYPE_VARIANTS[form.formType]} />
      </div>
      <div className="detail-row">
        <span className="detail-label">Submitted By</span>
        <span>{submitterLabel(form.submittedByPersonId, form.formType)}</span>
      </div>
      <div className="detail-row">
        <span className="detail-label">Date</span>
        <span>{form.submittedAt.slice(0, 10)}</span>
      </div>

      {/* Senior — present on monthly forms */}
      {form.seniorId && (
        <div className="detail-row">
          <span className="detail-label">Senior</span>
          <span>{seniorName(form.seniorId)}</span>
        </div>
      )}
      {/* Meeting instance ID — present on per-meeting forms */}
      {form.meetingInstanceId && (
        <div className="detail-row">
          <span className="detail-label">Meeting Instance</span>
          <span>{form.meetingInstanceId}</span>
        </div>
      )}

      {/* Rating — volunteer per-meeting forms only */}
      {form.rating !== undefined && (
        <div className="detail-row">
          <span className="detail-label">Rating</span>
          <span className="form-detail__rating">{form.rating} / 5</span>
        </div>
      )}
      {/* Overall satisfaction — senior_monthly and caregiver_monthly forms */}
      {form.overallSatisfaction !== undefined && (
        <div className="detail-row">
          <span className="detail-label">Satisfaction</span>
          <span className="form-detail__rating">{form.overallSatisfaction} / 5</span>
        </div>
      )}
      {/* Connection quality — call_support forms only */}
      {form.connectionQuality && (
        <div className="detail-row">
          <span className="detail-label">Connection Quality</span>
          <Badge
            label={form.connectionQuality}
            variant={form.connectionQuality === "good" ? "completed" : "paused"}
          />
        </div>
      )}
      {form.issuesNoted && (
        <div className="detail-section">
          <span className="detail-label">Issues Noted</span>
          <p className="detail-notes">{form.issuesNoted}</p>
        </div>
      )}
      {form.comments && (
        <div className="detail-section">
          <span className="detail-label">Comments</span>
          <p className="detail-notes">{form.comments}</p>
        </div>
      )}

      {/* Follow-up section — prominent banner when action is required */}
      {isFollowUp && (
        <div className="form-detail__followup">
          <Badge label="Follow-up Needed" variant="paused" />
          {(form.followUpNote || form.concernNote) && (
            <p className="form-detail__followup-note">{form.followUpNote || form.concernNote}</p>
          )}
        </div>
      )}
    </div>
  );
}
