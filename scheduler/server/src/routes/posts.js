import { Router } from 'express';

export function postsRouter(db) {
  const router = Router();

  router.get('/', (req, res) => {
    const { platformId } = req.query;
    const sql = `SELECT * FROM post WHERE status = 'queued' ${platformId ? 'AND platform_id = ?' : ''}
                 ORDER BY platform_id, priority DESC, queue_position`;
    res.json(db.prepare(sql).all(...(platformId ? [platformId] : [])));
  });

  // TODO(Sprint 4): POST / (composer submit -> append to platform queue -> project -> calendar)
  // TODO(Sprint 4): PATCH /:id (edit, priority, reorder, override date), DELETE /:id

  return router;
}
