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
    <div className="test-banner">
      Test mode: events go to the test calendar. App clock: {new Date(status.now).toLocaleString()}
    </div>
  );
}
