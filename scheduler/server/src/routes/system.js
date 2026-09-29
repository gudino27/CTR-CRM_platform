import { Router } from 'express';
import { config } from '../config.js';
import { clock } from '../services/clock.js';
import { dispatchDue, webhookUrlFor } from '../services/dispatch.js';
import { syncAll, syncState } from '../services/sync.js';

/** One scheduler tick: send what is due, then reproject and sync the calendar. */
export async function tick(db) {
  await dispatchDue(db);
  await syncAll(db);
}

export function systemRouter(db) {
  const router = Router();

  // `app` lets startup confirm it is really this app answering on its port
  router.get('/health', (req, res) => res.json({ ok: true, app: 'ctr-scheduler' }));

  router.get('/status', (req, res) =>
    res.json({
      testMode: config.testMode,
      dryRun: config.dryRun,
      now: clock.now().toISOString(),
      timezone: config.timezone,
      calendarConnected: syncState.calendarConnected,
      lastSyncError: syncState.lastSyncError,
      // Where a regular (non-Test) platform's posts go right now
      webhookUrl: webhookUrlFor({ isTest: false }),
    }));

  // Moving the clock can make posts due and changes which slots are free
  router.post('/clock', async (req, res) => {
    if (!config.testMode) return res.status(403).json({ error: 'Test mode is off' });
    if (req.body?.now && Number.isNaN(new Date(req.body.now).getTime())) {
      return res.status(400).json({ error: 'now must be an ISO date' });
    }
    req.body?.now ? clock.set(req.body.now) : clock.reset();
    await tick(db);
    res.json({ now: clock.now().toISOString() });
  });

  router.post('/sync', async (req, res) => {
    await tick(db);
    res.json({ lastSyncError: syncState.lastSyncError });
  });

  return router;
}
