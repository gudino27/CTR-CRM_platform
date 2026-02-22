/**
 * Groups.jsx — Visit Teams page: team management cards + rotation scheduler + month calendar
 *
 * This is the most complex page in the app. It manages:
 *
 *   1. Visit Teams (one card per senior)
 *      - Add/remove volunteers from each team
 *      - Edit visit schedule (day of week + time, multiple slots allowed)
 *      - Remove a senior's team entirely (with confirmation)
 *
 *   2. Rotation Scheduling
 *      - Clicking "4 weeks / 8 weeks / 12 weeks / Custom" on a card calls generateRotations()
 *      - Rotations are assigned in round-robin order across the team's volunteers
 *      - Each schedule slot (e.g. "Mondays 10:00") generates independent rotations
 *        (scheduleIndex tracks which slot within a multi-day team schedule)
 *
 *   3. Rotation Calendar
 *      - Month-view calendar at the bottom showing all rotation assignments
 *      - Volunteer initials appear on each day that has a rotation visit
 *
 * Key data models:
 *   teams     — Each team: { id, seniorId, volunteerIds[], schedule[{ dayOfWeek, timeOfDay }] }
 *   rotations — Each rotation: { id, teamId, scheduleIndex, assignedVolunteerId, weekStartDate, status }
 *               weekStartDate is always Monday (ISO format "yyyy-MM-dd")
 *
 * State:
 *   teams / rotations   — Live data (starts from mock, updated in-place on all edits)
 *   lookupOpen          — Controls the volunteer-add slide-in panel
 *   lookupTeamId        — Which team's volunteer panel is open
 *   lookupQuery         — Search filter for the volunteer lookup panel
 *   seniorLookupOpen    — Controls the new-team / add-senior slide-in panel
 *   seniorLookupQuery   — Search filter for the senior lookup panel
 *   calMonth / calYear  — Controls the rotation calendar's displayed month
 *
 * TODO (Sprint 3): Wire to Baserow API via baserowApi.js:
 *   Reads:  VOLUNTEER_TEAM, TEAM_MEMBER, SENIOR, VOLUNTEER, MEETING_INSTANCE tables
 *   Writes: Through N8N webhooks (adding/removing team members triggers calendar recalculation)
 */
import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, X, UserPlus, Video } from "lucide-react";
import Badge from "../components/ui/Badge";
import SearchInput from "../components/ui/SearchInput";
import { visitTeams as initialTeams } from "../mock/groups";
import { seniors } from "../mock/seniors";
import { volunteers } from "../mock/volunteers";
import { rotations as initialRotations } from "../mock/rotations";
import {
  format,
  addWeeks,
  startOfWeek,
  getMonth,
  getYear,
  getDaysInMonth,
  startOfMonth,
  getDay,
} from "date-fns";
import "./Groups.css";

/** Abbreviated day labels for the month calendar header (Sun-Sat) */
const DAY_LABELS   = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Full day names indexed 0=Sunday … 6=Saturday */
const DAY_NAMES    = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTH_LABELS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

// ─── Utility helpers ──────────────────────────────────────────────────────

/** Look up a senior record by ID */
function seniorById(id)    { return seniors.find((s) => s.id === id); }
/** Look up a volunteer record by ID */
function volunteerById(id) { return volunteers.find((v) => v.id === id); }
/** Returns two-letter initials for a person, e.g. "JD". Returns "?" if person is null. */
function initials(person)  { return person ? `${person.firstName[0]}${person.lastName[0]}` : "?"; }

/**
 * Returns abbreviated day names where the senior has availability set.
 * Example: "Mon, Wed" — used in the card header below the senior's name.
 */
function availableDays(senior) {
  const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
  return days.filter((d) => senior[`${d}Availability`])
    .map((d) => d.charAt(0).toUpperCase() + d.slice(1, 3))
    .join(", ") || "None listed";
}

/**
 * Returns the next N rotation records for a team, sorted by date (then scheduleIndex).
 * Filters to only future rotations (weekStartDate >= today).
 *
 * @param {string} teamId
 * @param {Array}  allRotations
 * @param {number} n — Number of upcoming rotations to return
 */
