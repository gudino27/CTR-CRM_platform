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

// Wall-clock "HH:MM" as "9:30 AM", with no time zone conversion
export function formatClock(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** A fixedAt string ("YYYY-MM-DDTHH:MM", already in the app time zone) for display. */
export function formatLocal(fixedAt) {
  const [date, time] = fixedAt.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const label = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
  });
  return `${label}, ${formatClock(time)}`;
}

// createdAt comes from SQLite's datetime('now'): "YYYY-MM-DD HH:MM:SS" in UTC
export function formatDate(createdAt, timeZone) {
  if (!createdAt) return '';
  const iso = createdAt.includes('T') ? createdAt : `${createdAt.replace(' ', 'T')}Z`;
  return new Date(iso).toLocaleDateString('en-US', { timeZone, month: 'short', day: 'numeric', year: 'numeric' });
}

/** "YYYY-MM" for the app's current month. */
export function monthKey(iso, timeZone) {
  return zonedParts(iso, timeZone).date.slice(0, 7);
}

export function shiftMonth(month, delta) {
  const [year, m] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
