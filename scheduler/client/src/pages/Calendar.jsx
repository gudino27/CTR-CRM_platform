/**
 * Calendar page: the monthly blueprint of slots for one platform. Library posts fill the
 * slots; Specific Date posts sit on their day in orange. Google Calendar mirrors what is
 * scheduled. Blackout days are greyed with their reason.
 *
 * What lives here:
 *   weekdays           column headings, Monday first
 *   dayLabel           "Thu, Nov 26" for a "YYYY-MM-DD"
 *   useScrollIntoView  scrolls a panel into view when it opens
 *   PostEditor         edit one post's caption, image, alt text and date/time
 *   holidayTypes       the post types a holiday post may use
 *   HolidayForm        add a Specific Date post (Holiday type) on one day
 *   LockIcon           the small padlock on locked slots
 *   monthCells         the grid cells of one month
 *   WeekNumber         the small "Wk 45" at the start of each week row
 *   monthTitle         "November 2026"
 *   Calendar           the page (route /calendar)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { formatClock, formatDate, formatLocal, formatSlotTime, monthKey, shiftMonth, zonedParts, zoneCity } from "../time.js";
import { weekOfYear } from "../time.js"; // week numbers on the grid
import { YourTimeHint } from "../components/TimeZone.jsx"; // viewer's own time
import {
  ColorRadios, ConflictNotice, PostTypeSelect, RequiredMark, colorClass, splitFixedAt,
} from "../components/PostFields.jsx";
import ImageField, { imageOfPost, imageProblem } from "../components/ImageField.jsx";
import { useCurrentUser } from "../currentUser.js";
import { BlackoutNotice, blackoutOn } from "../components/BlackoutDates.jsx";
import { SuggestedColorNote, useSuggestedColor } from "../components/SuggestedColor.jsx"; // color suggestion
// Monday first; monthCells uses the same order
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Short day label for a date in the app zone.
 *
 * Usage:
 *   dayLabel("2026-11-26")  // "Thu, Nov 26"
 *
 * Returns:
 *   The weekday and date parts of formatLocal (time.js), without the year or time.
 */
const dayLabel = (date) => formatLocal(`${date}T00:00`).split(",").slice(0, 2).join(",");

/**
 * Brings a panel below the month into view when it opens.
 *
 * Usage:
 *   const slotPanel = useScrollIntoView(selected?.slot.id);  <div ref={slotPanel}>
 *
 * Takes:
 *   key - changes when a different panel content opens; falsy means closed (no scroll)
 *
 * Returns:
 *   A ref to put on the panel. It scrolls smoothly, only as far as needed.
 */
