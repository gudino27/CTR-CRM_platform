/**
 * The Blue/Purple color suggestion for Specific Date posts. A Specific
 * Date post keeps its color and the slots after it alternate from it,
 *  so the forms preselect the opposite of the previous post's color.
 *
 * What lives here:
 *   useSuggestedColor   asks the server for the suggestion and preselects it
 *   SuggestedColorNote  the short note under the color radios
 */
import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { suggestColorDelayMs } from "../settings.js";

/**
 * Asks the server which color keeps the colors alternating at a date and time, and calls
 * onSuggest with it so the form preselects it. The user can still pick the other color.
 *
 * Usage:
 *   const suggestion = useSuggestedColor({ platform, date, time, enabled: mode === "fixed", onSuggest: setColor });
 *
 * Takes:
 *   platform     - the platform ({ id, usesColors }); nothing happens without colors
 *   date, time   - "YYYY-MM-DD" and "HH:MM" in the app's time zone (New York)
 *   exceptPostId - the post being edited, so it is left out of the timeline
 *   enabled      - false to ask nothing (e.g. Library mode in Compose); default true
 *   onSuggest    - called with "Blue" or "Purple" each time a new suggestion arrives
 *
 * Returns:
 *   { color, previous } from GET /api/platforms/:id/suggest-color, or null.
 *
 * How it works:
 *   Waits suggestColorDelayMs after the last change (typing a date), then asks once. onSuggest
 *   only runs when the platform, date, time or post change, so a color the user picked
 *   afterwards stays.
 *
 * When editing:
 *   The rule lives on the server (services/sync.js suggestColor); keep the wording here in step.
 */
export function useSuggestedColor({ platform, date, time, exceptPostId = null, enabled = true, onSuggest }) {
  const [suggestion, setSuggestion] = useState(null);
  const onSuggestRef = useRef(onSuggest);
  onSuggestRef.current = onSuggest;
  const ready = enabled && platform?.usesColors && date && time;
  const key = ready ? `${platform.id} ${date}T${time} ${exceptPostId ?? ""}` : null;

  useEffect(() => {
    setSuggestion(null);
    if (!key) return undefined;
    let current = true;
    const timer = setTimeout(() => {
      api.suggestColor(platform.id, `${date}T${time}`, exceptPostId)
        .then((result) => {
          if (!current || !result.color) return;
          setSuggestion(result);
          onSuggestRef.current?.(result.color);
        })
        .catch(() => {});
    }, suggestColorDelayMs);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [key]);

  return suggestion;
}

/**
 * The note under the color radios: which color was suggested and why.
 *
 * Usage:
 *   <SuggestedColorNote suggestion={suggestion} color={color} />
 *
 * Takes:
 *   suggestion - useSuggestedColor's result (or null)
 *   color      - the color currently picked
 *
 * Returns:
 *   "Suggested so the colors keep alternating: Purple (the post before it is Blue)." plus a
 *   reminder when another color is picked, or nothing without a suggestion.
 */
export function SuggestedColorNote({ suggestion, color }) {
  if (!suggestion) return null;
  return (
    <p className="field-hint" aria-live="polite">
      Suggested so the colors keep alternating: {suggestion.color}
      {suggestion.previous ? ` (the post before it is ${suggestion.previous.color})` : ""}.
      {color && color !== suggestion.color && ` You picked ${color}; later posts will alternate from it.`}
    </p>
  );
}
