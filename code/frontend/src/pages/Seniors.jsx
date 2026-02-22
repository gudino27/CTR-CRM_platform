/**
 * Seniors.jsx — Senior roster page: list view + detail/edit modal
 *
 * State management:
 *   seniorsList  — local copy of all seniors (starts from mock data).
 *                  New/edited seniors update this list immediately (optimistic UI).
 *                  TODO (Sprint 2): Replace with Baserow API reads/writes via baserowApi.js.
 *   query        — current search string for name filtering
 *   selected     — the senior object currently shown in the modal.
 *                  null = modal closed.  { id: "new", … } = "Add new" form.
 *
 * Components rendered:
 *   SearchInput  — filters the table by first + last name
 *   DataTable    — clickable table of filtered seniors
 *   Modal        → SeniorDetail — view and edit form inside the modal
 *
 * Data relationships displayed in SeniorDetail:
 *   - The senior's assigned visit team volunteers (from the groups/visitTeams mock)
 *   - Availability by day of week (stored as "HH:MM-HH:MM" strings on the senior record)
 */
import { useState } from "react";
import { Pencil } from "lucide-react";
import SearchInput from "../components/ui/SearchInput";
import DataTable from "../components/ui/DataTable";
import Badge from "../components/ui/Badge";
import Modal from "../components/ui/Modal";
import { seniors as initialSeniors } from "../mock/seniors";
import { visitTeams } from "../mock/groups";
import { volunteers } from "../mock/volunteers";
import "./Seniors.css";

/** Lowercase day names used for availability field keys (e.g. "mondayAvailability") */
const DAYS = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];

/**
 * Blank template for creating a new senior.
 * id: "new" is the sentinel value that distinguishes a create from an edit.
 */
const NEW_SENIOR = {
  id: "new",
  firstName: "", lastName: "", status: "active", ageRange: "70-79",
  community: "", timezone: "America/New_York", veteran: false,
  onboardingDate: "", notes: "",
  mondayAvailability: "", tuesdayAvailability: "", wednesdayAvailability: "",
  thursdayAvailability: "", fridayAvailability: "", saturdayAvailability: "",
  sundayAvailability: "",
};

/**
 * DataTable column definitions.
 * "availability" uses a custom renderer to convert the per-day fields into a
 * comma-separated list of abbreviated day names (e.g. "Mon, Wed, Fri").
 */
const columns = [
  { key: "name",         label: "Name",        render: (r) => `${r.firstName} ${r.lastName}` },
  { key: "ageRange",     label: "Age Range" },
  { key: "community",    label: "Community" },
  { key: "availability", label: "Availability", render: (r) => availableDays(r) },
  { key: "status",       label: "Status",       render: (r) => <Badge label={r.status} variant={r.status} /> },
];

/**
 * Returns a formatted string of days where the senior has availability set.
 * Example: "Mon, Wed, Fri". Returns "—" if no days have availability.
 * Uses slice(1,3) to abbreviate: "monday" → "Mo" → capitalizes first char → "Mo".
 * Actually: charAt(0).toUpperCase() + slice(1,3) = "Monday"[0]+[1..2] = "Mo" → we get "Mo".
 * Wait: charAt(0)="m".toUpperCase()="M", + "on" = "Mon". Correct.
 */
function availableDays(senior) {
  return DAYS.filter((d) => senior[`${d}Availability`])
    .map((d) => d.charAt(0).toUpperCase() + d.slice(1, 3)) // e.g. "monday" → "Mon"
    .join(", ") || "—";
}

/**
 * Returns all visit teams that have this senior as their assigned senior.
 * A senior can have at most one active team, but the function returns an array
 * for consistency with the groups data structure.
 */
function seniorGroupMembership(seniorId, groupsList) {
  return groupsList.filter((t) => t.seniorId === seniorId);
}

// ─── Main page component ──────────────────────────────────────────────────

