// Monthly blueprint of slots for one platform. Library posts fill the slots;
// Specific Date posts sit on their day in orange. Google Calendar mirrors what is scheduled.
import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { formatClock, formatDate, monthKey, shiftMonth, zonedParts } from "../time.js";
import { ColorRadios, PostTypeSelect, colorClass } from "../components/PostFields.jsx";
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function LockIcon() {
  return (
    <svg className="slot-lock" viewBox="0 0 16 16" width="12" height="12" aria-label="Locked" role="img">
      <path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3" y="7" width="10" height="7.5" rx="1.5" fill="currentColor" />
    </svg>
  );
}

// Leading blanks (Monday first) then "YYYY-MM-DD" for every day of the month
function monthCells(month) {
  const [year, m] = month.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(year, m - 1, 1)).getUTCDay();
  const totalDays = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const blanks = Array.from({ length: (firstWeekday + 6) % 7 }, () => null);
  const days = Array.from({ length: totalDays }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
  return [...blanks, ...days];
}

function monthTitle(month) {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
}

export default function Calendar() {
  const [platforms, setPlatforms] = useState([]);
  const [platformId, setPlatformId] = useState(null);
  const [timezone, setTimezone] = useState();
  const [today, setToday] = useState("");
  const [month, setMonth] = useState("");
  const [slots, setSlots] = useState([]);
  const [fixedPosts, setFixedPosts] = useState([]);
  const [pool, setPool] = useState([]); // unplaced library posts of this platform
  const [selected, setSelected] = useState(null); // { slot, postTypeId, color, postId, locked }
  const [message, setMessage] = useState("");

  useEffect(() => {
    Promise.all([api.platforms(), api.status()])
      .then(([allPlatforms, status]) => {
        setPlatforms(allPlatforms);
        setPlatformId((allPlatforms.find((p) => p.enabled) ?? allPlatforms[0])?.id ?? null);
        setTimezone(status.timezone);
        // In test mode the app clock can be moved, so "today" comes from the server
        setToday(zonedParts(status.now, status.timezone).date);
        setMonth(monthKey(status.now, status.timezone));
      })
      .catch((error) => setMessage(error.message));
  }, []);

  async function load() {
    if (!platformId || !month) return;
    const [monthData, unplaced] = await Promise.all([
      api.slots(platformId, month),
      api.posts({ status: "queued", platformId, kind: "library", placed: false }),]);
    setSlots(monthData.slots);
    setFixedPosts(monthData.fixedPosts);
    setPool(unplaced);
  }

  useEffect(() => {
    load().catch((error) => setMessage(error.message));
  }, [platformId, month]);

  const platform = platforms.find((p) => p.id === platformId);
  const cells = useMemo(() => (month ? monthCells(month) : []), [month]);

  const slotsByDate = useMemo(() => {
    const map = new Map();
    for (const slot of [...slots].sort((a, b) => a.time.localeCompare(b.time))) {
      map.set(slot.date, [...(map.get(slot.date) ?? []), slot]);
    }
    return map;
  }, [slots]);

  const fixedByDate = useMemo(() => {
    const map = new Map();
    for (const post of [...fixedPosts].sort((a, b) => (a.fixedAt ?? "").localeCompare(b.fixedAt ?? ""))) {
      const date = post.fixedAt?.slice(0, 10);
      if (date) map.set(date, [...(map.get(date) ?? []), post]);
    }
    return map;
  }, [fixedPosts]);

  const emptyCount = slots.filter((slot) => !slot.blocked && !slot.postId).length;

  function choosePlatform(id) {
    setSelected(null);
    setMessage("");
    setPlatformId(id);
  }

  function goToMonth(next) {
    setSelected(null);
    setMonth(next);
  }

  function openSlot(slot) {
    setMessage("");
    setSelected({
      slot,
      postTypeId: slot.postTypeId,
      color: slot.color,
      postId: slot.pinned && slot.postId ? String(slot.postId) : "",
      locked: slot.locked,
    });
  }

  // Automatic + library posts matching the type and color picked in the panel
  const candidates = selected
    ? [selected.slot.post, ...pool]
        .filter(Boolean)
        .filter((post, index, all) => all.findIndex((p) => p.id === post.id) === index)
        .filter((post) => post.postTypeId === selected.postTypeId && (!platform?.usesColors || post.color === selected.color))
    : [];

  async function saveSlot() {
    const { slot, postTypeId, color, postId, locked } = selected;
    const changes = {};
    if (postTypeId !== slot.postTypeId) changes.postTypeId = postTypeId;
    if (platform?.usesColors && color !== slot.color) changes.color = color;
    if (locked !== slot.locked) changes.locked = locked;
    const initialPick = slot.pinned && slot.postId ? String(slot.postId) : "";
    if (postId !== initialPick) changes.postId = postId ? Number(postId) : null;

    try {
      if (Object.keys(changes).length) await api.updateSlot(slot.id, changes);
      setSelected(null);
      setMessage("");
    } catch (error) {
      setMessage(error.message);
      return;
    }
    await load().catch((error) => setMessage(error.message));
  }

  function slotTag(slot) {
    return `${slot.postTypeName}${slot.color ? ` · ${slot.color}` : ""}`;
  }

  function renderSlot(slot) {
    const isSelected = selected?.slot.id === slot.id;
    const state = slot.blocked ? "blocked" : slot.post ? "filled" : "ghost";

    return (
      <button
        type="button"
        key={slot.id}
        className={`slot slot-${state} slot-${colorClass(slot.color)}${isSelected ? " slot-selected" : ""}`}
        onClick={() => openSlot(slot)}
      >
        <span className="slot-tag">
          {slot.locked && <LockIcon />}
          {slotTag(slot)}
        </span>
        <span className="slot-time">{formatClock(slot.time)}</span>
        <span className="slot-caption">
          {slot.blocked
            ? "Skipped: Specific Date post this day"
            : slot.post
              ? slot.post.caption
              : "Empty: needs content"}
        </span>
      </button>
    );
  }

  function renderFixed(post) {
    return (
      <div key={`fixed-${post.id}`} className="slot slot-fixed">
        <span className="slot-tag">Specific Date</span>
        <span className="slot-time">{formatClock(post.fixedAt.slice(11, 16))}</span>
        <span className="slot-caption">{post.caption}</span>
      </div>
    );
  }

  return (
    <section>
      <div className="schedule-header">
        <div>
          <h1>Calendar</h1>
          <p>Posting slots for the month. Click a slot to change it.</p>
        </div>

        <div className="schedule-controls">
          <div className="calendar-navigation">
            <button type="button" onClick={() => goToMonth(shiftMonth(month, -1))} disabled={!month}>
              Previous
            </button>
            <button type="button" onClick={() => goToMonth(today.slice(0, 7))} disabled={!today}>
              Today
            </button>
            <button type="button" onClick={() => goToMonth(shiftMonth(month, 1))} disabled={!month}>
              Next
            </button>
          </div>
        </div>
      </div>

      <div className="view-toggle platform-picker" role="group" aria-label="Platform">
        {platforms.map((p) => (
          <button
            type="button"
            key={p.id}
            className={p.id === platformId ? "active-view" : ""}
            aria-pressed={p.id === platformId}
            onClick={() => choosePlatform(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>

      {month && (
        <h2 className="calendar-title">
          {platform?.name} · {monthTitle(month)}
        </h2>
      )}

      {message && <p className="error-text">{message}</p>}

      <div className="schedule-legend slot-legend">
        {platform?.usesColors ? (
          <>
            <span className="legend-item" style={{ "--legend-color": "var(--slot-blue)" }}>Blue</span>
            <span className="legend-item" style={{ "--legend-color": "var(--slot-purple)" }}>Purple</span>
          </>
        ) : (
          <span className="legend-item" style={{ "--legend-color": "var(--slot-none)" }}>No color</span>
        )}
        <span className="legend-item" style={{ "--legend-color": "var(--slot-fixed)" }}>Specific Date (fixed)</span>
        <span className="legend-item legend-ghost">Empty slot</span>
        <span className="legend-item legend-lock"><LockIcon /> Locked</span>
      </div>

      <p className="field-hint">
        Colors alternate and post types repeat automatically; you can change any slot.{" "}
        {emptyCount} empty slot{emptyCount === 1 ? "" : "s"} this month.
      </p>

      <div className="month-calendar slot-calendar">
        <div className="month-weekdays">
          {weekdays.map((day) => (
            <div key={day}>{day}</div>
          ))}
        </div>

        <div className="month-grid">
          {cells.map((date, index) => {
            if (!date) return <div className="month-day month-day-empty" key={`empty-${index}`} />;

            const daySlots = slotsByDate.get(date) ?? [];
            const dayFixed = fixedByDate.get(date) ?? [];

            return (
              <div
                className={`month-day${date === today ? " month-day-today" : ""}${daySlots.length || dayFixed.length ? "" : " month-day-quiet"}`}
                key={date}
              >
                <div className="month-day-number">
                  {/* The weekday shows only in the phone list layout */}
                  <span className="month-day-weekday">{weekdays[index % 7]} </span>
                  {Number(date.slice(8))}
                </div>
                {dayFixed.map(renderFixed)}
                {daySlots.map(renderSlot)}
              </div>
            );
          })}
        </div>
      </div>

      {selected && platform && (
        <div className="post-details slot-panel">
          <div className="post-details-header">
            <h2>
              Slot: {selected.slot.date} at {formatClock(selected.slot.time)}
            </h2>
          </div>

          {selected.slot.blocked && (
            <p className="field-hint">
              A Specific Date post is on this day, so this slot is skipped.
            </p>
          )}

          <div className="slot-panel-grid">
            <div>
              <label htmlFor="slotType">Post type for this slot</label>
              <PostTypeSelect
                id="slotType"
                platform={platform}
                value={selected.postTypeId}
                onChange={(postTypeId) => setSelected({ ...selected, postTypeId, postId: "" })}
                rotationOnly
              />

              {platform.usesColors && (
                <>
                  <span className="field-label">Color</span>
                  <ColorRadios
                    name="slotColor"
                    value={selected.color}
                    onChange={(color) => setSelected({ ...selected, color, postId: "" })}
                  />
                </>
              )}
            </div>

            <div>
              <label htmlFor="slotPost">Post in this slot</label>
              <select
                id="slotPost"
                value={selected.postId}
                onChange={(event) => setSelected({ ...selected, postId: event.target.value })}
                disabled={selected.slot.blocked}
              >
                <option value="">Automatic (oldest match)</option>
                {candidates.map((post) => (
                  <option key={post.id} value={post.id}>
                    {post.caption.slice(0, 60)} (added {formatDate(post.createdAt, timezone)})
                  </option>
                ))}
              </select>

              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={selected.locked}
                  onChange={(event) => setSelected({ ...selected, locked: event.target.checked })}
                />
                Lock this slot so automation never changes it
              </label>
            </div>
          </div>

          <button type="button" onClick={saveSlot}>
            Save
          </button>
          <button type="button" className="secondary-button" onClick={() => setSelected(null)}>
            Close
          </button>
        </div>
      )}

      <p className="schedule-note">
        Google Calendar mirrors the scheduled posts shown here. Times are in {timezone ?? "the app time zone"}.
      </p>
    </section>
  );
}
