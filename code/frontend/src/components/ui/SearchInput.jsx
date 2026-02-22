/**
 * SearchInput.jsx — Controlled text search field with icon
 *
 * A simple wrapper around a text <input> that overlays a search icon on the left.
 * Used on the Seniors and Volunteers pages to filter list results in real time.
 *
 * This is a controlled component — the parent owns the value state
 * and passes an onChange handler that receives the raw string (not the event).
 *
 * Props:
 *   value       {string}   — Current search string (controlled)
 *   onChange    {function} — Called with the new string on every keystroke
 *   placeholder {string}   — Input placeholder text; defaults to "Search..."
 */
import { Search } from "lucide-react";
import "./SearchInput.css";

export default function SearchInput({ value, onChange, placeholder = "Search..." }) {
  return (
    <div className="search-input-wrapper">
      {/* Decorative search icon — positioned over the input via CSS */}
      <Search size={16} className="search-input__icon" />
      <input
        type="text"
        className="search-input"
        value={value}
        onChange={(e) => onChange(e.target.value)} // unwrap event, pass plain string up
        placeholder={placeholder}
      />
    </div>
  );
}
