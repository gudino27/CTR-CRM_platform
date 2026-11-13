/**
 * Platforms page (deliverable 2): each platform's schedule rules, calendar color and post
 * types, plus the blackout dates section.
 * Saving a rule regenerates the platform's future, unlocked slots and updates its calendar events.
 * Controls the signed-in user may not use are left out rather than refused by the server.
 *
 * What lives here:
 *   days            rule day codes and labels, Monday first
 *   Platforms       the page (route /platforms)
 *   ruleTimeHint    "Your time: ..." under a rule's time, for viewers elsewhere
 *   describeRule    one-line summary of a rule
 *   ScheduleRules   a platform's list of rules (read-only or editable)
 *   blankRule       the fields of a new rule
 *   RuleForm        one rule's fields, save and delete
 *   sequenceOf      a rule's post type order as shown vs as stored
 *   SequenceEditor  reorder / repeat / remove a rule's post types
 *   PostTypeEditor  add, rename, and move post types in or out of the rotation
 */

import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { calendarColors } from "../calendarColors.js";
import { useCurrentUser } from "../currentUser.js";
import { appTimeZone, formatSlotTime, viewerTime, zoneCity, zonedParts, zonedToInstant } from "../time.js";
import BlackoutDates from "../components/BlackoutDates.jsx";

// Rule day codes (as stored in scheduleRule.byDay) with their labels, Sunday first like the Calendar.
// The order is the order days are saved in byDay and shown in summaries.
const days = [
  ["SU", "Sunday"],
  ["MO", "Monday"],
  ["TU", "Tuesday"],
  ["WE", "Wednesday"],
  ["TH", "Thursday"],
  ["FR", "Friday"],
  ["SA", "Saturday"],
];

/**
 * The Platforms page: blackout dates on top, then one block per platform with its
 * schedule rules, Google Calendar color and post types.
 *
 * Usage:
 *   Rendered by App.jsx for the /platforms route: <Platforms />
 *
 * Returns:
 *   The page section. Each part is editable only with its permission: blackouts and rules
 *   need editSchedules, calendar color needs editPlatforms, post types need
 *   managePostTypes; otherwise they are shown read-only.
 *
 * How it works:
 *   1. Loads all platforms (with rules and post types) once.
 *   2. Rules and post types save right away; the server returns the whole
 *      platform, which replaces the old copy (replacePlatform).
 *   3. Calendar colors are only changed locally until "Save Calendar Colors", which
 *      PATCHes every platform's calendarColorId.
 *
 * When editing:
 *   The color ids and names are Google's (calendarColors.js). The server side is
 *   server/src/routes/platforms.js; rule changes regenerate slots there
 *   (server/src/services/projection.js).
 */
