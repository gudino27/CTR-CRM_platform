/**
 * Modal.jsx — Accessible dialog overlay
 *
 * Renders a centered dialog on top of a dimmed backdrop.
 * Returns null when `open` is false (no DOM nodes at all when closed).
 *
 * Closing behavior — the modal closes when any of these happen:
 *   1. User clicks the × button
 *   2. User clicks outside the dialog (on the backdrop)
 *   3. User presses the Escape key
 *
 * The Escape key listener is attached/detached via useEffect so it only
 * exists while the modal is open. The cleanup function removes the listener
 * when the modal closes or the component unmounts.
 *
 * Props:
 *   open      {boolean}    — Whether the modal is visible
 *   onClose   {function}   — Called when the user requests to close
 *   title     {string}     — Text shown in the modal header bar
 *   children  {ReactNode}  — Content rendered in the modal body (detail forms, etc.)
 */
import { useEffect } from "react";
import { X } from "lucide-react";
import "./Modal.css";

export default function Modal({ open, onClose, title, children }) {
  // Keyboard accessibility: close on Escape while modal is open
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey); // cleanup
  }, [open, onClose]);

  // Render nothing when closed — keeps DOM clean
  if (!open) return null;

  return (
    // Backdrop click closes the modal; stopPropagation on the dialog prevents
    // clicks inside the dialog from bubbling up to the backdrop handler
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
