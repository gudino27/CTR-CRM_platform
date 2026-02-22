/**
 * Badge.jsx — Colored status pill component
 *
 * Renders a small inline pill with background + text color matched to
 * a named variant. Used throughout the app to display record status
 * (active, inactive, scheduled, completed, paused, cancelled).
 *
 * Props:
 *   label   {string} — Text to display inside the badge
 *   variant {string} — One of the keys in variantStyles; defaults to "active"
 *
 * If an unrecognized variant is passed, falls back to "active" styling.
 */
import "./Badge.css";

/**
 * Maps status names to their pill colors.
 * Teal  = active/scheduled  |  Green = completed
 * Amber = paused            |  Red   = cancelled
 * Gray  = inactive
 */
const variantStyles = {
  scheduled:  { background: "#E8F7F6", color: "#1A6B67" },
  completed:  { background: "#EAFAF1", color: "#1E8449" },
  paused:     { background: "#FEF9E7", color: "#B7770D" },
  cancelled:  { background: "#FDEDEC", color: "#C0392B" },
  active:     { background: "#E8F7F6", color: "#1A6B67" },
  inactive:   { background: "#F2EEE9", color: "#7A7068" },
};

export default function Badge({ label, variant = "active" }) {
  // Fall back to "active" colors for unknown variants
  const style = variantStyles[variant] ?? variantStyles.active;
  return (
    <span className="badge" style={style}>
      {label}
    </span>
  );
}
