import { Router } from 'express';

export function platformsRouter(db) {
  const router = Router();

  router.get('/', (req, res) => {
    const rows = db.prepare('SELECT * FROM platform ORDER BY sort_order').all();
    res.json(rows.map((p) => ({ ...p, posting_days: JSON.parse(p.posting_days), posting_times: JSON.parse(p.posting_times) })));
  });

  // TODO(Sprint 4): PATCH /:id for cadence, color, priority settings -> recalculate projection

  return router;
}
