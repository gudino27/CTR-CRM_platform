/**
 * Volunteers.jsx — Volunteer roster page: list view + detail/edit modal + onboarding preview
 *
 * Three internal views rendered in the same modal:
 *   1. VolunteerDetail (view mode)  — read-only profile with Edit and Onboard buttons
 *   2. VolunteerDetail (edit mode)  — form to create or update a volunteer record
 *   3. OnboardingPreview            — email preview the coordinator can send to the volunteer
 *
 * State (Volunteers component):
 *   volunteersList — local copy of volunteers, updated optimistically on save
 *   query          — name search filter string
 *   selected       — volunteer object shown in modal; null = closed; id="new" = create form
 *
 * TODO (Sprint 2): Replace mock data with Baserow API reads/writes via baserowApi.js.
 *   Reads:  GET rows from VOLUNTEER table (joined with PERSON for name/email)
 *   Writes: POST/PATCH to PERSON + VOLUNTEER tables (write goes through N8N webhook)
 */
import { useState } from "react";
import { Pencil, Mail, CheckCircle, CalendarDays } from "lucide-react";
import SearchInput from "../components/ui/SearchInput";
import DataTable from "../components/ui/DataTable";
import Badge from "../components/ui/Badge";
import Modal from "../components/ui/Modal";
import { volunteers as initialVolunteers } from "../mock/volunteers";
import { visitTeams } from "../mock/groups";
import { seniors } from "../mock/seniors";
import "./Volunteers.css";

/** Full day names indexed by dayOfWeek (0=Sun, 1=Mon, …, 6=Sat) — used in onboarding schedule */
const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

/**
 * Blank template for creating a new volunteer.
 * gradYear defaults to next calendar year (typical for student volunteers).
 */
const NEW_VOLUNTEER = {
  id: "new",
  firstName: "", lastName: "", status: "active",
  email: "", school: "", schoolCity: "", schoolState: "",
  gradYear: new Date().getFullYear() + 1,
  lastTrainingDate: "",
};

/** DataTable column definitions for the volunteer list */
const columns = [
  { key: "name",     label: "Name",      render: (r) => `${r.firstName} ${r.lastName}` },
  { key: "school",   label: "School" },
  { key: "gradYear", label: "Grad Year" },
  { key: "status",   label: "Status",    render: (r) => <Badge label={r.status} variant={r.status} /> },
];

/**
 * Returns all visit teams where this volunteer is a member (has their ID in volunteerIds[]).
 * A volunteer can theoretically be on multiple teams.
 */
function volunteerGroupMembership(volunteerId, groupsList) {
  return groupsList.filter((t) => t.volunteerIds.includes(volunteerId));
}

// ─── Main page component ──────────────────────────────────────────────────

