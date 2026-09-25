import { Router } from 'express';
import { config } from '../config.js';
import { clock } from '../services/clock.js';

export function systemRouter() {
  const router = Router();

  router.get('/health', (req, res) => res.json({ ok: true }));

  router.get('/status', (req, res) =>
    res.json({ testMode: config.testMode, now: clock.now().toISOString(), timezone: config.timezone }));

  router.post('/clock', (req, res) => {
    if (!config.testMode) return res.status(403).json({ error: 'Test mode is off' });
    req.body?.now ? clock.set(req.body.now) : clock.reset();
    res.json({ now: clock.now().toISOString() });
  });

  return router;
}
