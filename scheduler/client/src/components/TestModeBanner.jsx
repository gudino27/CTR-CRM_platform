import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Deliverable 4: always visible while events go to the test calendar
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