function useScrollIntoView(key) {
  const ref = useRef(null);
  useEffect(() => {
    if (key) ref.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [key]);
  return ref;
}

/**
 * Caption, image, alt text and date/time of one post, in the slot panel or the Specific
 * Date panel. A library post in a slot that gets a new date or time becomes a Specific
 * Date post (the Library page has the same rule).
 *
 * Usage:
 *   <PostEditor key={post.id} post={post} platform={platform} date={slot.date} time={slot.time} onSaved={afterSave} />
 *
 * Takes:
 *   post     - the queued post
 *   platform - its platform (charLimit, id)
 *   date     - the starting date "YYYY-MM-DD" (the slot's, or the post's fixedAt date)
 *   time     - the starting time "HH:MM" in the app zone
 *   onSaved  - called with a message to show after saving
 *
 * Returns:
 *   The editor: caption with count (red over the limit; Save disabled), older posts'
 *   separate hashtags (shown, not edited), image and alt text, date and time (app zone,
 *   with the viewer's-time hint and the blackout warning), a hint about becoming a
 *   Specific Date post, the collision notice, and Save.
 *
 * How it works:
 *   1. Checks caption, image (imageProblem), date and time.
 *   2. Sends caption and alt text; mediaId only when the image changed; when the date or
 *      time changed, kind "fixed" and fixedAt.
 *   3. A 409 with a conflict shows the collision notice ("Use <time>" / "Schedule anyway").
 *   4. A Library post that moved: the message says its old slot takes the next matching
 *      library post.
 *
 * When editing:
 *   Give it a key per post so its state resets when another post opens.
 */
function PostEditor({ post, platform, date: initialDate, time: initialTime, onSaved }) {
  const [caption, setCaption] = useState(post.caption);
  const [altText, setAltText] = useState(post.altText ?? "");
  const [image, setImage] = useState(() => imageOfPost(post));
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);
  const [conflict, setConflict] = useState(null);
  const [message, setMessage] = useState("");
  const moved = date !== initialDate || time !== initialTime;
  const becomesFixed = post.kind === "library" && moved;
  const overLimit = Boolean(platform.charLimit && caption.trim().length > platform.charLimit);

  async function save(force = false) {
    const missingImage = imageProblem(image);
    if (!caption.trim()) return setMessage("Please enter a caption.");
    if (missingImage) return setMessage(missingImage);
    if (!date || !time) return setMessage("Please choose a date and a time.");

    const changes = { caption, altText };
    if (image.media.id !== post.mediaId) changes.mediaId = image.media.id;
    if (moved) Object.assign(changes, { kind: "fixed", fixedAt: `${date}T${time}` });
    if (force) changes.force = true;
    try {
      await api.updatePost(post.id, changes);
    } catch (error) {
      if (error.status === 409 && error.body?.conflict) {
        setConflict(error.body);
        setMessage("");
      } else {
        setMessage(error.message);
      }
      return;
    }
    onSaved(becomesFixed
      ? `Moved to ${formatLocal(`${date}T${time}`)} as a Specific Date post. This slot takes the next matching library post.`
      : "Post saved.");
  }

  const id = (name) => `post-${post.id}-${name}`;
  return (
    <div className="post-editor">
      <label htmlFor={id("caption")}>Caption <RequiredMark /></label>
      <textarea
        id={id("caption")}
        rows="4"
        value={caption}
        onChange={(event) => setCaption(event.target.value)}
        aria-required="true"
      />
      <p className={overLimit ? "error-text" : "field-hint"}>
        Characters: {caption.trim().length}{platform.charLimit ? ` / ${platform.charLimit}` : ""}
      </p>
      {post.hashtags && <p className="field-hint">Hashtags saved separately (sent after the caption): {post.hashtags}</p>}

      <ImageField
        idPrefix={id("image")}
        image={image}
        setImage={setImage}
        altText={altText}
        setAltText={setAltText}
        platformId={platform.id}
      />

      <div className="date-time-row">
        <div>
          <label htmlFor={id("date")}>Date <RequiredMark /></label>
          <input id={id("date")} type="date" value={date} aria-required="true"
            onChange={(event) => { setDate(event.target.value); setConflict(null); }} />
        </div>
        <div>
          <label htmlFor={id("time")}>Time ({zoneCity()}) <RequiredMark /></label>
          <input id={id("time")} type="time" value={time} aria-required="true"
            onChange={(event) => { setTime(event.target.value); setConflict(null); }} />
        </div>
      </div>
      <YourTimeHint date={date} time={time} />
      <BlackoutNotice platformId={platform.id} date={date} />
      {post.kind === "library" && (
        <p className={becomesFixed ? "field-hint field-hint-strong" : "field-hint"}>
          {becomesFixed
            ? "Saving with a new date or time makes this a Specific Date post. Automation won't move it, and this slot refills from the library."
            : "Change the date or time to move it; it then becomes a Specific Date post."}
        </p>
      )}

      {conflict && (
        <ConflictNotice
          conflict={conflict}
          onUseSuggested={(suggestedAt) => {
            const next = splitFixedAt(suggestedAt);
            setDate(next.date);
            setTime(next.time);
            setConflict(null);
          }}
          onForce={() => save(true)}
        />
      )}
      {message && <p className="error-text" role="alert">{message}</p>}

      <button type="button" onClick={() => save()} disabled={image?.uploading || overLimit}>
        Save post
      </button>
    </div>
  );
}

/**
 * The post types a holiday post may use.
 *
 * Usage:
 *   holidayTypes(platform)
 *
 * Takes:
 *   platform - with postTypes (may be undefined)
 *
 * Returns:
 *   [the type named "Holiday" (any case, spaces trimmed)] when the platform has one
 *   outside the rotation; otherwise every type outside the rotation (Specific Date only
 *   types); [] when there are none.
 */
function holidayTypes(platform) {
  const outside = (platform?.postTypes ?? []).filter((type) => !type.inRotation);
  const holiday = outside.find((type) => type.name.trim().toLowerCase() === "holiday");
  return holiday ? [holiday] : outside;
}

/**
 * Adds a Specific Date post with the Holiday type on one day: it goes out at that date
 * and time, and that day's library slot is skipped.
 *
 * Usage:
 *   <HolidayForm key={`${platform.id}-${date}`} platform={platform} date={date} onSaved={afterSave} onCancel={...} />
 *
 * Takes:
 *   platform - the platform (postTypes, postingTimes, usesColors, charLimit)
 *   date     - the day clicked, "YYYY-MM-DD"
 *   onSaved  - called with a message after the post is made
 *   onCancel - closes the form
 *
 * Returns:
 *   The form: date, time (starts at the platform's earliest posting time), the type
 *   (fixed when there is one; a choice when there is no "Holiday" but several Specific
 *   Date types; an error when none), color, caption, image, collision notice, buttons.
 *
 * How it works:
 *   Checks type, date and time, caption, image; then POST /api/posts with kind "fixed".
 *   A 409 shows the collision notice like Compose. On platforms with colors the color that
 *   keeps Blue/Purple alternating is preselected for the date and time
 *   (useSuggestedColor); the server requires a color for Holiday posts there.
 */