export default function Platforms() {
  const { permissions } = useCurrentUser();
  const [platforms, setPlatforms] = useState([]);
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => {
    api.platforms()
      .then(setPlatforms)
      .catch((error) => setSavedMessage(error.message));
  }, []);

  // Puts the whole platform the server returned in place of the old copy
  function replacePlatform(saved) {
    setPlatforms((current) => current.map((p) => (p.id === saved.id ? saved : p)));
  }

  // Local-only change (the calendar color select) until handleSave
  function updatePlatform(id, changes) {
    setPlatforms((currentPlatforms) =>
      currentPlatforms.map((platform) =>
        platform.id === id
          ? {
              ...platform,
              ...changes,
            }
          : platform
      )
    );

    setSavedMessage("");
  }

  // "Save Calendar Colors": sends every platform's calendarColorId (one PATCH each)
  async function handleSave() {
    try {
      const saved = await Promise.all(
        platforms.map((platform) =>
          api.updatePlatform(platform.id, {
            calendarColorId: platform.calendarColorId,
          })
        )
      );

      setPlatforms(saved);
      setSavedMessage("Calendar colors saved.");
    } catch (error) {
      setSavedMessage(error.message);
    }
  }

  return (
    <section>
      <h1>Platforms</h1>

      <p>
        Set when each platform posts, its post types, and its calendar color.
      </p>

      <BlackoutDates platforms={platforms} canEdit={Boolean(permissions.editSchedules)} />

      {platforms.map((platform) => (
        <div key={platform.id}>
          <h2>{platform.name}</h2>

          <ScheduleRules platform={platform} canEdit={Boolean(permissions.editSchedules)} onChange={replacePlatform} />

          {permissions.editPlatforms ? (
            <div>
              <label htmlFor={`calendarColor-${platform.id}`}>
                Google Calendar Color
              </label>

              <select
                id={`calendarColor-${platform.id}`}
                value={platform.calendarColorId ?? ""}
                onChange={(event) =>
                  updatePlatform(platform.id, {
                    calendarColorId: event.target.value || null,
                  })
                }
              >
                <option value="">Calendar default</option>
                {Object.entries(calendarColors).map(([id, color]) => (
                  <option key={id} value={id}>
                    {color.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p>
              <strong>Google Calendar Color:</strong>{" "}
              {calendarColors[platform.calendarColorId]?.name ?? "Calendar default"}
            </p>
          )}

          <PostTypeEditor platform={platform} canEdit={Boolean(permissions.managePostTypes)} onChange={replacePlatform} />

          <hr />
        </div>
      ))}

      {permissions.editPlatforms && (
        <button type="button" onClick={handleSave}>
          Save Calendar Colors
        </button>
      )}

      {savedMessage && <p>{savedMessage}</p>}
    </section>
  );
}

// "Fri, Dec 4" for a "YYYY-MM-DD" (a calendar day, so no time zone shift)
const calendarDay = (date) => new Date(`${date}T12:00:00Z`)
  .toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

/**
 * The hint under a rule's time field, for viewers outside New York.
 *
 * Usage:
 *   ruleTimeHint(draft)  // "Your time: 6:00 AM PT"
 *
 * Takes:
 *   draft - the rule being edited: { time "HH:MM", startDate "YYYY-MM-DD" or "" }
 *
 * Returns:
 *   "Your time: ..." or "" when there is no time or the viewer is on app time.
 *
 * How it works:
 *   Reads the time on the rule's start date (or today in the app zone when it has none),
 *   since daylight saving can make the gap differ by date, and converts it with viewerTime.
 */
function ruleTimeHint(draft) {
  if (!draft.time) return "";
  const date = draft.startDate || zonedParts(new Date(), appTimeZone()).date;
  const local = viewerTime(zonedToInstant(date, draft.time));
  return local ? `Your time: ${local}` : "";
}

/**
 * One-line summary of a rule.
 *
 * Usage:
 *   describeRule(rule)  // "Every 2 weeks on Tue, Thu at 9:00 AM ET, from 2026-11-03 until further notice"
 *
 * Takes:
 *   rule - a saved rule: { byDay "TU,TH", intervalWeeks, time "HH:MM", startDate, endDate or null }
 *
 * Returns:
 *   A string. Days follow the days table's order; the time is in the app zone.
 */
function describeRule(rule) {
  const dayNames = days.filter(([code]) => rule.byDay.split(",").includes(code)).map(([, label]) => label.slice(0, 3));
  const every = rule.intervalWeeks === 1 ? "Every week" : `Every ${rule.intervalWeeks} weeks`;
  const until = rule.endDate ? `until ${rule.endDate}` : "until further notice";
  return `${every} on ${dayNames.join(", ")} at ${formatSlotTime(null, rule.time)}, from ${rule.startDate} ${until}`;
}

/**
 * A platform's repeating schedules. Its slots are every date and time any active rule makes.
 *
 * Usage:
 *   Rendered by Platforms: <ScheduleRules platform={platform} canEdit={...} onChange={replacePlatform} />
 *
 * Takes:
 *   platform - the platform with rules and postTypes
 *   canEdit  - true with editSchedules; false shows each rule's summary and types only
 *   onChange - called with the platform the server returns after any rule change
 *
 * Returns:
 *   The "Posting Schedule" block: one RuleForm per rule and "Add Schedule Rule".
 *
 * How it works:
 *   Changing a rule moves only future slots that are not locked or pinned; posts in slots
 *   that go away return to the library. For "every 2 weeks", weeks start on Sunday and
 *   the week of the start date is the first. The last active rule cannot be turned off or
 *   deleted (onlyActive).
 *
 * When editing:
 *   Locked and pinned slots stay where they are when a rule changes (to be confirmed).
 */
function ScheduleRules({ platform, canEdit, onChange }) {
  const [adding, setAdding] = useState(false);
  const rules = platform.rules ?? [];
  const activeCount = rules.filter((rule) => rule.active).length;
  const rotation = (platform.postTypes ?? []).filter((type) => type.inRotation);

  if (!canEdit) {
    return (
      <div className="schedule-rules">
        <strong>Posting Schedule</strong>
        <ul className="schedule-rule-list">
          {rules.map((rule) => (
            <li key={rule.id} className={`schedule-rule${rule.active ? "" : " schedule-rule-inactive"}`}>
              <p className="schedule-rule-summary">
                {rule.label ? `${rule.label}: ` : ""}{describeRule(rule)}{rule.active ? "" : " (off)"}
              </p>
              <p className="field-hint">
                Post types: {sequenceOf(rule.postTypeIds, rotation).ids
                  .map((id) => rotation.find((type) => type.id === id)?.name).join(", ")}
              </p>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="schedule-rules">
      <strong>Posting Schedule</strong>
      <p className="field-hint">
        Each rule repeats like a recurring calendar event. Changing a rule moves only future slots that
        are not locked or pinned; posts in slots that go away return to the library.
        For "every 2 weeks", weeks start on Sunday and the week of the start date is the first.
      </p>

      <ul className="schedule-rule-list">
        {rules.map((rule) => (
          <li key={rule.id}>
            <RuleForm
              platform={platform}
              rule={rule}
              onlyActive={rule.active && activeCount <= 1}
              onSaved={onChange}
            />
          </li>
        ))}
      </ul>

      {adding ? (
        <RuleForm platform={platform} onSaved={(saved) => { onChange(saved); setAdding(false); }} onCancel={() => setAdding(false)} />
      ) : (
        <button type="button" className="secondary-button" onClick={() => setAdding(true)}>
          Add Schedule Rule
        </button>
      )}
    </div>
  );
}

// A new rule's fields; startDate "" means "starts today" (the server fills it in)
const blankRule = { label: "", byDay: "", intervalWeeks: 1, time: "", startDate: "", endDate: null, postTypeIds: [], active: true };

/**
 * One rule's fields: name, days, repeat every N weeks, time (app zone), start and end
 * dates, post type order, active; with Save / Undo / Delete (inline confirm).
 * Without `rule` it makes a new one.
 *
 * Usage:
 *   <RuleForm platform={platform} rule={rule} onlyActive={...} onSaved={onChange} />
 *   <RuleForm platform={platform} onSaved={...} onCancel={...} />   // new rule
 *
 * Takes:
 *   platform   - the platform (id, postTypes)
 *   rule       - the saved rule, or undefined for a new one
 *   onlyActive - true when this is the platform's only active rule: Active is locked on
 *                and Delete is hidden; default false
 *   onSaved    - called with the platform the server returns
 *   onCancel   - optional; shows a Cancel button (new rules)
 *
 * Returns:
 *   A <form>.
 *
 * How it works:
 *   1. Edits a draft copy; Save is enabled only when it differs from the saved rule.
 *   2. When the saved rule comes back changed from the server, the draft is reset to it;
 *      edits elsewhere on the platform (which also replace the platform) keep the draft,
 *      because the rule is compared by its JSON.
 *   3. Save sends label (empty -> null), byDay, intervalWeeks, time, endDate (empty ->
 *      null), postTypeIds as stored (sequenceOf) and active; startDate only when set, so
 *      a new rule without one starts today.
 *   4. Delete asks inline: its future slots go away and their posts return to the library.
 *   5. Before saving or deleting, asks the server how many posts already on the
 *      calendar the change would move (POST rules/impact). When any, it offers "Move posts ...
 *      to the new days" (default, today's behavior) or "Keep posts ... where they are; only new
 *      posts follow the new days" (keepPosts), with the count, before committing.
 */
function RuleForm({ platform, rule, onlyActive = false, onSaved, onCancel }) {
  const [draft, setDraft] = useState(rule ?? blankRule);
  const [message, setMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  // { body, remove, impact, keep } while asking "move or keep" the posts already on the calendar
  const [choice, setChoice] = useState(null);
  const idBase = `rule-${platform.id}-${rule?.id ?? "new"}`;
  const rotation = (platform.postTypes ?? []).filter((type) => type.inRotation);
  const selectedDays = draft.byDay ? draft.byDay.split(",") : [];
  const changed = !rule || JSON.stringify(draft) !== JSON.stringify(rule);

  // Step 2: reset the draft only when the saved rule itself changed
  const savedRule = rule ? JSON.stringify(rule) : "";
  useEffect(() => {
    if (savedRule) setDraft(JSON.parse(savedRule));
  }, [savedRule]);

  function change(changes) {
    setDraft((current) => ({ ...current, ...changes }));
    setMessage("");
  }

  // Adds or removes a day; byDay is always saved in the days table's order (SU first)
  function toggleDay(code) {
    const next = selectedDays.includes(code) ? selectedDays.filter((d) => d !== code) : [...selectedDays, code];
    change({ byDay: days.map(([d]) => d).filter((d) => next.includes(d)).join(",") });
  }

  async function save(event) {
    event.preventDefault();
    const body = {
      label: draft.label?.trim() || null,
      byDay: draft.byDay,
      intervalWeeks: Number(draft.intervalWeeks),
      time: draft.time,
      endDate: draft.endDate || null,
      // Types that left the rotation are dropped (the server only takes rotation types)
      postTypeIds: sequenceOf(draft.postTypeIds, rotation).stored,
      active: draft.active,
    };
    // No start date: the server starts it today
    if (draft.startDate) body.startDate = draft.startDate;
    // Posts already on the calendar that the change would move? Then ask first
    try {
      const impact = await api.ruleImpact(platform.id, { ruleId: rule?.id, rule: body });
      if (impact.moving > 0) return setChoice({ body, impact, keep: false });
    } catch (error) {
      return setMessage(error.message);
    }
    await commit({ body }, false);
  }

  async function remove() {
    try {
      const impact = await api.ruleImpact(platform.id, { ruleId: rule.id, remove: true });
      if (impact.moving > 0) {
        setConfirmDelete(false);
        return setChoice({ remove: true, impact, keep: false });
      }
    } catch (error) {
      setConfirmDelete(false);
      return setMessage(error.message);
    }
    await commit({ remove: true }, false);
  }

  /**
   * Saves or deletes the rule, keeping the posts already on the calendar where they are when
   * keep is true (keepPosts), or moving them to the new days.
   *
   * Takes:
   *   change - { body } to save, or { remove: true } to delete
   *   keep   - true for "Keep posts already on the calendar where they are"
   */
  async function commit({ body, remove: removing }, keep) {
    try {
      let saved;
      if (removing) saved = keep ? await api.deleteRuleKeepingPosts(platform.id, rule.id) : await api.deleteRule(platform.id, rule.id);
      else {
        const sent = keep ? { ...body, keepPosts: true } : body;
        saved = rule ? await api.updateRule(platform.id, rule.id, sent) : await api.addRule(platform.id, sent);
      }
      setChoice(null);
      onSaved(saved);
    } catch (error) {
      setMessage(error.message);
      setConfirmDelete(false);
    }
  }

  return (
    <form className={`schedule-rule${draft.active ? "" : " schedule-rule-inactive"}`} onSubmit={save}>
      {rule && <p className="schedule-rule-summary">{describeRule(rule)}{rule.active ? "" : " (off)"}</p>}

      <label htmlFor={`${idBase}-label`}>Name (optional)</label>
      <input
        id={`${idBase}-label`}
        type="text"
        placeholder="e.g. Newsletter"
        value={draft.label ?? ""}
        onChange={(event) => change({ label: event.target.value })}
      />

      <fieldset className="schedule-rule-days">
        <legend>Days</legend>
        {days.map(([code, label]) => (
          <label key={code}>
            <input type="checkbox" checked={selectedDays.includes(code)} onChange={() => toggleDay(code)} />
            {label}
          </label>
        ))}
      </fieldset>

      <div className="schedule-rule-row">
        <div>
          <label htmlFor={`${idBase}-interval`}>Repeat every</label>
          <input
            id={`${idBase}-interval`}
            type="number"
            min="1"
            max="52"
            value={draft.intervalWeeks}
            onChange={(event) => change({ intervalWeeks: event.target.value })}
          />
          <span> {Number(draft.intervalWeeks) === 1 ? "week" : "weeks"}</span>
        </div>
        <div>
          <label htmlFor={`${idBase}-time`}>Time ({zoneCity()})</label>
          <input id={`${idBase}-time`} type="time" value={draft.time} onChange={(event) => change({ time: event.target.value })} />
          {ruleTimeHint(draft) && <p className="field-hint" aria-live="polite">{ruleTimeHint(draft)}</p>}
        </div>
        <div>
          <label htmlFor={`${idBase}-start`}>Start date</label>
          <input
            id={`${idBase}-start`}
            type="date"
            value={draft.startDate}
            onChange={(event) => change({ startDate: event.target.value })}
          />
          {!rule && !draft.startDate && <p className="field-hint">Leave empty to start today.</p>}
        </div>
        <div>
          <label htmlFor={`${idBase}-end`}>End date (optional)</label>
          <input
            id={`${idBase}-end`}
            type="date"
            value={draft.endDate ?? ""}
            onChange={(event) => change({ endDate: event.target.value || null })}
          />
          <p className="field-hint">{draft.endDate ? "Last day this rule posts." : "No end: until otherwise stated."}</p>
        </div>
      </div>

      <SequenceEditor
        idBase={idBase}
        rotation={rotation}
        value={draft.postTypeIds}
        onChange={(postTypeIds) => change({ postTypeIds })}
      />

      <label>
        <input
          type="checkbox"
          checked={draft.active}
          disabled={onlyActive}
          onChange={(event) => change({ active: event.target.checked })}
        />
        Active
      </label>
      {onlyActive && (
        <p className="field-hint">The platform needs at least one active rule.</p>
      )}

      {choice && (
        <fieldset className="rule-change-choice" role="alert">
          <legend>
            This {choice.remove ? "delete" : "change"} affects {choice.impact.moving} post{choice.impact.moving === 1 ? "" : "s"} already
            on the calendar{choice.impact.until ? ` (until ${calendarDay(choice.impact.until)})` : ""}.
          </legend>
          <label>
            <input type="radio" name={`${idBase}-keep`} checked={!choice.keep} onChange={() => setChoice({ ...choice, keep: false })} />
            Move posts already on the calendar to the new days
          </label>
          <label>
            <input type="radio" name={`${idBase}-keep`} checked={choice.keep} onChange={() => setChoice({ ...choice, keep: true })} />
            Keep posts already on the calendar where they are; only new posts follow the new days
          </label>
          <div className="post-actions">
            <button type="button" className={choice.remove ? "remove-button" : undefined} onClick={() => commit(choice, choice.keep)}>
              {choice.remove ? "Delete Rule" : rule ? "Save Rule" : "Add Rule"}
            </button>
            <button type="button" className="secondary-button" onClick={() => setChoice(null)}>Cancel</button>
          </div>
        </fieldset>
      )}

      <div className="post-actions">
        <button type="submit" disabled={!changed}>{rule ? "Save Rule" : "Add Rule"}</button>
        {rule && changed && <button type="button" className="secondary-button" onClick={() => setDraft(rule)}>Undo changes</button>}
        {onCancel && <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>}
        {rule && !onlyActive && !confirmDelete && (
          <button type="button" className="remove-button" onClick={() => setConfirmDelete(true)}>Delete Rule</button>
        )}
        {confirmDelete && (
          <span role="alert">
            Delete this rule? Its future slots go away and their posts return to the library.{" "}
            <button type="button" className="remove-button" onClick={remove}>Yes, delete</button>
            <button type="button" className="secondary-button" onClick={() => setConfirmDelete(false)}>Keep it</button>
          </span>
        )}
      </div>

      {message && <p className="error-text">{message}</p>}
    </form>
  );
}

/**
 * A rule's post type order as the editor shows it. A stored empty list means "follow the monthly
 * rotation", so it shows the rotation types filled in.
 *
 * Usage:
 *   const { ids, following, stored } = sequenceOf(rule.postTypeIds, rotation);
 *
 * Takes:
 *   postTypeIds - the rule's stored order (array of post type ids; [] or null = rotation)
 *   rotation    - the platform's rotation post types, in rotation order
 *
 * Returns:
 *   { ids, following, stored }
 *   ids       - the order shown (ids no longer in the rotation are left out)
 *   following - whether it is the rotation itself
 *   stored    - what to save
 *
 * How it works:
 *   The rotation in its own order saves as empty, so a type added to the rotation later
 *   joins the rule; any other order (fewer types, moved, repeated) is the rule's own and
 *   stays as it is.
 *
 * When editing:
 *   The server does the same (server/src/routes/platforms.js when saving,
 *   server/src/services/projection.js when making slots); keep them in step.
 */
function sequenceOf(postTypeIds, rotation) {
  const rotationIds = rotation.map((type) => type.id);
  const own = (postTypeIds ?? []).filter((id) => rotationIds.includes(id));
  const ids = own.length ? own : rotationIds;
  const following = ids.length === rotationIds.length && ids.every((id, i) => id === rotationIds[i]);
  return { ids, following, stored: following ? [] : own };
}

/**
 * The rule's post type order: drag the handle (mouse or touch) or use Up/Down to reorder,
 * Repeat to add the same type again right after (LinkedIn's C2R Newsletter Article, About Us,
 * C2R Newsletter Article, 3rd Party News), and Remove; removed types wait under "Add back".
 * "Use the monthly rotation" goes back to following the rotation.
 *
 * Usage:
 *   Rendered by RuleForm: <SequenceEditor idBase={idBase} rotation={rotation} value={draft.postTypeIds} onChange={...} />
 *
 * Takes:
 *   idBase   - prefix for element ids
 *   rotation - the platform's rotation post types
 *   value    - the stored order (see sequenceOf)
 *   onChange - called with the new stored order
 *
 * Returns:
 *   The ordered list with per-item buttons, "Add back" buttons, and a screen-reader-only
 *   live line announcing each move ("About Us moved to position 2 of 4.").
 *
 * How it works:
 *   1. Every change is passed through sequenceOf(...).stored, so an order put back to
 *      the rotation counts as unchanged.
 *   2. Dragging (dragStart): pointer events cover mouse, pen and touch. While dragging,
 *      the list follows the pointer: the dragged type takes the place of the item under
 *      it. Listening on window keeps the drag going when the pointer leaves the handle.
 *      Above the list counts as the first place, below it as the last. The move is
 *      announced once, when the drag ends.
 *   3. React keys are the type id plus which repeat of it this is, so they stay with an
 *      item while it moves.
 *   4. The last remaining type cannot be removed.
 *
 * When editing:
 *   The drag handle is aria-hidden; the Up/Down buttons are the keyboard and screen
 *   reader way to reorder, so keep them.
 */
function SequenceEditor({ idBase, rotation, value, onChange }) {
  const { ids, following } = sequenceOf(value, rotation);
  const [dragIndex, setDragIndex] = useState(null);
  const [announcement, setAnnouncement] = useState("");
  const listRef = useRef(null);
  const typeName = (id) => rotation.find((type) => type.id === id)?.name ?? "?";
  const missing = rotation.filter((type) => !ids.includes(type.id));

  // Saves a new order (step 1) and announces it
  function update(next, said) {
    onChange(sequenceOf(next, rotation).stored);
    setAnnouncement(said);
  }

  // A copy of list with the item at `from` moved to `to`
  function reorder(list, from, to) {
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  }

  function move(from, to) {
    if (to < 0 || to >= ids.length || to === from) return;
    update(reorder(ids, from, to), `${typeName(ids[from])} moved to position ${to + 1} of ${ids.length}.`);
  }

  // The drag in progress (step 2): { index, ids }
  const drag = useRef(null);

  function dragStart(event, index) {
    if (event.button !== 0) return;
    event.preventDefault();
    drag.current = { index, ids };
    setDragIndex(index);

    function onMove(moveEvent) {
      const items = listRef.current ? [...listRef.current.children] : [];
      if (!drag.current || items.length === 0) return;
      let over = items.findIndex((item) => {
        const box = item.getBoundingClientRect();
        return moveEvent.clientY >= box.top && moveEvent.clientY < box.bottom;
      });
      if (over === -1) over = moveEvent.clientY < items[0].getBoundingClientRect().top ? 0 : items.length - 1;
      if (over === drag.current.index) return;
      const next = reorder(drag.current.ids, drag.current.index, over);
      drag.current = { index: over, ids: next };
      setDragIndex(over);
      onChange(sequenceOf(next, rotation).stored);
    }
    function onEnd() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      const done = drag.current;
      drag.current = null;
      setDragIndex(null);
      if (done && done.index !== index) {
        setAnnouncement(`${typeName(done.ids[done.index])} moved to position ${done.index + 1} of ${done.ids.length}.`);
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  }

  // Step 3: keys that stay with an item while it moves
  const seen = new Map();
  const keys = ids.map((id) => {
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    return `${id}-${n}`;
  });

  return (
    <div className="sequence-editor">
      <strong id={`${idBase}-order`}>Post type order</strong>
      <p className="field-hint">
        The rule's slots repeat these types in order, carrying on into the next month. Drag a type by its
        handle, or use Up and Down.{" "}
        {following
          ? "This is the monthly rotation: types added to the rotation later join this rule too."
          : "This rule has its own order: types added to the rotation later are not added here."}
      </p>

      <ol className="schedule-rule-sequence" ref={listRef} aria-labelledby={`${idBase}-order`}>
        {ids.map((id, index) => (
          <li key={keys[index]} className={dragIndex === index ? "sequence-item-dragging" : undefined}>
            <span
              className="sequence-handle"
              aria-hidden="true"
              title="Drag to reorder"
              onPointerDown={(event) => dragStart(event, index)}
            >
              ⠿
            </span>
            <span className="sequence-name">{typeName(id)}</span>
            <button type="button" className="secondary-button" disabled={index === 0}
              aria-label={`Move ${typeName(id)} (position ${index + 1}) up`} onClick={() => move(index, index - 1)}>Up</button>
            <button type="button" className="secondary-button" disabled={index === ids.length - 1}
              aria-label={`Move ${typeName(id)} (position ${index + 1}) down`} onClick={() => move(index, index + 1)}>Down</button>
            <button type="button" className="secondary-button"
              aria-label={`Repeat ${typeName(id)} after position ${index + 1}`}
              onClick={() => update([...ids.slice(0, index + 1), id, ...ids.slice(index + 1)], `${typeName(id)} repeated at position ${index + 2}.`)}>
              Repeat
            </button>
            <button type="button" className="remove-button" disabled={ids.length === 1}
              aria-label={`Remove ${typeName(id)} (position ${index + 1})`}
              onClick={() => update(ids.filter((_, i) => i !== index), `${typeName(id)} removed.`)}>Remove</button>
          </li>
        ))}
      </ol>

      {missing.length > 0 && (
        <p className="sequence-add-back">
          <span>Add back:</span>
          {missing.map((type) => (
            <button key={type.id} type="button" className="secondary-button"
              aria-label={`Add ${type.name} back at the end`}
              onClick={() => update([...ids, type.id], `${type.name} added at position ${ids.length + 1}.`)}>
              + {type.name}
            </button>
          ))}
        </p>
      )}
      {!following && (
        <button type="button" className="secondary-button" onClick={() => update([], "Back to the monthly rotation order.")}>
          Use the monthly rotation
        </button>
      )}
      <p className="sr-only" aria-live="polite">{announcement}</p>
    </div>
  );
}

/**
 * Add, rename, or move a post type in or out of the monthly rotation.
 * Types outside the rotation (like Holiday) are only for Specific Date posts.
 *
 * Usage:
 *   Rendered by Platforms: <PostTypeEditor platform={platform} canEdit={...} onChange={replacePlatform} />
 *
 * Takes:
 *   platform - the platform with postTypes
 *   canEdit  - true with managePostTypes; false lists the types only
 *   onChange - called with the platform the server returns
 *
 * Returns:
 *   The "Post Types" block: rotation types first (in sortOrder), then the others; each
 *   with a rename field and an "In monthly rotation" checkbox; an add form; a hint.
 *
 * How it works:
 *   - Rename saves when the field loses focus (Enter blurs it), only if the trimmed name
 *     changed and is not empty.
 *   - The rotation checkbox saves right away.
 *   - New types start in the rotation unless unticked.
 *
 * When editing:
 *   There is no delete for post types here. Slots alternate Blue and Purple on platforms
 *   that use colors (set on the server).
 */
function PostTypeEditor({ platform, canEdit, onChange }) {
  const [names, setNames] = useState({});
  const [newName, setNewName] = useState("");
  const [newInRotation, setNewInRotation] = useState(true);
  const [message, setMessage] = useState("");
  const types = [...(platform.postTypes ?? [])].sort(
    (a, b) => Number(b.inRotation) - Number(a.inRotation) || a.sortOrder - b.sortOrder
  );

  async function save(type, changes) {
    try {
      onChange(await api.updatePostType(platform.id, type.id, changes));
      setMessage("");
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function rename(type) {
    const name = (names[type.id] ?? type.name).trim();
    if (name && name !== type.name) await save(type, { name });
    setNames((current) => ({ ...current, [type.id]: undefined }));
  }

  async function add(event) {
    event.preventDefault();
    if (!newName.trim()) return;
    try {
      onChange(await api.addPostType(platform.id, { name: newName.trim(), inRotation: newInRotation }));
      setNewName("");
      setNewInRotation(true);
      setMessage("");
    } catch (error) {
      setMessage(error.message);
    }
  }

  if (!canEdit) {
    return (
      <div>
        <strong>Post Types</strong>
        <ul className="post-type-list">
          {types.map((type) => (
            <li key={type.id}>{type.name}{type.inRotation ? " (monthly rotation)" : " (Specific Date only)"}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div>
      <strong>Post Types</strong>

      <ul className="post-type-list">
        {types.map((type) => (
          <li key={type.id}>
            <input
              type="text"
              aria-label={`Rename ${type.name}`}
              value={names[type.id] ?? type.name}
              onChange={(event) => setNames({ ...names, [type.id]: event.target.value })}
              onBlur={() => rename(type)}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
            />
            <label>
              <input
                type="checkbox"
                checked={type.inRotation}
                onChange={(event) => save(type, { inRotation: event.target.checked })}
              />
              In monthly rotation
            </label>
          </li>
        ))}
      </ul>

      <form className="post-type-add" onSubmit={add}>
        <input
          type="text"
          aria-label="New post type name"
          placeholder="New post type"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <label>
          <input type="checkbox" checked={newInRotation} onChange={(event) => setNewInRotation(event.target.checked)} />
          In monthly rotation
        </label>
        <button type="submit">Add Post Type</button>
      </form>

      {message && <p className="error-text">{message}</p>}

      <p className="field-hint">
        Rules with an empty post type order repeat the rotation types in this order
        {platform.usesColors ? ". Slots alternate Blue and Purple." : ". This platform does not use colors."}
        {" "}Types outside the rotation, like Holiday, are for Specific Date posts.
      </p>
    </div>
  );
}
