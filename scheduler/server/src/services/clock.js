// App clock: in test mode the "now" can be moved so scheduling can be
// exercised without waiting for real time (Deliverable 4).
import { config } from '../config.js';

let offsetMs = 0;

export const clock = {
  now: () => new Date(Date.now() + offsetMs),
  set(isoDate) {
    if (!config.testMode) throw new Error('App clock can only be changed in test mode');
    offsetMs = new Date(isoDate).getTime() - Date.now();
  },
  reset: () => { offsetMs = 0; },
};