function HolidayForm({ platform, date: initialDate, onSaved, onCancel }) {
  const types = holidayTypes(platform);
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState([...(platform.postingTimes ?? [])].sort()[0] ?? "");
  const [postTypeId, setPostTypeId] = useState(types[0]?.id ?? null);
  const [color, setColor] = useState("Blue");
  const [caption, setCaption] = useState("");
  const [altText, setAltText] = useState("");
  const [image, setImage] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [message, setMessage] = useState("");
  const overLimit = Boolean(platform.charLimit && caption.trim().length > platform.charLimit);
  // Preselects the color that keeps Blue/Purple alternating (the user can change it)
  const colorSuggestion = useSuggestedColor({ platform, date, time, onSuggest: setColor });

  async function save(force = false) {
    const missingImage = imageProblem(image);
    if (!postTypeId) return setMessage(`${platform.name} has no Specific Date post type. Add a "Holiday" type on the Platforms page.`);
    if (!date || !time) return setMessage("Please choose a date and a time.");
    if (!caption.trim()) return setMessage("Please enter a caption.");
    if (missingImage) return setMessage(missingImage);
    try {
      await api.createPost({
        platformId: platform.id,
        kind: "fixed",
        fixedAt: `${date}T${time}`,
        postTypeId,
        color: platform.usesColors ? color : null,
        caption,
        mediaId: image.media.id,
        altText,
        ...(force ? { force: true } : {}),
      });
    } catch (error) {
      if (error.status === 409 && error.body?.conflict) {
        setConflict(error.body);
        setMessage("");
      } else {
        setMessage(error.message);
      }
      return;
    }
    onSaved(`Holiday post scheduled for ${formatLocal(`${date}T${time}`)}. That day's library post went back to the library.`);
  }

  return (
    <div className="post-editor">
      <p className="field-hint">
        A Specific Date post: it goes out at this date and time, and that day's library slot is skipped.
      </p>

      <div className="date-time-row">
        <div>
          <label htmlFor="holidayDate">Date <RequiredMark /></label>
          <input id="holidayDate" type="date" value={date} aria-required="true"
            onChange={(event) => { setDate(event.target.value); setConflict(null); }} />
        </div>
        <div>
          <label htmlFor="holidayTime">Time ({zoneCity()}) <RequiredMark /></label>
          <input id="holidayTime" type="time" value={time} aria-required="true"
            onChange={(event) => { setTime(event.target.value); setConflict(null); }} />
        </div>
      </div>
      <YourTimeHint date={date} time={time} />
      <BlackoutNotice platformId={platform.id} date={date} />

      {types.length > 1 ? (
        <>
          <label htmlFor="holidayType">Post Type <RequiredMark /></label>
          <select id="holidayType" value={postTypeId ?? ""} aria-required="true"
            onChange={(event) => setPostTypeId(Number(event.target.value))}>
            {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
          </select>
          <p className="field-hint">{platform.name} has no type named "Holiday", so pick one of its Specific Date types.</p>
        </>
      ) : types.length === 1 ? (
        <p>Post type: <strong>{types[0].name}</strong></p>
      ) : (
        <p className="error-text">
          {platform.name} has no Specific Date post type yet. Add a "Holiday" type (outside the rotation) on the Platforms page.
        </p>
      )}

      {platform.usesColors && (
        <>
          <span className="field-label" id="holidayColorLabel">Color <RequiredMark /></span>
          <ColorRadios name="holidayColor" value={color} onChange={setColor} labelledBy="holidayColorLabel" />
          <SuggestedColorNote suggestion={colorSuggestion} color={color} />
        </>
      )}

      <label htmlFor="holidayCaption">Caption <RequiredMark /></label>
      <textarea
        id="holidayCaption"
        rows="4"
        value={caption}
        onChange={(event) => setCaption(event.target.value)}
        placeholder="Write the holiday post here, hashtags included..."
        aria-required="true"
      />
      <p className={overLimit ? "error-text" : "field-hint"}>
        Characters: {caption.trim().length}{platform.charLimit ? ` / ${platform.charLimit}` : ""}
      </p>

      <ImageField
        idPrefix="holiday"
        image={image}
        setImage={setImage}
        altText={altText}
        setAltText={setAltText}
        platformId={platform.id}
        removable
      />

      {conflict && (
        <ConflictNotice
          conflict={conflict}
          onUseSuggested={(suggestedAt) => {
            const next = splitFixedAt(suggestedAt);
            setDate(next.date);
            setTime(next.time);
            setConflict(null);
          }}
          onForce={() => save(true)}
        />
      )}
      {message && <p className="error-text" role="alert">{message}</p>}

      <button type="button" onClick={() => save()} disabled={image?.uploading || overLimit || types.length === 0}>
        Schedule holiday post
      </button>
      <button type="button" className="secondary-button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

// The padlock shown on locked slots and in the legend; labelled "Locked" for screen readers
function LockIcon() {
  return (
    <svg className="slot-lock" viewBox="0 0 16 16" width="12" height="12" aria-label="Locked" role="img">
      <path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3" y="7" width="10" height="7.5" rx="1.5" fill="currentColor" />
    </svg>
  );
}

/**
 * The cells of one month's grid.
 *
 * Usage:
 *   monthCells("2026-11")  // [null, null, null, null, null, "2026-11-01", ..., "2026-11-30"]
 *
 * Takes:
 *   month - "YYYY-MM"
 *
 * Returns:
 *   Leading nulls up to the first day's weekday (Monday first), then "YYYY-MM-DD" for
 *   every day of the month. Worked out in UTC so the viewer's zone cannot shift a day.
 */
function monthCells(month) {
  const [year, m] = month.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(year, m - 1, 1)).getUTCDay();
  const totalDays = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const blanks = Array.from({ length: (firstWeekday + 6) % 7 }, () => null);
  const days = Array.from({ length: totalDays }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
  return [...blanks, ...days];
}

/**
 * The small "Wk 45" shown in the first cell of each week row of the month grid.
 *
 * Usage:
 *   Rendered by Calendar for cells whose index % 7 === 0: <WeekNumber cells={cells} index={index} />
 *
 * Takes:
 *   cells - the month's grid cells from monthCells (leading nulls, then "YYYY-MM-DD")
 *   index - the cell index of the row's first (Monday) cell
 *
 * Returns:
 *   A span with the week number of the row's Monday (weekOfYear in time.js: Sunday-start weeks,
 *   week 1 contains January 1). Monday to Saturday of a row share that week; the row's Sunday
 *   already starts the next one, because the grid is Monday first.
 *
 * How it works:
 *   Finds the first real date in the row and steps back to its Monday (the first row of a month
 *   can start with blank cells), in UTC so the viewer's zone cannot shift the day.
 *
 * When editing:
 *   Display only. "Every other week" rules count weeks from their own start date, not from this.
 */
function WeekNumber({ cells, index }) {
  const offset = cells.slice(index, index + 7).findIndex(Boolean);
  if (offset < 0) return null;
  const [year, m, d] = cells[index + offset].split("-").map(Number);
  const monday = new Date(Date.UTC(year, m - 1, d - offset)).toISOString().slice(0, 10);
  const week = weekOfYear(monday);
  return (
    <span className="month-week-number" title={`Week ${week} of the year`}>
      Wk {week}
    </span>
  );
}

// "2026-11" -> "November 2026" (in UTC so no zone can move it to the month before)
function monthTitle(month) {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
}

/**
 * The Calendar page: a platform picker, month navigation, the month grid of slots and
 * Specific Date posts, and one panel at a time below it (a slot, a Specific Date post, or
 * the holiday form).
 *
 * Usage:
 *   Rendered by App.jsx for the /calendar route: <Calendar />
 *
 * Returns:
 *   The page section.
 *
 * How it works:
 *   1. Loads platforms and the status; picks the first enabled platform. "Today" and the
 *      starting month come from the server, because in test mode the app clock can be moved.
 *   2. load() fetches the month's slots and Specific Date posts (GET /api/slots), the
 *      platform's unplaced library posts (the pool, for the slot panel's post choice), and
 *      the blackout dates. Blackouts only grey days, so the month shows without them.
 *   3. Each day shows its Specific Date posts first, then its slots by time. A slot is
 *      "blocked" (skipped) when a Specific Date post is on that day, "filled" or "ghost"
 *      (empty). A locked or pinned slot on a blackout day is kept and flagged.
 *   4. What this person may change: slots (editSlots), posts (editPosts and
 *      editScheduledPosts, since every post shown here is scheduled), new holiday
 *      posts (createPosts). Controls they may not use are left out (the server checks too).
 *   5. The slot panel: post type, color, which post (Automatic = oldest match, or one
 *      picked by hand, which pins it), lock. Changing the type of a slot made by a rule
 *      offers three scopes (see saveSlot below).
 *   6. After any save: close the panel, show what happened, reload the month.
 *
 * When editing:
 *   The slot rules (no domino, locked/pinned never change, blocked days) live on the
 *   server: server/src/routes/slots.js and server/src/services/projection.js and sync.js.
 *   The panel's choices only send what changed.
 */
export default function Calendar() {
  // Hidden, not refused: the server checks too
  const { permissions } = useCurrentUser();
  const canEditSlots = Boolean(permissions.editSlots);
  // Every post on the Calendar is scheduled (in a slot, or Specific Date), so editing one also
  // needs editScheduledPosts (server/src/routes/posts.js checks the same)
  const canEditPosts = Boolean(permissions.editPosts && permissions.editScheduledPosts);
  const askToEdit = Boolean(permissions.editPosts) && !canEditPosts;
  const canAddHoliday = Boolean(permissions.createPosts);
  const [platforms, setPlatforms] = useState([]);
  const [platformId, setPlatformId] = useState(null);
  const [timezone, setTimezone] = useState();
  const [today, setToday] = useState("");
  const [month, setMonth] = useState("");
  const [slots, setSlots] = useState([]);
  const [fixedPosts, setFixedPosts] = useState([]);
  const [pool, setPool] = useState([]); // unplaced library posts of this platform
  const [blackouts, setBlackouts] = useState([]); // this platform's and all-platform blackout dates
  const [selected, setSelected] = useState(null); // { slot, postTypeId, color, postId, locked }
  const [openFixed, setOpenFixed] = useState(null); // a Specific Date post being edited
  const [holidayDate, setHolidayDate] = useState(null); // "YYYY-MM-DD" while adding a holiday post
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState(""); // what the last save did
  const slotPanel = useScrollIntoView(selected?.slot.id);
  const fixedPanel = useScrollIntoView(openFixed?.id);
  const holidayPanel = useScrollIntoView(holidayDate);

  useEffect(() => {
    Promise.all([api.platforms(), api.status()])
      .then(([allPlatforms, status]) => {
        setPlatforms(allPlatforms);
        setPlatformId((allPlatforms.find((p) => p.enabled) ?? allPlatforms[0])?.id ?? null);
        setTimezone(status.timezone);
        // From the server: test mode can move the clock
        setToday(zonedParts(status.now, status.timezone).date);
        setMonth(monthKey(status.now, status.timezone));
      })
      .catch((error) => setMessage(error.message));
  }, []);

  // Step 2: the month's data for the chosen platform
  async function load() {
    if (!platformId || !month) return;
    const [monthData, unplaced] = await Promise.all([
      api.slots(platformId, month),
      api.posts({ status: "queued", platformId, kind: "library", placed: false }),]);
    setSlots(monthData.slots);
    setFixedPosts(monthData.fixedPosts);
    setPool(unplaced);
    // Only greys days; the month shows without it
    setBlackouts(await api.blackouts(platformId).catch(() => []));
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

  // One panel at a time: a slot, a Specific Date post, or the holiday form.
  // choosePlatform, goToMonth, openHoliday, openFixedPost and openSlot all close the others first.
  function closePanels() {
    setSelected(null);
    setOpenFixed(null);
    setHolidayDate(null);
  }

  function choosePlatform(id) {
    closePanels();
    setMessage("");
    setNotice("");
    setPlatformId(id);
  }

  function goToMonth(next) {
    closePanels();
    setMonth(next);
  }

  function openHoliday(date) {
    closePanels();
    setMessage("");
    setNotice("");
    setHolidayDate(date);
  }

  function openFixedPost(post) {
    closePanels();
    setMessage("");
    setNotice("");
    setOpenFixed(post);
  }

  // After a post editor or the holiday form saves: close it, say what happened, reload the month
  async function afterSave(text) {
    closePanels();
    setMessage("");
    setNotice(text);
    await load().catch((error) => setMessage(error.message));
  }

  /**
   * Opens the slot panel for a slot, starting from its current values. The post choice
   * starts at the pinned post, or Automatic ("") when it is not pinned.
   *
   * Takes:
   *   slot - a slot row from GET /api/slots
   */
  function openSlot(slot) {
    closePanels();
    setMessage("");
    setNotice("");
    setSelected({
      slot,
      postTypeId: slot.postTypeId,
      color: slot.color,
      postId: slot.pinned && slot.postId ? String(slot.postId) : "",
      locked: slot.locked,
      // "only" this slot, "later" slots with the same old type, or the "rotation" from here;
      // check is the preview waiting for a confirm
      typeScope: "only",
      check: null,
    });
  }

  // The post choice: this slot's post plus the pool, matching the picked type (and color)
  const candidates = selected
    ? [selected.slot.post, ...pool]
        .filter(Boolean)
        .filter((post, index, all) => all.findIndex((p) => p.id === post.id) === index)
        .filter((post) => post.postTypeId === selected.postTypeId && (!platform?.usesColors || post.color === selected.color))
    : [];

  // laterScope: "later" or "rotation" when the type-change route is needed (see saveSlot)
  const typeChanged = selected && selected.postTypeId !== selected.slot.postTypeId;
  const laterScope = typeChanged && selected.slot.ruleId && selected.typeScope !== "only" ? selected.typeScope : null;

  /**
   * Saves the slot panel.
   *
   * Usage:
   *   saveSlot()      // "Save slot"
   *   saveSlot(true)  // "Yes, change them" after the preview
   *
   * Takes:
   *   confirmed - true once the preview of a "later"/"rotation" change was confirmed
   *
   * How it works:
   *   1. Collects only what changed: postTypeId (only for "Only this slot"), color (on
   *      platforms with colors), locked, and postId (a number pins that post; null goes
   *      back to automatic).
   *   2. "This and later slots" and "Shift the rotation" (only for slots made by a rule)
   *      go through the type-change route: first GET /api/slots/:id/type-change for a
   *      preview ("This changes N later slots (until <date>)"), shown with a confirm;
   *      on confirm, POST it. The panel's other changes follow as before.
   *   3. Then PATCH /api/slots/:id with the rest, if anything is left.
   *   4. Closes the panel, shows what happened and reloads the month.
   *
   * When editing:
   *   The type change is sent first, then the PATCH. The PATCH must not carry postTypeId
   *   when the scope is "later" or "rotation"; the type-change route already set it.
   */
  async function saveSlot(confirmed = false) {
    const { slot, postTypeId, color, postId, locked } = selected;
    const changes = {};
    if (postTypeId !== slot.postTypeId && !laterScope) changes.postTypeId = postTypeId;
    if (platform?.usesColors && color !== slot.color) changes.color = color;
    if (locked !== slot.locked) changes.locked = locked;
    const initialPick = slot.pinned && slot.postId ? String(slot.postId) : "";
    if (postId !== initialPick) changes.postId = postId ? Number(postId) : null;

    let done = "";
    try {
      if (laterScope && !confirmed) {
        const check = await api.slotTypeChangePreview(slot.id, laterScope, postTypeId);
        setSelected({ ...selected, check });
        setMessage("");
        return;
      }
      if (laterScope) {
        const result = await api.changeSlotType(slot.id, laterScope, postTypeId);
        done = `Changed this slot and ${result.changes} later slot${result.changes === 1 ? "" : "s"}.`;
      }
      if (Object.keys(changes).length) await api.updateSlot(slot.id, changes);
      setSelected(null);
      setMessage("");
      setNotice(done);
    } catch (error) {
      setMessage(error.message);
      return;
    }
    await load().catch((error) => setMessage(error.message));
  }

  /**
   * The preview's text for a "later"/"rotation" type change.
   *
   * Takes:
   *   check - from GET /api/slots/:id/type-change: { changes, until "YYYY-MM-DD",
   *           postsReturning, keptSlots }
   *
   * Returns:
   *   e.g. "This changes 6 later slots (until <date>). 2 posts go back to the library and
   *   fill the next matching slot. 1 locked or pinned slot stays as it is. Months further
   *   ahead follow this too." The posts and kept-slots sentences only show when non-zero.
   */
  function typeCheckText(check) {
    const parts = [check.changes
      ? `This changes ${check.changes} later slot${check.changes === 1 ? "" : "s"} (until ${formatDate(`${check.until}T12:00:00Z`, "UTC")}).`
      : "No later slots on the calendar change."];
    if (check.postsReturning) {
      parts.push(`${check.postsReturning} post${check.postsReturning === 1 ? " goes" : "s go"} back to the library and fill${check.postsReturning === 1 ? "s" : ""} the next matching slot.`);
    }
    if (check.keptSlots) {
      parts.push(`${check.keptSlots} locked or pinned slot${check.keptSlots === 1 ? " stays" : "s stay"} as ${check.keptSlots === 1 ? "it is" : "they are"}.`);
    }
    parts.push("Months further ahead follow this too.");
    return parts.join(" ");
  }

  const typeName = (id) => platform?.postTypes?.find((type) => type.id === id)?.name ?? "this type";

  // "Newsletter · Blue" (no color part on platforms without colors)
  function slotTag(slot) {
    return `${slot.postTypeName}${slot.color ? ` · ${slot.color}` : ""}`;
  }

  /**
   * One slot button in a day cell: type and color (padlock when locked), time (app time
   * only; the tooltip has both zones), a blackout flag when it was kept on a blackout day,
   * and the caption, "Skipped: ..." (blocked) or "Empty: needs content".
   */
  function renderSlot(slot) {
    const isSelected = selected?.slot.id === slot.id;
    const state = slot.blocked ? "blocked" : slot.post ? "filled" : "ghost";

    return (
      <button
        type="button"
        key={slot.id}
        className={`slot slot-${state} slot-${colorClass(slot.color)}${isSelected ? " slot-selected" : ""}`}
        onClick={() => openSlot(slot)}
        title={formatSlotTime(slot.date, slot.time, timezone)}
      >
        <span className="slot-tag">
          {slot.locked && <LockIcon />}
          {slotTag(slot)}
        </span>
        <span className="slot-time">{formatClock(slot.time)}</span>
        {slot.blackout && <span className="slot-blackout-flag">Blackout day: kept ({slot.pinned ? "pinned" : "locked"})</span>}
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

  // One Specific Date post button in a day cell (orange); opens its panel
  function renderFixed(post) {
    return (
      <button
        type="button"
        key={`fixed-${post.id}`}
        className={`slot slot-fixed${openFixed?.id === post.id ? " slot-selected" : ""}`}
        onClick={() => openFixedPost(post)}
        title={formatLocal(post.fixedAt, timezone)}
      >
        <span className="slot-tag">Specific Date</span>
        <span className="slot-time">{formatClock(post.fixedAt.slice(11, 16))}</span>
        <span className="slot-caption">{post.caption}</span>
      </button>
    );
  }

  return (
    <section>
      <div className="schedule-header">
        <div>
          <h1>Calendar</h1>
          <p>Posting slots for the month. Click a slot to {canEditSlots || canEditPosts ? "change" : "see"} it.</p>
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

      {platform?.paused && (
        <p className="sign-in-temporary" role="note">
          Posting is paused for {platform.name}. Slots keep their posts, but nothing is scheduled or sent and the
          Google Calendar events are removed until it is resumed on the Platforms page.
        </p>
      )}

      {message && <p className="error-text">{message}</p>}
      {notice && <p className="success-text" role="status">{notice}</p>}

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
        {blackouts.length > 0 && <span className="legend-item legend-blackout">Blackout day (grey)</span>}
      </div>

      <p className="field-hint">
        Colors alternate and post types repeat automatically
        {canEditSlots || canEditPosts ? "; you can change any slot or post." : "."}
        {canAddHoliday && " Use + Holiday on a day to add a holiday post."}{" "}
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
            if (!date) {
              return (
                <div className="month-day month-day-empty" key={`empty-${index}`}>
                  {index % 7 === 0 && <WeekNumber cells={cells} index={index} />}
                </div>
              );
            }

            const daySlots = slotsByDate.get(date) ?? [];
            const dayFixed = fixedByDate.get(date) ?? [];
            const blackout = blackoutOn(blackouts, date, platformId);

            return (
              <div
                className={`month-day${date === today ? " month-day-today" : ""}${daySlots.length || dayFixed.length || blackout ? "" : " month-day-quiet"}${blackout ? " month-day-blackout" : ""}`}
                key={date}
              >
                <div className="month-day-number">
                  <span>
                    {/* The weekday shows only in the phone list layout */}
                    <span className="month-day-weekday">{weekdays[index % 7]} </span>
                    {Number(date.slice(8))}
                    {index % 7 === 0 && <> <WeekNumber cells={cells} index={index} /></>}
                  </span>
                  {canAddHoliday && today && date >= today && (
                    <button
                      type="button"
                      className="day-add"
                      onClick={() => openHoliday(date)}
                      aria-label={`Add holiday post on ${dayLabel(date)}`}
                      title="Add holiday post"
                    >
                      + Holiday
                    </button>
                  )}
                </div>
                {blackout && (
                  <span className="month-day-blackout-label">
                    Blackout{blackout.reason ? `: ${blackout.reason}` : ""}
                  </span>
                )}
                {dayFixed.map(renderFixed)}
                {daySlots.map(renderSlot)}
              </div>
            );
          })}
        </div>
      </div>

      {selected && platform && (
        <div className="post-details slot-panel" ref={slotPanel}>
          <div className="post-details-header">
            <h2>
              Slot: {dayLabel(selected.slot.date)} at {formatSlotTime(selected.slot.date, selected.slot.time, timezone)}
            </h2>
          </div>

          {selected.slot.blocked && (
            <p className="field-hint">
              A Specific Date post is on this day, so this slot is skipped.
            </p>
          )}
          {selected.slot.blackout && (
            <p className="field-hint field-hint-strong">
              This day is a blackout day{selected.slot.blackout.reason ? ` (${selected.slot.blackout.reason})` : ""}. The
              slot was kept because it is {selected.slot.pinned ? "pinned" : "locked"}, and its post still goes out.
              Unlock it and set it to automatic to clear the day.
            </p>
          )}

          {!canEditSlots && (
            <p>
              {slotTag(selected.slot)}
              {selected.slot.locked ? " · Locked" : ""}
              {selected.slot.pinned ? " · Post picked by hand" : ""}
            </p>
          )}
          {canEditSlots && (
          <div className="slot-panel-grid">
            <div>
              <label htmlFor="slotType">Post type for this slot</label>
              <PostTypeSelect
                id="slotType"
                platform={platform}
                value={selected.postTypeId}
                onChange={(postTypeId) => setSelected({ ...selected, postTypeId, postId: "", check: null })}
                rotationOnly
              />

              {typeChanged && selected.slot.ruleId && (
                <fieldset className="type-scope">
                  <legend className="field-label">Change the type for</legend>
                  {[
                    ["only", "Only this slot", "Later slots keep their types."],
                    ["later", "This and later slots",
                      `Every later ${typeName(selected.slot.postTypeId)} slot of this schedule becomes ${typeName(selected.postTypeId)}. Other types stay.`],
                    ["rotation", "Shift the rotation",
                      `Later slots follow the schedule's type order on from ${typeName(selected.postTypeId)}, as if it started here.`],
                  ].map(([scope, label, hint]) => (
                    <label key={scope}>
                      <input
                        type="radio"
                        name="typeScope"
                        value={scope}
                        checked={selected.typeScope === scope}
                        onChange={() => setSelected({ ...selected, typeScope: scope, check: null })}
                      />
                      <span>
                        {label}
                        <span className="field-hint">{hint}</span>
                      </span>
                    </label>
                  ))}
                  <p className="field-hint">Locked and pinned slots never change.</p>
                </fieldset>
              )}

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
          )}

          {canEditSlots && selected.check && laterScope && (
            <p role="alert" className="type-scope-check">
              {typeCheckText(selected.check)}{" "}
              <button type="button" onClick={() => saveSlot(true)}>Yes, change them</button>
              <button type="button" className="secondary-button" onClick={() => setSelected({ ...selected, check: null })}>
                Cancel
              </button>
            </p>
          )}
          {canEditSlots && !(selected.check && laterScope) && (
            <button type="button" onClick={() => saveSlot()}>
              Save slot
            </button>
          )}
          <button type="button" className="secondary-button" onClick={() => setSelected(null)}>
            Close
          </button>
          {canAddHoliday && selected.slot.date >= today && (
            <button type="button" className="secondary-button" onClick={() => openHoliday(selected.slot.date)}>
              Add holiday post on this day
            </button>
          )}

          {selected.slot.post && (
            <div className="slot-panel-post">
              <h3>Post in this slot</h3>
              {!canEditPosts ? (
                <>
                  <p className="library-caption">{selected.slot.post.caption}</p>
                  {askToEdit && <p className="field-hint">Ask a super admin to change a scheduled post.</p>}
                </>
              ) : selected.slot.post.status === "queued" ? (
                <PostEditor
                  key={selected.slot.post.id}
                  post={selected.slot.post}
                  platform={platform}
                  date={selected.slot.date}
                  time={selected.slot.time}
                  onSaved={afterSave}
                />
              ) : (
                <p className="field-hint">This post is {selected.slot.post.status} and can no longer be edited.</p>
              )}
            </div>
          )}
        </div>
      )}

      {openFixed && platform && (
        <div className="post-details slot-panel" ref={fixedPanel}>
          <div className="post-details-header">
            <h2>Specific Date post: {formatLocal(openFixed.fixedAt, timezone)}</h2>
          </div>
          {!canEditPosts ? (
            <>
              <p className="library-caption">{openFixed.caption}</p>
              {askToEdit && <p className="field-hint">Ask a super admin to change a scheduled post.</p>}
            </>
          ) : openFixed.status === "queued" ? (
            <PostEditor
              key={openFixed.id}
              post={openFixed}
              platform={platform}
              {...splitFixedAt(openFixed.fixedAt)}
              onSaved={afterSave}
            />
          ) : (
            <p className="field-hint">This post is {openFixed.status} and can no longer be edited.</p>
          )}
          <button type="button" className="secondary-button" onClick={() => setOpenFixed(null)}>
            Close
          </button>
        </div>
      )}

      {canAddHoliday && holidayDate && platform && (
        <div className="post-details slot-panel" ref={holidayPanel}>
          <div className="post-details-header">
            <h2>Add holiday post: {platform.name}</h2>
          </div>
          <HolidayForm
            key={`${platform.id}-${holidayDate}`}
            platform={platform}
            date={holidayDate}
            onSaved={afterSave}
            onCancel={() => setHolidayDate(null)}
          />
        </div>
      )}

      <p className="schedule-note">
        Google Calendar mirrors the scheduled posts shown here. Times are {zoneCity(timezone)} time ({timezone ?? "the app time zone"}).
      </p>
    </section>
  );
}