export default function Seniors() {
  const [seniorsList, setSeniorsList] = useState(initialSeniors);
  const [query,       setQuery]       = useState("");
  const [selected,    setSelected]    = useState(null); // null = no modal open

  // Real-time name filter — case-insensitive substring match on full name
  const filtered = seniorsList.filter((s) =>
    `${s.firstName} ${s.lastName}`.toLowerCase().includes(query.toLowerCase())
  );

  /**
   * Handles both create (id="new") and update operations.
   * Create: assigns a timestamp-based ID and appends to the list.
   * Update: replaces the existing record in-place; keeps the modal open with updated data.
   */
  function saveSenior(updated) {
    if (updated.id === "new") {
      const record = { ...updated, id: `s-${Date.now()}` };
      setSeniorsList((prev) => [...prev, record]);
      setSelected(null); // close modal after create
    } else {
      setSeniorsList((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setSelected(updated); // update modal to reflect saved state
    }
  }

  // Modal title: "New Senior" for creates, or full name for existing records
  const modalTitle = selected
    ? (selected.id === "new" ? "New Senior" : `${selected.firstName} ${selected.lastName}`)
    : "";

  return (
    <div>
      <div className="page-header page-header--row">
        <div>
          <h1 className="page-title">Seniors</h1>
          <p className="page-subtitle">{seniorsList.length} seniors on record</p>
        </div>
        <button className="page-new-btn" onClick={() => setSelected(NEW_SENIOR)}>
          + New Senior
        </button>
      </div>

      <div className="list-toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Search seniors by name..." />
      </div>

      {/* Clicking any row opens the detail modal for that senior */}
      <DataTable columns={columns} rows={filtered} onRowClick={(row) => setSelected(row)} />

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={modalTitle}
      >
        {selected && (
          <SeniorDetail
            senior={selected}
            allGroups={visitTeams}
            onSave={saveSenior}
            onCancel={() => setSelected(null)}
          />
        )}
      </Modal>
    </div>
  );
}

// ─── SeniorDetail — modal content (view mode and edit mode) ───────────────

/**
 * SeniorDetail — renders either a read-only profile or an edit form.
 *
 * State:
 *   editing — true when in edit mode. Auto-true for new seniors (id="new").
 *   draft   — working copy of the senior's data while editing.
 *              Discarded on cancel (reverts to the `senior` prop).
 *
 * Props:
 *   senior    {object}   — The senior record to display/edit
 *   allGroups {array}    — Full visitTeams list (to show assigned volunteers)
 *   onSave    {function} — Called with the updated senior object on save
 *   onCancel  {function} — Called when user cancels a "new" creation
 */
function SeniorDetail({ senior, allGroups, onSave, onCancel }) {
  const [editing, setEditing] = useState(senior.id === "new");
  const [draft,   setDraft]   = useState(senior);

  /** Update a single field in the draft without touching the rest. */
  function setField(field, value) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  function save() {
    onSave(draft);
    setEditing(false);
  }

  function cancel() {
    if (senior.id === "new") {
      onCancel(); // close modal entirely for new records
    } else {
      setDraft(senior); // revert draft to saved state
      setEditing(false);
    }
  }

  // Find the visit teams associated with this senior
  const memberGroups = seniorGroupMembership(senior.id, allGroups);

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
            <option value="paused">Paused</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="form-row">
          <label className="form-label">Age Range</label>
          <select className="form-select" value={draft.ageRange} onChange={(e) => setField("ageRange", e.target.value)}>
            <option value="60-69">60–69</option>
            <option value="70-79">70–79</option>
            <option value="80-89">80–89</option>
            <option value="90+">90+</option>
          </select>
        </div>
        <div className="form-row">
          <label className="form-label">Community</label>
          <input className="form-input" value={draft.community} onChange={(e) => setField("community", e.target.value)} />
        </div>
        <div className="form-row">
          <label className="form-label">Timezone</label>
          <select className="form-select" value={draft.timezone} onChange={(e) => setField("timezone", e.target.value)}>
            <option value="America/New_York">Eastern</option>
            <option value="America/Chicago">Central</option>
            <option value="America/Denver">Mountain</option>
            <option value="America/Los_Angeles">Pacific</option>
          </select>
        </div>
        <div className="form-row form-row--checkbox">
          <label className="form-label">Veteran</label>
          <input type="checkbox" checked={draft.veteran} onChange={(e) => setField("veteran", e.target.checked)} />
        </div>

        {/* Availability inputs — one per day, blank = unavailable */}
        <p className="form-section-label">Availability (leave blank if unavailable)</p>
        {DAYS.map((day) => (
          <div key={day} className="form-row form-row--avail">
            <label className="form-label form-label--day">{day.charAt(0).toUpperCase() + day.slice(1)}</label>
            <input
              className="form-input"
              placeholder="e.g. 10:00-12:00"
              value={draft[`${day}Availability`] || ""}
              onChange={(e) => setField(`${day}Availability`, e.target.value)}
            />
          </div>
        ))}

        <div className="form-row form-row--full">
          <label className="form-label">Notes</label>
          <textarea
            className="form-textarea"
            rows={3}
            value={draft.notes || ""}
            onChange={(e) => setField("notes", e.target.value)}
          />
        </div>

        <div className="form-actions">
          <button className="edit-save-btn" onClick={save}>
            {senior.id === "new" ? "Add Senior" : "Save Changes"}
          </button>
          <button className="edit-cancel-btn" onClick={cancel}>Cancel</button>
        </div>
      </div>
    );
  }

  // ─── Read-only view ───────────────────────────────────────────────────
  return (
    <div className="senior-detail">
      <div className="detail-actions">
        <button className="detail-edit-trigger" onClick={() => setEditing(true)}>
          <Pencil size={14} /> Edit
        </button>
      </div>

      <div className="detail-row">
        <span className="detail-label">Status</span>
        <Badge label={senior.status} variant={senior.status} />
      </div>
      <div className="detail-row">
        <span className="detail-label">Age Range</span>
        <span>{senior.ageRange}</span>
      </div>
      <div className="detail-row">
        <span className="detail-label">Community</span>
        <span>{senior.community}</span>
      </div>
      <div className="detail-row">
        <span className="detail-label">Timezone</span>
        <span>{senior.timezone}</span>
      </div>
      <div className="detail-row">
        <span className="detail-label">Veteran</span>
        <span>{senior.veteran ? "Yes" : "No"}</span>
      </div>
      <div className="detail-row">
        <span className="detail-label">Onboarded</span>
        <span>{senior.onboardingDate}</span>
      </div>

      {/* Availability — only shows days that have a value set */}
      <div className="detail-section">
        <span className="detail-label">Availability</span>
        <div className="detail-availability">
          {DAYS.map((day) => {
            const val = senior[`${day}Availability`];
            return val ? (
              <div key={day} className="detail-avail-row">
                <span className="detail-avail-day">{day.charAt(0).toUpperCase() + day.slice(1)}</span>
                <span>{val}</span>
              </div>
            ) : null;
          })}
        </div>
      </div>

      {senior.notes && (
        <div className="detail-section">
          <span className="detail-label">Notes</span>
          <p className="detail-notes">{senior.notes}</p>
        </div>
      )}

      {/* Assigned volunteers — pulled from the visit teams that reference this senior */}
      <div className="detail-section">
        <span className="detail-label">Assigned Volunteers</span>
        {memberGroups.length === 0 ? (
          <p className="detail-none">No visit team assigned.</p>
        ) : memberGroups[0].volunteerIds.length === 0 ? (
          <p className="detail-none">No volunteers assigned yet.</p>
        ) : (
          memberGroups[0].volunteerIds.map((vid) => {
            const v = volunteers.find((vol) => vol.id === vid);
            return v ? (
              <div key={vid} className="detail-group-chip">{v.firstName} {v.lastName}</div>
            ) : null;
          })
        )}
      </div>
    </div>
  );
}
