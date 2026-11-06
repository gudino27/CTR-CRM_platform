/**
 * System routes under /api: the health check, the status bar's status, the test-mode clock and
 * the manual sync. Also tick, the scheduler's one step that index.js runs on a timer.
 *
 * Permissions: /health needs no sign-in; /status any signed-in user; /clock and /sync anyone
 * signed in, not written to the activity log (ROUTES in services/permissions.js).
 */
import { Router } from 'express';
import { config } from '../config.js';
import { clock } from '../services/clock.js';
import { dispatchDue, webhookUrlFor } from '../services/dispatch.js';
import { syncAll, syncState } from '../services/sync.js';
import { purgeExpiredMedia } from '../services/mediaTrash.js';
// Two-way calendar sync: hand edits in Google Calendar read back (manual sync and index.js only)
import { pullCalendar, pullState } from '../services/calendarPull.js';

/**
 * One scheduler tick: send what is due, reproject and sync the calendar, then purge images
 * past their restore window.
 *
 * Usage:
 *   await tick(db);   (index.js every dispatchTickMs, POST /clock, POST /sync)
 *
 * Takes:
 *   db - the open database
 *
 * Returns:
 *   Nothing. A dispatch or sync error is thrown; a purge error is only logged.
 *
 * How it works:
 *   1. dispatchDue sends the posts whose time has come.
 *   2. syncAll reprojects every platform's slots and writes the calendar.
 *   3. purgeExpiredMedia removes images past their restore window.
 *
 * When editing:
 *   Sending comes first so a post that is due goes out before anything else moves.
 */
export async function tick(db) {
  await dispatchDue(db);
  await syncAll(db);
  // A purge problem is logged and retried next tick; it never stops posts going out
  await purgeExpiredMedia(db).catch((err) => console.error('Media purge failed:', err));
}

/**
 * The system router, mounted at /api.
 *
 * Usage:
 *   app.use('/api', systemRouter(db));   (app.js)
 *
 * Takes:
 *   db - the open database
 *
 * Returns:
 *   An Express router with the routes below.
 */
export function systemRouter(db) {
  const router = Router();

  /**
   * GET /api/health: is the app up. No sign-in (and no BASIC_AUTH password).
   *
   * Usage:
   *   GET /api/health
   *
   * Returns:
   *   200 { ok: true, app: 'ctr-scheduler' }
   *
   * When editing:
   *   index.js checks `app` at startup to confirm it is really this app answering on its port.
   */
  router.get('/health', (req, res) => res.json({ ok: true, app: 'ctr-scheduler' }));

  /**
   * GET /api/status: what the status bar shows. Any signed-in user.
   *
   * Usage:
   *   GET /api/status
   *
   * Returns:
   *   200 { testMode, dryRun, now (ISO, the test clock's time in test mode), timezone,
   *         calendarConnected, lastSyncError, webhookUrl }
   *   webhookUrl is where a regular (non-Test) platform's posts go right now.
   */
  router.get('/status', (req, res) =>
    res.json({
      testMode: config.testMode,
      dryRun: config.dryRun,
      now: clock.now().toISOString(),
      timezone: config.timezone,
      calendarConnected: syncState.calendarConnected,
      lastSyncError: syncState.lastSyncError,
      webhookUrl: webhookUrlFor({ isTest: false }),
    }));

  /**
   * POST /api/clock: sets or resets the test-mode clock, then runs a tick. Test mode only;
   * anyone signed in.
   *
   * Usage:
   *   POST /api/clock  { now: "2026-12-01T09:00:00-05:00" }   (no `now` resets to real time)
   *
   * Takes:
   *   body.now - optional ISO date
   *
   * Returns:
   *   200 { now } (ISO); 403 when test mode is off; 400 when now is not a date.
   *
   * How it works:
   *   Moving the clock can make posts due and changes which slots are free, so a tick follows.
   */
  router.post('/clock', async (req, res) => {
    if (!config.testMode) return res.status(403).json({ error: 'Test mode is off' });
    if (req.body?.now && Number.isNaN(new Date(req.body.now).getTime())) {
      return res.status(400).json({ error: 'now must be an ISO date' });
    }
    req.body?.now ? clock.set(req.body.now) : clock.reset();
    await tick(db);
    res.json({ now: clock.now().toISOString() });
  });

  /**
   * POST /api/sync: the manual "Sync now". Anyone signed in.
   *
   * Usage:
   *   POST /api/sync
   *
   * Returns:
   *   200 { lastSyncError, lastPullError } (null when fine)
   *
   * How it works:
   *   Reads hand edits in Google Calendar first, so the tick that follows writes the schedule
   *   that follows from them.
   */
  router.post('/sync', async (req, res) => {
    await pullCalendar(db);
    await tick(db);
    res.json({ lastSyncError: syncState.lastSyncError, lastPullError: pullState.lastPullError });
  });

  return router;
}