function nextNRotations(teamId, allRotations, n) {
  const todayStr = format(new Date(), "yyyy-MM-dd");
  return allRotations
    .filter((r) => r.teamId === teamId && r.weekStartDate >= todayStr)
    .sort((a, b) => {
      if (a.weekStartDate !== b.weekStartDate) return a.weekStartDate > b.weekStartDate ? 1 : -1;
      return (a.scheduleIndex ?? 0) - (b.scheduleIndex ?? 0);
    })
    .slice(0, n);
}

/**
 * Converts a rotation record + schedule slot into the actual calendar Date of the visit.
 *
 * weekStartDate is always Monday; dayOfWeek is 0=Sun through 6=Sat.
 * Offset: Sunday (0) is 6 days after Monday. Mon(1)=+0, Tue(2)=+1, … Sat(6)=+5, Sun(0)=+6.
 *
 * @param {object} rotation — Has weekStartDate "yyyy-MM-dd"
 * @param {object} slot     — Has dayOfWeek (0–6)
 * @returns {Date}
 */
function visitDate(rotation, slot) {
  const [y, m, d] = rotation.weekStartDate.split("-").map(Number);
  const dow    = slot.dayOfWeek;
  const offset = dow === 0 ? 6 : dow - 1; // days after Monday
  return new Date(y, m - 1, d + offset);
}

/**
 * Generates new rotation records for a team's schedule slot, continuing from the last
 * existing rotation (preserving round-robin order across re-generates).
 *
 * Algorithm:
 *   1. Find the latest existing rotation for this team+slot
 *   2. Start the new rotations from the week after the latest
 *   3. Pick the next volunteer in round-robin order (continuing from where we left off)
 *   4. Generate numWeeks new records
 *
 * @param {string} teamId
 * @param {number} scheduleIndex — Which slot within the team's schedule[] array
 * @param {string[]} volunteerIds — IDs of volunteers to rotate through
 * @param {number} numWeeks — How many weeks to generate
 * @param {Array}  existingRotations — All current rotation records (to find the last one)
 * @returns {Array} New rotation records to append
 */
function generateRotations(teamId, scheduleIndex, volunteerIds, numWeeks, existingRotations) {
  if (volunteerIds.length === 0) return [];

  // Find existing rotations for this specific team+slot
  const existing = existingRotations.filter(
    (r) => r.teamId === teamId && (r.scheduleIndex ?? 0) === scheduleIndex
  );

  // Find the latest Monday (week start) in existing rotations, or use today if none exist
  const latestDate = existing.reduce((acc, r) => {
    const [y, m, d] = r.weekStartDate.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return date > acc ? date : acc;
  }, new Date());

  const result = [];
  // Continue round-robin from the position after the last existing assignment
  let idx       = existing.length % volunteerIds.length;
  // Start from the week after the latest existing rotation
  let weekStart = addWeeks(startOfWeek(latestDate, { weekStartsOn: 1 }), 1);

  for (let i = 0; i < numWeeks; i++) {
    result.push({
      id:                  `r-gen-${Date.now()}-${teamId}-${scheduleIndex}-${i}`,
      teamId,
      scheduleIndex,
      assignedVolunteerId: volunteerIds[idx % volunteerIds.length],
      weekStartDate:       format(weekStart, "yyyy-MM-dd"),
      status:              "scheduled",
    });
    idx++;
    weekStart = addWeeks(weekStart, 1);
  }
  return result;
}

// ─── Main page component ──────────────────────────────────────────────────

