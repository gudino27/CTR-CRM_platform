/**
 * Blackout dates: days a platform (or every platform) does not post. The server makes no
 * slots on them; adding one moves the posts in its slots back to the library to fill later
 * slots, and removing one brings the slots back. Locked and pinned slots on those days are
 * kept (they were placed by hand), and Specific Date posts are not moved: the page says so.
 * Without editSchedules the list is shown, not edited, like the schedule rules.
 *
 * What lives here: BlackoutDates (the Platforms page section), BlackoutForm (one blackout),
 * BlackoutNotice and useBlackouts (the warning in post forms), blackoutOn and rangeText.
 */

import { useEffect, useState } from "react";
import { api } from "../api.js";
import { formatSlotTime } from "../time.js";
import "../blackouts.css";

/**
 * The blackout covering a date for a platform.
 *
 * Usage:
 *   blackoutOn(blackouts, "2026-12-25", platform.id)   (Calendar.jsx, BlackoutNotice)
 *
 * Takes:
 *   blackouts  - rows from GET /api/blackouts ({ platformId (null = all), startDate, endDate, ... })
 *   date       - "YYYY-MM-DD" in the app zone, or empty
 *   platformId - the platform's id
 *
 * Returns:
 *   The first matching blackout (its own platform or all platforms, start and end days
 *   included), or undefined.
 *
 * When editing:
 *   The dates are compared as "YYYY-MM-DD" text, which sorts like the dates themselves.
 */
export function blackoutOn(blackouts, date, platformId) {
  if (!date) return undefined;
  return blackouts.find((b) => (b.platformId === null || b.platformId === platformId) && b.startDate <= date && date <= b.endDate);
}

/** "Fri, Dec 25, 2026" for "2026-12-25" (worked out in UTC, so no zone shifts the day). */
const dayText = (date) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
};
/**
 * A blackout's days in words.
 *
 * Usage:
 *   rangeText(blackout)   // "Thu, Dec 24, 2026 to Fri, Dec 25, 2026", or one day
 */
export const rangeText = (b) => (b.startDate === b.endDate ? dayText(b.startDate) : `${dayText(b.startDate)} to ${dayText(b.endDate)}`);

/**
 * Blackouts for a platform's Compose or Library form.
 *
 * Usage:
 *   const blackouts = useBlackouts(platformId);
 *
 * Takes:
 *   platformId - narrows the list (the all-platform ones are included); undefined for all
 *
 * Returns:
 *   The blackout rows; [] while loading or if the request fails (it is a warning only; the
 *   form works without it).
 *
 * How it works:
 *   Reads GET /api/blackouts once per mount and again when platformId changes.
 */
export function useBlackouts(platformId) {
  const [blackouts, setBlackouts] = useState([]);
  useEffect(() => {
    let current = true;
    api.blackouts(platformId)
      .then((rows) => current && setBlackouts(rows))
      .catch(() => current && setBlackouts([]));
    return () => {
      current = false;
    };
  }, [platformId]);
  return blackouts;
}

/**
 * Warning under a Specific Date field when the chosen day is a blackout day.
 *
 * Usage:
 *   <BlackoutNotice platformId={platform?.id} date={fixedDate} />   (Composer, Library, Calendar)
 *
 * Takes:
 *   platformId - the post's platform
 *   date       - the chosen "YYYY-MM-DD"
 *
 * Returns:
 *   The notice (the day, the platform or "all platforms", the reason), or nothing.
 *
 * When editing:
 *   The post is still allowed (a person chose that date); it is not moved automatically.
 */
export function BlackoutNotice({ platformId, date }) {
  const blackouts = useBlackouts(platformId);
  const hit = blackoutOn(blackouts, date, platformId);
  if (!hit) return null;
  return (
    <div className="blackout-notice" role="status">
      <p>
        {dayText(date)} is a blackout day for {hit.platformName ?? "all platforms"}
        {hit.reason ? ` (${hit.reason})` : ""}.
      </p>
      This Specific Date post will still go out at the time you chose. Pick another date if it should not.
    </div>
  );
}

