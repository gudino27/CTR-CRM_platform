// Dates are shown in the app time zone (from /api/status), not the browser's.

/** { date: "YYYY-MM-DD", time: "HH:MM" } for a UTC ISO string in timeZone. */
export function zonedParts(iso, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function formatTime(iso, timeZone) {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
}

export function formatDateTime(iso, timeZone) {
  return new Date(iso).toLocaleString('en-US', {
    timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

// Post priority as stored by the API
export const priorityLabels = { 0: 'Standard', 1: 'High', 2: 'Next (posts tomorrow)' };
