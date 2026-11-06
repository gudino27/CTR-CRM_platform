/**
 * Small form pieces shared by Compose, Library and Calendar: the slot colors, required-field
 * star, color and post type badges and pickers, the conflict notice after a 409, and
 * splitFixedAt.
 */
import { formatLocal, formatSlotTime } from "../time.js";

/**
 * The slot colors a library post or slot can have, in the order the radios show them.
 *
 * Usage:
 *   slotColors.map((color) => ...)
 *
 * When editing:
 *   These are values the server stores and checks; adding one needs the server to accept it
 *   too. Their shades are --slot-blue and --slot-purple in styles.css, picked by colorClass().
 */
export const slotColors = ["Blue", "Purple"];

/**
 * The red star after a required field's label; screen readers hear "(required)" instead.
 *
 * Usage:
 *   <label htmlFor="caption">Caption <RequiredMark /></label>
 */
export function RequiredMark() {
  return (
    <>
      <span className="required-star" aria-hidden="true">*</span>
      <span className="sr-only"> (required)</span>
    </>
  );
}

/**
 * The CSS modifier for a Blue / Purple / no-color item.
 *
 * Usage:
 *   `slot-${colorClass(slot.color)}`   // "slot-blue", "slot-none"
 *
 * Takes:
 *   color - "Blue", "Purple", or empty
 *
 * Returns:
 *   The color in lower case, or "none".
 */
export function colorClass(color) {
  return color ? color.toLowerCase() : "none";
}

/**
 * A small colored badge with the slot color's name.
 *
 * Usage:
 *   <ColorBadge color={post.color} />   (Library, Inventory)
 *
 * Returns:
 *   The badge, or nothing when there is no color.
 */
export function ColorBadge({ color }) {
  if (!color) return null;
  return <span className={`badge badge-${colorClass(color)}`}>{color}</span>;
}

/**
 * A small badge with the post type's name.
 *
 * Usage:
 *   <TypeBadge name={post.postTypeName} />   (Library, Inventory)
 *
 * Returns:
 *   The badge, or nothing when there is no name.
 */
export function TypeBadge({ name }) {
  if (!name) return null;
  return <span className="badge badge-type">{name}</span>;
}

/**
 * Radio buttons for the slot colors (one per slotColors entry).
 *
 * Usage:
 *   <ColorRadios name="composeColor" value={color} onChange={setColor} labelledBy="composeColorLabel" />
 *
 * Takes:
 *   name       - the radio group's name, unique per form
 *   value      - the chosen color, or empty
 *   onChange   - called with the color picked
 *   labelledBy - id of the "Color" label, so the group is announced with its name
 */
export function ColorRadios({ name, value, onChange, labelledBy }) {
  return (
    <div className="radio-row" role="radiogroup" aria-labelledby={labelledBy} aria-required="true">
      {slotColors.map((color) => (
        <label key={color} className={`radio-color radio-${colorClass(color)}`}>
          <input
            type="radio"
            name={name}
            value={color}
            checked={value === color}
            onChange={() => onChange(color)}
          />
          {color}
        </label>
      ))}
    </div>
  );
}

/**
 * A required select of a platform's post types.
 *
 * Usage:
 *   <PostTypeSelect id="postType" platform={platform} value={postTypeId} onChange={choosePostType} />
 *
 * Takes:
 *   id           - the select's id, for its label
 *   platform     - the platform row with postTypes ([{ id, name, inRotation }])
 *   value        - the chosen post type id
 *   onChange     - called with the chosen id as a number
 *   rotationOnly - true for slots: only the monthly rotation's types (not Holiday). Otherwise
 *                  every type is listed, and ones outside the rotation are marked
 *                  "(Specific Date only)". Default false.
 */
export function PostTypeSelect({ id, platform, value, onChange, rotationOnly = false }) {
  const types = (platform?.postTypes ?? []).filter((type) => !rotationOnly || type.inRotation);
  return (
    <select id={id} value={value ?? ""} onChange={(event) => onChange(Number(event.target.value))} required aria-required="true">
      {types.map((type) => (
        <option key={type.id} value={type.id}>
          {type.name}{!rotationOnly && !type.inRotation ? " (Specific Date only)" : ""}
        </option>
      ))}
    </select>
  );
}

/**
 * Shown after a 409: another Specific Date post on the platform is within the collision
 * window (2 hours). Offers the server's suggested time, or scheduling anyway.
 *
 * Usage:
 *   <ConflictNotice conflict={conflict} onUseSuggested={applySuggested} onForce={() => submit(true)} />
 *
 * Takes:
 *   conflict       - the 409 body: { error, conflict (the nearest other post: caption,
 *                    fixedAt), suggestedAt ("YYYY-MM-DDTHH:MM": one window after that post,
 *                    moved later until nothing clashes) }
 *   onUseSuggested - called with suggestedAt when "Use HH:MM" is clicked
 *   onForce        - called by "Schedule anyway" (the page saves again with force: true)
 *
 * When editing:
 *   The words "(2 hours later)" come from the 409's windowHours (collisionMs on the server); the window itself
 *   is collisionMs in server/src/settings.js.
 */
export function ConflictNotice({ conflict, onUseSuggested, onForce }) {
  const suggestedTime = conflict.suggestedAt?.split("T")[1];
  const other = conflict.conflict;

  return (
    <div className="conflict-notice">
      <p>
        Overlaps with "{other?.caption}"
        {other?.fixedAt && ` at ${formatLocal(other.fixedAt)}`}.
        {suggestedTime && ` Suggested time: ${formatSlotTime(conflict.suggestedAt.split("T")[0], suggestedTime)} (${conflict.windowHours} hour${conflict.windowHours === 1 ? "" : "s"} later).`}
      </p>
      {suggestedTime && (
        <button type="button" onClick={() => onUseSuggested(conflict.suggestedAt)}>
          Use {suggestedTime}
        </button>
      )}
      <button type="button" className="secondary-button" onClick={onForce}>
        Schedule anyway
      </button>
    </div>
  );
}

/**
 * Splits a fixedAt ("YYYY-MM-DDTHH:MM") into the separate date and time inputs.
 *
 * Usage:
 *   const { date, time } = splitFixedAt(post.fixedAt);
 *
 * Takes:
 *   fixedAt - "YYYY-MM-DDTHH:MM" (anything after the minutes is dropped), or empty
 *
 * Returns:
 *   { date: "YYYY-MM-DD", time: "HH:MM" }, with "" for missing parts.
 */
export function splitFixedAt(fixedAt) {
  const [date = "", time = ""] = (fixedAt ?? "").split("T");
  return { date, time: time.slice(0, 5) };
}
