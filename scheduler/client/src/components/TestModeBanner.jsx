import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Deliverable 4: always visible while events go to the test calendar
export default function TestModeBanner() {
  return (
    <div className="test-mode-banner">
      TEST MODE — Scheduling is simulated. No live social media posts will be published.
    </div>
  );
}