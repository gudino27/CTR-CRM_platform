// Small pieces shared by Compose, Library and Calendar
import { formatClock, formatLocal } from "../time.js";

export const slotColors = ["Blue", "Purple"];

// CSS modifier for a Blue / Purple / no-color item
export function colorClass(color) {
  return color ? color.toLowerCase() : "none";
}

export function ColorBadge({ color }) {
  if (!color) return null;
  return <span className={`badge badge-${colorClass(color)}`}>{color}</span>;
}

export function TypeBadge({ name }) {
  if (!name) return null;
  return <span className="badge badge-type">{name}</span>;
}

export function ColorRadios({ name, value, onChange }) {
  return (
    <div className="radio-row">
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

// rotationOnly: slots can only use the monthly rotation's types (not Holiday).
// Otherwise every type is listed, and ones outside the rotation are marked Specific Date only.
export function PostTypeSelect({ id, platform, value, onChange, rotationOnly = false }) {
  const types = (platform?.postTypes ?? []).filter((type) => !rotationOnly || type.inRotation);
  return (
    <select id={id} value={value ?? ""} onChange={(event) => onChange(Number(event.target.value))}>
      {types.map((type) => (
        <option key={type.id} value={type.id}>
          {type.name}{!rotationOnly && !type.inRotation ? " (Specific Date only)" : ""}
        </option>
      ))}
    </select>
  );
}

// Shown after a 409: another Specific Date post is within two hours
export function ConflictNotice({ conflict, onUseSuggested, onForce }) {
  const suggestedTime = conflict.suggestedAt?.split("T")[1];
  const other = conflict.conflict;

  return (
    <div className="conflict-notice">
      <p>
        Overlaps with "{other?.caption}"
        {other?.fixedAt && ` at ${formatLocal(other.fixedAt)}`}.
        {suggestedTime && ` Suggested time: ${formatClock(suggestedTime)} (2 hours later).`}
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

// "YYYY-MM-DDTHH:MM" <-> separate date and time inputs
export function splitFixedAt(fixedAt) {
  const [date = "", time = ""] = (fixedAt ?? "").split("T");
  return { date, time: time.slice(0, 5) };
}