// The form's fields as text: platformId "" = all platforms
const blank = { platformId: "", startDate: "", endDate: "", reason: "" };
const formOf = (b) => ({ platformId: b.platformId === null ? "" : String(b.platformId), startDate: b.startDate, endDate: b.endDate, reason: b.reason ?? "" });

/**
 * What the server kept on the blackout's days, said plainly, for the message after saving.
 *
 * Takes:
 *   saved     - the add/change answer, with keptSlots ([{ platformId, date, time, pinned }])
 *   platforms - platform rows, for the names
 *
 * Returns:
 *   " Kept because they were placed by hand: ...", or "" when nothing was kept.
 */
function keptText(saved, platforms) {
  const kept = saved.keptSlots ?? [];
  if (kept.length === 0) return "";
  const name = (id) => platforms.find((p) => p.id === id)?.name ?? "platform";
  const list = kept.map((s) => `${name(s.platformId)} ${s.date} ${formatSlotTime(s.date, s.time)} (${s.pinned ? "pinned" : "locked"})`).join(", ");
  return ` Kept because they were placed by hand: ${list}. Unlock or unpin them on the Calendar to clear those days.`;
}

/**
 * The Blackout Dates section of the Platforms page: the list, and for editors a form per
 * blackout plus "Add Blackout Dates".
 *
 * Usage:
 *   <BlackoutDates platforms={platforms} canEdit={Boolean(permissions.editSchedules)} />   (Platforms.jsx)
 *
 * Takes:
 *   platforms - platform rows, for the platform select and names
 *   canEdit   - true with editSchedules; otherwise the list is shown read-only
 *
 * Returns:
 *   The heading, an explanation, the list, the add button or form, and a success or error line.
 *
 * How it works:
 *   Loads every blackout (GET /api/blackouts) on mount and again after each save or delete.
 *
 * When editing:
 *   The server checks editSchedules too; canEdit only hides the forms.
 */
