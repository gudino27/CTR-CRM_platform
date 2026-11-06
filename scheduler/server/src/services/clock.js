/**
 * The app's clock. Everything that asks "what time is it?" (scheduling, dispatch, archiving,
 * sync) reads clock.now() instead of new Date(), so in test mode "now" can be moved and
 * scheduling can be exercised without waiting for real time (Deliverable 4).
 *
 * Usage:
 *   const now = clock.now();
 *   clock.set('2026-12-01T09:00:00Z');   // test mode only (POST /api/clock)
 *   clock.reset();
 *
 * Takes:
 *   set(isoDate) - any date string new Date() understands; the clock then runs on from it
 *
 * Returns:
 *   now()   - a Date: real time plus the current offset
 *   set()   - nothing; throws 'App clock can only be changed in test mode' when TEST_MODE is off
 *   reset() - nothing; the clock goes back to real time
 *
 * How it works:
 *   Keeps one offset in milliseconds (0 by default). set() stores the gap between the given
 *   date and real time, so the moved clock keeps ticking; reset() puts the offset back to 0.
 *
 * When editing:
 *   The offset lives in memory only, so a server restart returns to real time. The test-mode
 *   check in set() is what keeps a live server's clock honest; keep it.
 */
import { config } from '../config.js';

let offsetMs = 0;

export const clock = {
  now: () => new Date(Date.now() + offsetMs),
  set(isoDate) {
    // Only in test mode: a moved clock on a live server would publish posts early
    if (!config.testMode) throw new Error('App clock can only be changed in test mode');
    offsetMs = new Date(isoDate).getTime() - Date.now();
  },
  reset: () => { offsetMs = 0; },
};
