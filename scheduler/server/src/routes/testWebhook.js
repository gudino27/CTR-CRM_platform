import { Router } from 'express';
import { payloadProblems } from '../services/dispatch.js';

// Stands in for the client's n8n publish webhook: records every payload and
// checks it against the agreed contract, so nothing reaches a real platform.
export function testWebhookRouter(db) {
  const router = Router();

  router.post('/', (req, res) => {
    const problems = payloadProblems(req.body);
    db.prepare('INSERT INTO testWebhookReceipt (payload, problems) VALUES (?, ?)')
      .run(JSON.stringify(req.body ?? null), JSON.stringify(problems));
    res.json({ received: true, problems });
  });

  router.get('/', (req, res) => {
    const rows = db.prepare('SELECT * FROM testWebhookReceipt ORDER BY id DESC LIMIT 50').all();
    res.json(rows.map((r) => ({ ...r, payload: JSON.parse(r.payload), problems: JSON.parse(r.problems) })));
  });

  return router;
}
