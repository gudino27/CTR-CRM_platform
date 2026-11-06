/**
 * Starts the server (`npm start` / `npm run dev`): opens and migrates the database, seeds the
 * platforms, fails posts a crash left half-sent, listens on PORT, then runs the background jobs.
 *
 * Background jobs, each on its own timer (the intervals are in settings.js):
 *   tick (routes/system.js)               every dispatchTickMs: send what is due, sync the calendar,
 *                                          purge images past their restore window
 *   pullCalendar (services/calendarPull.js) every calendarPullMs: two-way calendar sync, reads hand
 *                                          edits in Google Calendar back; does nothing without a
 *                                          configured calendar and logs its own errors
 *   notifyFailures (services/notifications.js) every notificationScanMs: a notification for each
 *                                          post that failed to send (from the dispatcher or n8n),
 *                                          once per failure
 *   autoArchive (services/archive.js)     every autoArchiveCheckMs: automatic archiving, off until a
 *                                          retention period is chosen; does nothing unless
 *                                          ARCHIVE_AFTER_MONTHS is set, and when set archives (never
 *                                          deletes) older published posts
 *
 * When editing:
 *   failInterrupted must run before the first tick, so a post left "sending" by a crash is
 *   marked failed instead of sent twice. Each job catches its own errors so one failure does
 *   not stop the others. Startup checks /api/health for app "ctr-scheduler" to warn when
 *   something else answers on the port.
 */
import { config } from './config.js';
import { openDb } from './db/index.js';
import { seed } from './db/seed.js';
import { createApp } from './app.js';
import { failInterrupted } from './services/dispatch.js';
import { tick } from './routes/system.js';
import { pullCalendar } from './services/calendarPull.js';
import { notifyFailures } from './services/notifications.js';
import { autoArchive } from './services/archive.js';
import { autoArchiveCheckMs, calendarPullMs, dispatchTickMs, notificationScanMs } from './settings.js';

const db = await openDb();
await seed(db);
await failInterrupted(db);

(await createApp(db)).listen(config.port, async () => {
  console.log(`Scheduler API on http://localhost:${config.port} (test mode: ${config.testMode}, dry run: ${config.dryRun})`);
  const health = await fetch(`${config.selfUrl}/api/health`).then((r) => r.json()).catch(() => null);
  if (health?.app !== 'ctr-scheduler') {
    console.error(`\nWARNING: something else is answering on port ${config.port}. Set a free PORT in .env (for example PORT=3100).\n`);
  }
  await tick(db);
  setInterval(() => tick(db).catch((err) => console.error('Tick failed:', err)), dispatchTickMs);
  await pullCalendar(db);
  setInterval(() => pullCalendar(db), calendarPullMs);
  setInterval(() => notifyFailures(db).catch((err) => console.error('Failed-post notifications failed:', err)), notificationScanMs);
  const archiveOld = () => autoArchive(db).catch((err) => console.error('Automatic archiving failed:', err));
  await archiveOld();
  setInterval(archiveOld, autoArchiveCheckMs);
});