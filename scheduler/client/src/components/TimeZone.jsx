/**
 * Time zone notes for viewers whose clock is not on the app's time zone.
 * What lives here: TimeZoneNote (the page footer) and YourTimeHint (under a date/time field).
 * The text itself is built in time.js.
 */
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { awayNote, setAppTimeZone, viewerHint } from '../time.js';

/**
 * The note at the foot of every page, shown only when the viewer's clock is not on the app
 * time zone (New York by default).
 *
 * Usage:
 *   Rendered once by App.jsx, after the pages: <TimeZoneNote />
 *
 * Returns:
 *   <footer> with "Times are New York time (ET). Your time: PT (America/Los Angeles)", or nothing.
 *
 * How it works:
 *   Reads the app zone from GET /api/status once, and also hands it to setAppTimeZone so the
 *   time.js helpers called without a zone use it.
 *
 * When editing:
 *   The app zone is TIMEZONE in .env. Other helpers rely on setAppTimeZone being called
 *   here; keep it if this component changes.
 */
export function TimeZoneNote() {
  const [timeZone, setTimeZone] = useState();

  useEffect(() => {
    api.status().then((status) => {
      setAppTimeZone(status.timezone);
      setTimeZone(status.timezone);
    }).catch(() => {});
  }, []);

  const note = timeZone ? awayNote(timeZone) : '';
  if (!note) return null;
  return <footer className="time-zone-note">{note}</footer>;
}

/**
 * Under a date/time field: the same moment in the viewer's own time, when they are elsewhere.
 *
 * Usage:
 *   <YourTimeHint date={fixedDate} time={fixedTime} timeZone={timezone} />   (Composer, Library, Calendar)
 *
 * Takes:
 *   date     - "YYYY-MM-DD" as typed (app zone)
 *   time     - "HH:MM" as typed (app zone)
 *   timeZone - the app zone; optional, defaults to the one setAppTimeZone heard
 *   id       - optional id, for aria-describedby on the field
 *
 * Returns:
 *   <p> "Your time: Mon, Nov 9, 7:00 AM PT" (read out when it changes), or nothing when a
 *   field is empty or the viewer is on app time.
 */
export function YourTimeHint({ date, time, timeZone, id }) {
  const hint = viewerHint(date, time, timeZone);
  if (!hint) return null;
  return <p className="field-hint" id={id} aria-live="polite">{hint}</p>;
}