export default function BlackoutDates({ platforms, canEdit }) {
  const [blackouts, setBlackouts] = useState([]);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setBlackouts(await api.blackouts());
  }
  useEffect(() => {
    load().catch((error) => setMessage(error.message));
  }, []);

  async function saved(text) {
    setNotice(text);
    setMessage("");
    await load().catch((error) => setMessage(error.message));
  }

  return (
    <div className="blackout-dates">
      <h2>Blackout Dates</h2>
      <p className="field-hint">
        No posts are scheduled on blackout days. Library posts in those days&apos; slots go back to the library and
        fill the next matching slots; removing a blackout brings the slots back. Locked or pinned slots and Specific
        Date posts on a blackout day stay where they are and are flagged on the Calendar.
      </p>

      {blackouts.length === 0 ? (
        <p>No blackout dates.</p>
      ) : (
        <ul className="blackout-list">
          {blackouts.map((b) => (
            <li key={b.id}>
              {canEdit ? (
                <BlackoutForm blackout={b} platforms={platforms} onSaved={saved} />
              ) : (
                <p className="blackout-summary">
                  <strong>{rangeText(b)}</strong> · {b.platformName ?? "All platforms"}{b.reason ? ` · ${b.reason}` : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (adding ? (
        <BlackoutForm
          platforms={platforms}
          onSaved={async (text) => { setAdding(false); await saved(text); }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button type="button" className="secondary-button" onClick={() => { setAdding(true); setNotice(""); }}>
          Add Blackout Dates
        </button>
      ))}

      {notice && <p className="success-text" role="status">{notice}</p>}
      {message && <p className="error-text">{message}</p>}
    </div>
  );
}

/**
 * One blackout's fields (From, To, Platform, Reason) with Save, Undo, Cancel and Delete.
 *
 * Takes:
 *   blackout  - the row to change; without it the form makes a new one
 *   platforms - platform rows for the select
 *   onSaved   - called with the message to show after a save or delete (it reloads the list)
 *   onCancel  - shows Cancel when given (the new-blackout form)
 *
 * How it works:
 *   - An empty "To" means one day (endDate = startDate); "All platforms" is sent as
 *     platformId null; an empty reason as null.
 *   - Save is enabled only when something changed.
 *   - Delete asks inline first ("Yes, remove" / "Keep it"); removing gives the days their
 *     slots back, and library posts fill them.
 *
 * When editing:
 *   The reason's maxLength (200) matches the server's limit (MAX_REASON in
 *   server/src/routes/blackouts.js); keep them equal.
 */
function BlackoutForm({ blackout, platforms, onSaved, onCancel }) {
  const [draft, setDraft] = useState(blackout ? formOf(blackout) : blank);
  const [message, setMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const idBase = `blackout-${blackout?.id ?? "new"}`;
  const changed = !blackout || JSON.stringify(draft) !== JSON.stringify(formOf(blackout));

  function change(changes) {
    setDraft((current) => ({ ...current, ...changes }));
    setMessage("");
  }

  async function save(event) {
    event.preventDefault();
    const body = {
      platformId: draft.platformId === "" ? null : Number(draft.platformId),
      startDate: draft.startDate,
      endDate: draft.endDate || draft.startDate,
      reason: draft.reason.trim() || null,
    };
    try {
      const result = blackout ? await api.updateBlackout(blackout.id, body) : await api.addBlackout(body);
      await onSaved(`${blackout ? "Blackout saved" : "Blackout added"}: ${rangeText(result)}.${keptText(result, platforms)}`);
      if (blackout) setDraft(formOf(result));
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function remove() {
    try {
      await api.deleteBlackout(blackout.id);
      await onSaved(`Blackout removed: ${rangeText(blackout)}. Its days get their slots back.`);
    } catch (error) {
      setMessage(error.message);
      setConfirmDelete(false);
    }
  }

  return (
    <form className="blackout-form" onSubmit={save}>
      {blackout && (
        <p className="blackout-summary">
          <strong>{rangeText(blackout)}</strong> · {blackout.platformName ?? "All platforms"}
          {blackout.reason ? ` · ${blackout.reason}` : ""}
        </p>
      )}
      <div className="blackout-row">
        <div>
          <label htmlFor={`${idBase}-start`}>From</label>
          <input
            id={`${idBase}-start`}
            type="date"
            required
            value={draft.startDate}
            onChange={(event) => change({ startDate: event.target.value })}
          />
        </div>
        <div>
          <label htmlFor={`${idBase}-end`}>To (optional)</label>
          <input
            id={`${idBase}-end`}
            type="date"
            min={draft.startDate || undefined}
            value={draft.endDate}
            onChange={(event) => change({ endDate: event.target.value })}
          />
          {!draft.endDate && <p className="field-hint">Leave empty for one day.</p>}
        </div>
        <div>
          <label htmlFor={`${idBase}-platform`}>Platform</label>
          <select id={`${idBase}-platform`} value={draft.platformId} onChange={(event) => change({ platformId: event.target.value })}>
            <option value="">All platforms</option>
            {platforms.map((p) => (
              <option key={p.id} value={String(p.id)}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="blackout-reason">
          <label htmlFor={`${idBase}-reason`}>Reason (optional)</label>
          <input
            id={`${idBase}-reason`}
            type="text"
            maxLength={200}
            placeholder="e.g. Office closed"
            value={draft.reason}
            onChange={(event) => change({ reason: event.target.value })}
          />
        </div>
      </div>

      <div className="post-actions">
        <button type="submit" disabled={!changed || !draft.startDate}>{blackout ? "Save Blackout" : "Add Blackout"}</button>
        {blackout && changed && (
          <button type="button" className="secondary-button" onClick={() => setDraft(formOf(blackout))}>Undo changes</button>
        )}
        {onCancel && <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>}
        {blackout && !confirmDelete && (
          <button type="button" className="remove-button" onClick={() => setConfirmDelete(true)}>Delete Blackout</button>
        )}
        {confirmDelete && (
          <span role="alert">
            Remove this blackout? Its days get their slots back, and library posts fill them.{" "}
            <button type="button" className="remove-button" onClick={remove}>Yes, remove</button>
            <button type="button" className="secondary-button" onClick={() => setConfirmDelete(false)}>Keep it</button>
          </span>
        )}
      </div>

      {message && <p className="error-text">{message}</p>}
    </form>
  );
}