export default function Volunteers() {
  const [volunteersList, setVolunteersList] = useState(initialVolunteers);
  const [query,          setQuery]          = useState("");
  const [selected,       setSelected]       = useState(null);

  // Real-time name filter
  const filtered = volunteersList.filter((v) =>
    `${v.firstName} ${v.lastName}`.toLowerCase().includes(query.toLowerCase())
  );

  /**
   * Save handler for both create and update.
   * Create: generates a timestamp ID and appends to list; closes modal.
   * Update: replaces the record in-place; keeps modal open showing saved state.
   */
  function saveVolunteer(updated) {
    if (updated.id === "new") {
      const record = { ...updated, id: `v-${Date.now()}` };
      setVolunteersList((prev) => [...prev, record]);
      setSelected(null);
    } else {
      setVolunteersList((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
      setSelected(updated);
    }
  }

  const modalTitle = selected
    ? (selected.id === "new" ? "New Volunteer" : `${selected.firstName} ${selected.lastName}`)
    : "";

  return (
    <div>
      <div className="page-header page-header--row">
        <div>
          <h1 className="page-title">Volunteers</h1>
          <p className="page-subtitle">{volunteersList.length} volunteers on record</p>
        </div>
        <button className="page-new-btn" onClick={() => setSelected(NEW_VOLUNTEER)}>
          + New Volunteer
        </button>
      </div>

      <div className="list-toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Search volunteers by name..." />
      </div>

      <DataTable columns={columns} rows={filtered} onRowClick={(row) => setSelected(row)} />

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={modalTitle}
      >
        {selected && (
          <VolunteerDetail
            volunteer={selected}
            allGroups={visitTeams}
            onSave={saveVolunteer}
            onCancel={() => setSelected(null)}
          />
        )}
      </Modal>
    </div>
  );
}

// ─── VolunteerDetail — modal content (view, edit, or onboarding) ──────────

/**
 * VolunteerDetail — manages three sub-views via local state:
 *   showOnboarding=true  → OnboardingPreview
 *   editing=true         → Edit form
 *   (default)            → Read-only profile
 *
 * Props:
 *   volunteer  {object}   — Volunteer record to display
 *   allGroups  {array}    — Full visitTeams list
 *   onSave     {function} — Called with updated volunteer object
 *   onCancel   {function} — Called to close the modal on new-record cancel
 */
function VolunteerDetail({ volunteer, allGroups, onSave, onCancel }) {
  const [editing,        setEditing]        = useState(volunteer.id === "new");
  const [draft,          setDraft]          = useState(volunteer);
  const [showOnboarding, setShowOnboarding] = useState(false);

  function setField(field, value) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  function save() {
    onSave(draft);
    setEditing(false);
  }

  function cancel() {
    if (volunteer.id === "new") {
      onCancel();
    } else {
      setDraft(volunteer); // revert unsaved changes
      setEditing(false);
    }
  }

  // Find all visit teams this volunteer belongs to
  const memberGroups = volunteerGroupMembership(volunteer.id, allGroups);

  // ─── Onboarding preview takes priority ───────────────────────────────
  if (showOnboarding) {
    return (
      <OnboardingPreview
        volunteer={volunteer}
        assignedTeams={memberGroups}
        onBack={() => setShowOnboarding(false)}
      />
    );
  }

  // ─── Edit form ────────────────────────────────────────────────────────
  if (editing) {
    return (
      <div className="detail-edit-form">
        <div className="form-row">
          <label className="form-label">First Name</label>
          <input className="form-input" value={draft.firstName} onChange={(e) => setField("firstName", e.target.value)} />
        </div>
        <div className="form-row">
          <label className="form-label">Last Name</label>
          <input className="form-input" value={draft.lastName} onChange={(e) => setField("lastName", e.target.value)} />
        </div>
        <div className="form-row">
          <label className="form-label">Status</label>
          <select className="form-select" value={draft.status} onChange={(e) => setField("status", e.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="form-row">
          <label className="form-label">Email</label>
          <input className="form-input" type="email" value={draft.email} onChange={(e) => setField("email", e.target.value)} />
        </div>
        <div className="form-row">
          <label className="form-label">School</label>
          <input className="form-input" value={draft.school} onChange={(e) => setField("school", e.target.value)} />
        </div>
        <div className="form-row">
          <label className="form-label">City</label>
          <input className="form-input" value={draft.schoolCity} onChange={(e) => setField("schoolCity", e.target.value)} />
        </div>
        <div className="form-row">
          <label className="form-label">State</label>
          <input className="form-input" value={draft.schoolState} onChange={(e) => setField("schoolState", e.target.value)} maxLength={2} />
        </div>
        <div className="form-row">
          <label className="form-label">Grad Year</label>
          <input className="form-input" type="number" value={draft.gradYear} onChange={(e) => setField("gradYear", Number(e.target.value))} />
        </div>

        <div className="form-actions">
          <button className="edit-save-btn" onClick={save}>
            {volunteer.id === "new" ? "Add Volunteer" : "Save Changes"}
          </button>
          <button className="edit-cancel-btn" onClick={cancel}>Cancel</button>
        </div>
      </div>
    );
  }

  // ─── Read-only profile view ───────────────────────────────────────────
  return (
    <div className="volunteer-detail">
      <div className="detail-actions">
        <button className="detail-edit-trigger" onClick={() => setEditing(true)}>
          <Pencil size={14} /> Edit
        </button>
        {/* Onboard button opens the email preview sub-view */}
        <button className="detail-onboard-btn" onClick={() => setShowOnboarding(true)}>
          <Mail size={14} /> Onboard
        </button>
      </div>

      <div className="detail-row">
        <span className="detail-label">Status</span>
        <Badge label={volunteer.status} variant={volunteer.status} />
      </div>
      <div className="detail-row">
        <span className="detail-label">School</span>
        <span>{volunteer.school}</span>
      </div>
      <div className="detail-row">
        <span className="detail-label">Location</span>
        <span>{volunteer.schoolCity}, {volunteer.schoolState}</span>
      </div>
      <div className="detail-row">
        <span className="detail-label">Grad Year</span>
        <span>{volunteer.gradYear}</span>
      </div>
      <div className="detail-row">
        <span className="detail-label">Email</span>
        <span className="detail-email">{volunteer.email}</span>
      </div>
      <div className="detail-row">
        <span className="detail-label">Last Training</span>
        <span>{volunteer.lastTrainingDate}</span>
      </div>
      {/* inactiveDate only shows for inactive volunteers */}
      {volunteer.inactiveDate && (
        <div className="detail-row">
          <span className="detail-label">Inactive Since</span>
          <span>{volunteer.inactiveDate}</span>
        </div>
      )}

      {/* Assigned senior(s) — derived from visit team membership */}
      <div className="detail-section">
        <span className="detail-label">Assigned Senior</span>
        {memberGroups.length === 0 ? (
          <p className="detail-none">Not assigned to any senior.</p>
        ) : (
          memberGroups.map((t) => {
            const s = seniors.find((sr) => sr.id === t.seniorId);
            return s ? (
              <div key={t.id} className="detail-group-chip">{s.firstName} {s.lastName}</div>
            ) : null;
          })
        )}
      </div>
    </div>
  );
}

// ─── OnboardingPreview — email preview + send trigger ────────────────────

/**
 * OnboardingPreview — renders a mock email preview with interactive steps.
 *
 * The coordinator can preview the onboarding email that will be sent to the volunteer.
 * Two required steps are embedded in the preview (simulating what the volunteer will do):
 *   Step 1: Accept Terms of Service (checkbox)
 *   Step 2: Connect Google Calendar (button, enabled after Step 1)
 *
 * Clicking "Send Onboarding Email":
 *   - Requires volunteer.email to be set (button disabled otherwise)
 *   - TODO (Sprint 3): Replace setSent(true) with a POST to the N8N onboarding webhook
 *     (N8N will then send the actual email via SMTP/Gmail integration)
 *
 * Props:
 *   volunteer     {object} — Volunteer receiving the onboarding email
 *   assignedTeams {array}  — Visit teams the volunteer belongs to (for schedule details)
 *   onBack        {fn}     — Returns to the profile view
 */
function OnboardingPreview({ volunteer, assignedTeams, onBack }) {
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [calConnected,  setCalConnected]  = useState(false);
  const [sent,          setSent]          = useState(false);

  // Success screen — shown after "Send" is clicked
  if (sent) {
    return (
      <div className="onboarding-success">
        <CheckCircle size={40} color="var(--green)" />
        <p>Onboarding email sent!</p>
        <strong>{volunteer.email || "(no email on file)"}</strong>
        <button className="edit-cancel-btn" onClick={onBack} style={{ marginTop: "0.75rem" }}>
          Back to profile
        </button>
      </div>
    );
  }

  return (
    <div className="onboarding-preview">
      <button className="onboarding-back-btn" onClick={onBack}>← Back to profile</button>

      {/* Email preview — mimics how the email looks to the volunteer */}
      <div className="onboarding-email-preview">
        <div className="onboarding-email-preview__meta">
          <div><span className="onboarding-meta-label">From:</span> noreply@ctr.org</div>
          <div><span className="onboarding-meta-label">To:</span> {volunteer.email || <em>no email on file</em>}</div>
          <div><span className="onboarding-meta-label">Subject:</span> Welcome to Conversations to Remember!</div>
        </div>

        <div className="onboarding-email-preview__body">
          <img src="/logo.png" alt="Conversations to Remember" className="onboarding-logo" />

          <p>Hi <strong>{volunteer.firstName || "Volunteer"}</strong>,</p>
          <p>
            Welcome to <strong>Conversations to Remember</strong>! You've been approved as a volunteer
            and we're excited to have you join our community of student volunteers.
          </p>

          {/* Visit schedule list — rendered if the volunteer is already assigned to teams */}
          {assignedTeams.length > 0 ? (
            <>
              <p><strong>Your senior visit assignment{assignedTeams.length > 1 ? "s" : ""}:</strong></p>
              <ul className="onboarding-schedule-list">
                {assignedTeams.map((t) => {
                  const s = seniors.find((sr) => sr.id === t.seniorId);
                  return (
                    <li key={t.id}>
                      <strong>{s ? `${s.firstName} ${s.lastName}` : "Senior"}</strong>
                      {" — "}
                      {/* Format each schedule slot as "Mondays at 10:00" */}
                      {t.schedule.map((sl, i) =>
                        `${DAY_NAMES[sl.dayOfWeek]}s at ${sl.timeOfDay}${i < t.schedule.length - 1 ? ", " : ""}`
                      )}
                      {" (virtual via Google Meet)"}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p>Your visit assignment will be confirmed shortly by your coordinator.</p>
          )}

          <p>Please complete the two steps below to confirm your participation:</p>

          {/* Step 1: Accept terms */}
          <div className="onboarding-step">
            <label className="onboarding-step__check">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
              />
              <span>
                I have read and accept the <strong>Terms of Service</strong> and <strong>Volunteer Agreement</strong>
              </span>
            </label>
          </div>

          {/* Step 2: Connect Google Calendar (requires Step 1 first) */}
          <div className="onboarding-step">
            <p className="onboarding-step__heading">Connect Google Calendar to auto-fill your schedule:</p>
            <button
              className={`onboarding-gcal-btn${calConnected ? " onboarding-gcal-btn--done" : ""}`}
              onClick={() => setCalConnected(true)}
              disabled={!termsAccepted || calConnected}
            >
              {calConnected ? (
                <><CheckCircle size={15} /> Schedule Added to Google Calendar</>
              ) : (
                <><CalendarDays size={15} /> Authorize &amp; Connect Google Calendar</>
              )}
            </button>
            {calConnected && assignedTeams.length > 0 && (
              <p className="onboarding-step__note">
                Your visit schedule has been automatically added to your Google Calendar. You'll receive reminders before each visit.
              </p>
            )}
          </div>

          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
            Questions? Reply to this email or contact your coordinator at ctr@conversations.org
          </p>
        </div>
      </div>

      {/* Send button — disabled if no email on file */}
      <div className="form-actions" style={{ marginTop: "0.75rem" }}>
        <button
          className="edit-save-btn"
          onClick={() => setSent(true)} // TODO: POST to N8N webhook instead
          disabled={!volunteer.email}
          title={!volunteer.email ? "Add an email address to send" : ""}
        >
          <Mail size={14} /> Send Onboarding Email
        </button>
        <button className="edit-cancel-btn" onClick={onBack}>Cancel</button>
      </div>
    </div>
  );
}
