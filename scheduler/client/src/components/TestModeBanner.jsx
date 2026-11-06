/**
 * The warning bar at the top of every page while the server runs in test mode:
 * always visible while events go to the test calendar.
 */
import { useEffect, useState } from 'react';
import { api } from '../api.js';

/**
 * Says that scheduling is simulated, plus any calendar problem the server reports.
 *
 * Usage:
 *   Rendered by Layout.jsx: <TestModeBanner />
 *
 * Returns:
 *   Nothing unless GET /api/status says testMode. Otherwise the banner, with extra sentences
 *   when dryRun is on, when Google Calendar is not connected, and with the last sync error.
 *
 * How it works:
 *   Reads /api/status once per mount (each time Layout mounts, e.g. after signing in).
 *
 * When editing:
 *   Test mode is TEST_MODE in .env (DRY_RUN for the dry run); see the README.
 */
export default function TestModeBanner() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    api.status().then(setStatus).catch(() => setStatus(null));
  }, []);

  if (!status?.testMode) return null;

  return (
    <div className="test-mode-banner">
      TEST MODE — Scheduling is simulated. No live social media posts will be published.
      {status.dryRun && ' Dry run is on: due posts are logged, not sent.'}
      {!status.calendarConnected && ' Google Calendar is not connected!'}
      {status.lastSyncError && ` Last calendar sync failed: ${status.lastSyncError.message}`}
    </div>
  );
}