export default function Groups() {
  const [teams,     setTeams]     = useState(initialTeams);
  const [rotations, setRotations] = useState(initialRotations);

  // Volunteer lookup panel (slide-in, triggered from a team card's "+ Add" button)
  const [lookupOpen,   setLookupOpen]   = useState(false);
  const [lookupTeamId, setLookupTeamId] = useState(null);
  const [lookupQuery,  setLookupQuery]  = useState("");

  // Senior lookup panel (slide-in, triggered from "+ Add Senior" in page header)
  const [seniorLookupOpen,  setSeniorLookupOpen]  = useState(false);
  const [seniorLookupQuery, setSeniorLookupQuery] = useState("");

  // Rotation calendar month/year navigation
  const [calMonth, setCalMonth] = useState(getMonth(new Date()));
  const [calYear,  setCalYear]  = useState(getYear(new Date()));

  /** Opens the volunteer lookup panel for a specific team */
  function openVolunteerLookup(teamId) {
    setLookupTeamId(teamId);
    setLookupQuery("");
    setLookupOpen(true);
  }

  /**
   * Adds a volunteer to the team currently open in the lookup panel.
   * Idempotent — won't add a duplicate if already on the team.
   */
  function addVolunteerToTeam(volunteerId) {
    setTeams((prev) =>
      prev.map((t) => {
        if (t.id !== lookupTeamId)               return t;
        if (t.volunteerIds.includes(volunteerId)) return t; // already a member
        return { ...t, volunteerIds: [...t.volunteerIds, volunteerId] };
      })
    );
    setLookupOpen(false);
  }

  /** Removes a volunteer from a specific team (does not delete any rotation records) */
  function removeVolunteerFromTeam(teamId, volunteerId) {
    setTeams((prev) =>
      prev.map((t) =>
        t.id === teamId
          ? { ...t, volunteerIds: t.volunteerIds.filter((id) => id !== volunteerId) }
          : t
      )
    );
  }

  /**
   * Creates a new team for an unassigned senior.
   * Default schedule: Monday at 10:00 (staff can edit it after creation).
   */
  function addSeniorTeam(seniorId) {
    const newTeam = {
      id:           `t-${Date.now()}`,
      seniorId,
      volunteerIds: [],
      schedule:     [{ dayOfWeek: 1, timeOfDay: "10:00" }], // default: Monday 10am
      isActive:     true,
    };
    setTeams((prev) => [...prev, newTeam]);
    setSeniorLookupOpen(false);
    setSeniorLookupQuery("");
  }

  /**
   * Removes a team and all its rotation records.
   * Called after the user confirms the destructive action in the card's confirmation state.
   */
  function removeSeniorTeam(teamId) {
    setTeams((prev) => prev.filter((t) => t.id !== teamId));
    setRotations((prev) => prev.filter((r) => r.teamId !== teamId));
  }

  /**
   * Generates and appends new rotation records for all schedule slots of a team.
   * Called when user clicks "4 weeks", "8 weeks", "12 weeks", or a custom number.
   */
  function scheduleRotations(teamId, volunteerIds, numWeeks) {
    const team = teams.find((t) => t.id === teamId);
    if (!team) return;
    // Generate rotations for every slot in the team's schedule (flatMap)
    const newRots = team.schedule.flatMap((_, si) =>
      generateRotations(teamId, si, volunteerIds, numWeeks, rotations)
    );
    setRotations((prev) => [...prev, ...newRots]);
  }

  /** Saves an edited visit schedule (day/time slots) to a team */
  function saveSchedule(teamId, schedule) {
    setTeams((prev) =>
      prev.map((t) => (t.id === teamId ? { ...t, schedule } : t))
    );
  }

  /**
   * Computes all rotation visit dates that fall within the currently displayed calendar month.
   * Returns { date: Date, volunteerId: string } objects for the MonthCalendar component.
   * useMemo recalculates only when rotations, teams, or the displayed month/year change.
   */
  const rotationDatesThisMonth = useMemo(() => {
    return rotations.flatMap((r) => {
      const team = teams.find((t) => t.id === r.teamId);
      if (!team) return [];
      const slot = team.schedule[r.scheduleIndex ?? 0];
      if (!slot) return [];
      const vd = visitDate(r, slot);
      // Filter to only dates within the displayed calendar month
      if (vd.getMonth() !== calMonth || vd.getFullYear() !== calYear) return [];
      return [{ date: vd, volunteerId: r.assignedVolunteerId }];
    });
  }, [rotations, teams, calMonth, calYear]);

  /**
   * Volunteers eligible to add to a team = all volunteers minus those already on the team.
   * Filtered by the search query in the lookup panel.
   */
  const lookupResults = useMemo(() => {
    const team   = teams.find((t) => t.id === lookupTeamId);
    const already = team?.volunteerIds ?? [];
    return volunteers.filter(
      (v) =>
        !already.includes(v.id) &&
        `${v.firstName} ${v.lastName}`.toLowerCase().includes(lookupQuery.toLowerCase())
    );
  }, [lookupTeamId, lookupQuery, teams]);

  /** Seniors who don't yet have a visit team (only these can be added via "+ Add Senior") */
  const unassignedSeniors = useMemo(() => {
    const assignedIds = new Set(teams.map((t) => t.seniorId));
    return seniors.filter((s) => !assignedIds.has(s.id));
  }, [teams]);

  const seniorLookupResults = useMemo(() => {
    return unassignedSeniors.filter((s) =>
      `${s.firstName} ${s.lastName}`.toLowerCase().includes(seniorLookupQuery.toLowerCase())
    );
  }, [unassignedSeniors, seniorLookupQuery]);

  /** Navigate to previous month (wraps year) */
  function prevMonth() {
    if (calMonth === 0) { setCalMonth(11); setCalYear((y) => y - 1); }
    else setCalMonth((m) => m - 1);
  }
  /** Navigate to next month (wraps year) */
  function nextMonth() {
    if (calMonth === 11) { setCalMonth(0); setCalYear((y) => y + 1); }
    else setCalMonth((m) => m + 1);
  }

  return (
    <div className="groups-page">
      <div className="page-header page-header--row">
        <div>
          <h1 className="page-title">Visit Teams</h1>
          <p className="page-subtitle">Each senior has their own virtual visit team</p>
        </div>
        {/* Disabled when all seniors already have teams */}
        <button
          className="page-new-btn"
          onClick={() => { setSeniorLookupOpen(true); setSeniorLookupQuery(""); }}
          disabled={unassignedSeniors.length === 0}
        >
          + Add Senior
        </button>
      </div>

      {/* Team cards grid — one card per senior with their visit team */}
      <div className="groups-grid">
        {teams.map((team) => {
          const senior = seniorById(team.seniorId);
          if (!senior) return null; // skip orphaned teams with missing senior data
          return (
            <VisitTeamCard
              key={team.id}
              team={team}
              senior={senior}
              rotations={rotations}
              onAddVolunteer={() => openVolunteerLookup(team.id)}
              onRemoveVolunteer={(vid) => removeVolunteerFromTeam(team.id, vid)}
              onSchedule={(n) => scheduleRotations(team.id, team.volunteerIds, n)}
              onSaveSchedule={(sched) => saveSchedule(team.id, sched)}
              onRemove={() => removeSeniorTeam(team.id)}
            />
          );
        })}
      </div>

      {/* Rotation Calendar — month view of all scheduled visits */}
      <section className="groups-calendar">
        <div className="groups-calendar__header">
          <h2 className="dashboard-section__title">Rotation Calendar</h2>
          <div className="groups-calendar__nav">
            <button className="cal-nav-btn" onClick={prevMonth}><ChevronLeft size={16} /></button>
            <span className="cal-nav-label">{MONTH_LABELS[calMonth]} {calYear}</span>
            <button className="cal-nav-btn" onClick={nextMonth}><ChevronRight size={16} /></button>
          </div>
        </div>
        <MonthCalendar
          month={calMonth}
          year={calYear}
          rotationDates={rotationDatesThisMonth}
        />
      </section>

      {/* Volunteer lookup slide-in panel — opens when clicking "+ Add" on a team card */}
      {lookupOpen && (
        <div className="lookup-backdrop" onClick={() => setLookupOpen(false)}>
          <div className="lookup-panel" onClick={(e) => e.stopPropagation()}>
            <div className="lookup-panel__header">
              <span className="lookup-panel__title">Add Volunteer</span>
              <button onClick={() => setLookupOpen(false)} className="lookup-panel__close">
                <X size={18} />
              </button>
            </div>
            <SearchInput
              value={lookupQuery}
              onChange={setLookupQuery}
              placeholder="Search volunteers..."
            />
            <div className="lookup-results">
              {lookupResults.map((v) => (
                <button
                  key={v.id}
                  className="lookup-result-item"
                  onClick={() => addVolunteerToTeam(v.id)}
                >
                  <span className="lookup-result-avatar">{initials(v)}</span>
                  <div>
                    <div>{v.firstName} {v.lastName}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{v.school}</div>
                  </div>
                </button>
              ))}
              {lookupResults.length === 0 && (
                <p className="lookup-empty">No volunteers found.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Senior lookup slide-in panel — opens when clicking "+ Add Senior" in page header */}
      {seniorLookupOpen && (
        <div className="lookup-backdrop" onClick={() => setSeniorLookupOpen(false)}>
          <div className="lookup-panel" onClick={(e) => e.stopPropagation()}>
            <div className="lookup-panel__header">
              <span className="lookup-panel__title">Add Senior to Visit Teams</span>
              <button onClick={() => setSeniorLookupOpen(false)} className="lookup-panel__close">
                <X size={18} />
              </button>
            </div>
            <SearchInput
              value={seniorLookupQuery}
              onChange={setSeniorLookupQuery}
              placeholder="Search seniors..."
            />
            <div className="lookup-results">
              {seniorLookupResults.map((s) => (
                <button
                  key={s.id}
                  className="lookup-result-item"
                  onClick={() => addSeniorTeam(s.id)}
                >
                  <span className="lookup-result-avatar">{initials(s)}</span>
                  <div>
                    <div>{s.firstName} {s.lastName}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{s.community}</div>
                  </div>
                </button>
              ))}
              {seniorLookupResults.length === 0 && (
                <p className="lookup-empty">
                  {unassignedSeniors.length === 0
                    ? "All seniors already have visit teams."
                    : "No seniors found."}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── VisitTeamCard — individual team card component ───────────────────────

/**
 * VisitTeamCard — renders one team card with 4 sections:
 *   1. Senior header (avatar, name, community, availability, status badge, remove button)
 *   2. Visit Schedule (day+time badges, editable inline)
 *   3. Volunteer team (chips with initials + remove ×, + Add button)
 *   4. Rotation scheduler (preset buttons: 4/8/12 weeks + custom input)
 *   5. Upcoming rotations (next 4 visits with date and assigned volunteer)
 *
 * When "confirmRemove" is true, the card shows a destructive-action confirmation instead.
 *
 * Props:
 *   team             {object}   — The visit team data
 *   senior           {object}   — The senior record for this team
 *   rotations        {Array}    — All rotation records (filtered internally for this team)
 *   onAddVolunteer   {fn}       — Opens the volunteer lookup panel
 *   onRemoveVolunteer {fn(vid)} — Removes a volunteer from this team
 *   onSchedule       {fn(n)}    — Generates n weeks of rotations
 *   onSaveSchedule   {fn(sched)}— Saves an edited schedule
 *   onRemove         {fn}       — Removes this team (after confirmation)
 */
function VisitTeamCard({ team, senior, rotations, onAddVolunteer, onRemoveVolunteer, onSchedule, onSaveSchedule, onRemove }) {
  const [customWeeks,   setCustomWeeks]   = useState("");
  const [editSchedule,  setEditSchedule]  = useState(false);
  const [draftSchedule, setDraftSchedule] = useState(team.schedule); // working copy during edit
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Next 4 upcoming rotations for the "Upcoming" section
  const upcoming = nextNRotations(team.id, rotations, 4);

  /** Updates a single field (dayOfWeek or timeOfDay) on a draft schedule slot */
  function updateSlot(i, field, value) {
    setDraftSchedule((prev) => prev.map((s, si) => si === i ? { ...s, [field]: value } : s));
  }
  /** Adds a new schedule slot (default: Monday 10:00) */
  function addSlot() {
    setDraftSchedule((prev) => [...prev, { dayOfWeek: 1, timeOfDay: "10:00" }]);
  }
  /** Removes a schedule slot by index (disabled when only one slot remains) */
  function removeSlot(i) {
    setDraftSchedule((prev) => prev.filter((_, si) => si !== i));
  }
  /** Saves the edited schedule and exits edit mode */
  function saveScheduleEdit() {
    onSaveSchedule(draftSchedule);
    setEditSchedule(false);
  }

  // ─── Confirm removal view ─────────────────────────────────────────────
  if (confirmRemove) {
    return (
      <div className="group-card group-card--confirm">
        <div className="visit-team__senior-header" style={{ paddingBottom: "0.75rem" }}>
          <div className="visit-team__avatar">{initials(senior)}</div>
          <div className="visit-team__senior-info">
            <div className="visit-team__senior-name">{senior.firstName} {senior.lastName}</div>
            <div className="visit-team__senior-meta">{senior.community}</div>
          </div>
        </div>
        <p className="group-card__confirm-msg">
          Remove <strong>{senior.firstName} {senior.lastName}</strong> from Visit Teams? Their volunteer assignments and rotation schedule will be permanently deleted.
        </p>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="remove-confirm-btn" onClick={onRemove}>Yes, Remove</button>
          <button className="edit-cancel-btn" onClick={() => setConfirmRemove(false)}>Cancel</button>
        </div>
      </div>
    );
  }

  // ─── Normal card view ─────────────────────────────────────────────────
  return (
    <div className="group-card">

      {/* Senior header: avatar, name, community, availability, status, virtual badge, × remove */}
      <div className="visit-team__senior-header">
        <div className="visit-team__avatar">{initials(senior)}</div>
        <div className="visit-team__senior-info">
          <div className="visit-team__senior-name">{senior.firstName} {senior.lastName}</div>
          <div className="visit-team__senior-meta">{senior.community}</div>
          <div className="visit-team__senior-meta">Available: {availableDays(senior)}</div>
        </div>
        <div className="visit-team__badges">
          <Badge label={senior.status} variant={senior.status} />
          <span className="visit-team__virtual">
            <Video size={12} /> Virtual
          </span>
          <button
            className="visit-team__remove-btn"
            onClick={() => setConfirmRemove(true)}
            title="Remove from Visit Teams"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Visit Schedule section — shows day/time badges or inline edit form */}
      <div className="group-card__section">
        <div className="group-card__section-header">
          <span className="group-card__section-label">Visit Schedule</span>
          {!editSchedule && (
            <button className="group-card__add-btn" onClick={() => setEditSchedule(true)}>
              Edit
            </button>
          )}
        </div>

        {editSchedule ? (
          // Edit form: one row per schedule slot with day selector + time input + optional × remove
          <div>
            {draftSchedule.map((slot, i) => (
              <div key={i} className="group-edit-row" style={{ alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
                <select
                  className="edit-select"
                  value={slot.dayOfWeek}
                  onChange={(e) => updateSlot(i, "dayOfWeek", Number(e.target.value))}
                >
                  {DAY_NAMES.map((d, di) => <option key={di} value={di}>{d}</option>)}
                </select>
                <input
                  type="time"
                  className="edit-input edit-input--time"
                  value={slot.timeOfDay}
                  onChange={(e) => updateSlot(i, "timeOfDay", e.target.value)}
                />
                {/* Slot remove button — hidden when only one slot remains */}
                {draftSchedule.length > 1 && (
                  <button
                    className="edit-cancel-btn"
                    style={{ padding: "0.2rem 0.5rem" }}
                    onClick={() => removeSlot(i)}
                  >×</button>
                )}
              </div>
            ))}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
              <button className="group-card__add-btn" onClick={addSlot}>+ Add Day</button>
              <button className="edit-save-btn" onClick={saveScheduleEdit}>Save</button>
              <button className="edit-cancel-btn" onClick={() => setEditSchedule(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          // Read-only view: badges like "Mondays at 10:00"
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
            {team.schedule.map((slot, i) => (
              <span key={i} className="visit-team__schedule-badge">
                {DAY_NAMES[slot.dayOfWeek]}s at {slot.timeOfDay}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Volunteer team section — member chips + Add button */}
      <div className="group-card__section">
        <div className="group-card__section-header">
          <span className="group-card__section-label">
            Volunteers ({team.volunteerIds.length})
          </span>
          <button className="group-card__add-btn" onClick={onAddVolunteer}>
            <UserPlus size={14} /> Add
          </button>
        </div>
        <div className="group-card__members">
          {team.volunteerIds.length === 0 && (
            <span className="group-card__empty">No volunteers assigned.</span>
          )}
          {team.volunteerIds.map((vid) => {
            const v = volunteerById(vid);
            return v ? (
              <div key={vid} className="member-chip member-chip--volunteer">
                <span className="member-chip__avatar member-chip__avatar--vol">{initials(v)}</span>
                <span>{v.firstName} {v.lastName}</span>
                <button
                  className="member-chip__remove"
                  onClick={() => onRemoveVolunteer(vid)}
                  aria-label="Remove volunteer"
                >
                  <X size={11} />
                </button>
              </div>
            ) : null;
          })}
        </div>
      </div>

      {/* Rotation scheduler — preset week counts + custom input */}
      <div className="group-card__section">
        <span className="group-card__section-label">Schedule Rotation</span>
        <div className="group-card__schedule-btns">
          {/* Quick presets */}
          {[4, 8, 12].map((n) => (
            <button key={n} className="schedule-preset-btn" onClick={() => onSchedule(n)}>
              {n} weeks
            </button>
          ))}
          {/* Custom weeks input */}
          <div className="schedule-custom">
            <input
              type="number"
              min="1"
              max="52"
              className="schedule-custom__input"
              placeholder="Custom"
              value={customWeeks}
              onChange={(e) => setCustomWeeks(e.target.value)}
            />
            <button
              className="schedule-preset-btn schedule-preset-btn--primary"
              disabled={!customWeeks || team.volunteerIds.length === 0}
              onClick={() => { onSchedule(Number(customWeeks)); setCustomWeeks(""); }}
            >
              Go
            </button>
          </div>
        </div>
      </div>

      {/* Upcoming rotations — next 4 visits with date and volunteer name */}
      {upcoming.length > 0 && (
        <div className="group-card__section">
          <span className="group-card__section-label">Upcoming</span>
          {upcoming.map((r) => {
            const slot  = team.schedule[r.scheduleIndex ?? 0];
            // Format the actual visit date (e.g. "Mar 3") from the rotation's weekStartDate + dayOfWeek
            const vdStr = slot ? format(visitDate(r, slot), "MMM d") : r.weekStartDate;
            const v     = volunteerById(r.assignedVolunteerId);
            return (
              <div key={r.id} className="rotation-row">
                <span className="rotation-row__date">{vdStr}</span>
                <span className="rotation-row__name">{v ? `${v.firstName} ${v.lastName}` : "—"}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── MonthCalendar — mini month calendar showing rotation assignments ─────

/**
 * MonthCalendar — renders a standard Sun-Sat month grid.
 * Each day cell shows volunteer initials chips for any rotation visits on that day.
 *
 * Props:
 *   month          {number} — 0-indexed month (0=January)
 *   year           {number}
 *   rotationDates  {Array}  — [{ date: Date, volunteerId: string }] for the current month
 */
function MonthCalendar({ month, year, rotationDates }) {
  const daysInMonth    = getDaysInMonth(new Date(year, month, 1));
  const firstDayOfWeek = getDay(startOfMonth(new Date(year, month, 1))); // 0=Sun

  // Build cell array: leading null entries for days before the 1st, then 1…daysInMonth
  const cells = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);  // blank cells before day 1
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  /** Returns all rotation visits on a given day-of-month number */
  function rotationsOnDay(day) {
    return rotationDates.filter((rd) => rd.date.getDate() === day);
  }

  return (
    <div className="month-cal">
      {/* Day-of-week header: Sun Mon Tue … Sat */}
      <div className="month-cal__header">
        {DAY_LABELS.map((d) => (
          <div key={d} className="month-cal__day-label">{d}</div>
        ))}
      </div>
      {/* Grid cells — 7 columns, variable rows */}
      <div className="month-cal__grid">
        {cells.map((day, i) => {
          const rots = day ? rotationsOnDay(day) : [];
          return (
            <div key={i} className={`month-cal__cell${day ? "" : " month-cal__cell--empty"}`}>
              {day && <span className="month-cal__day-num">{day}</span>}
              {/* Volunteer initials chips — one per rotation visit on this day */}
              {rots.map((r, ri) => {
                const v = volunteerById(r.volunteerId);
                return (
                  <div key={ri} className="month-cal__chip">
                    {v ? initials(v) : "?"}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
