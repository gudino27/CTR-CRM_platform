/**
 * The built-in test endpoint (/api/test-webhook). It stands in for the n8n publish
 * webhook: it records every payload and checks it against the payload contract, so nothing
 * reaches a real platform. Test mode sends here unless TEST_WEBHOOK_URL says otherwise.
 *
 * Permissions: POST needs no sign-in (the dispatcher calls it from inside the server, see
 * isSelfCall in app.js); GET needs any signed-in user.
 */
import { Router } from 'express';
import { payloadProblems } from '../services/dispatch.js';

/**
 * The /api/test-webhook router.
 *
 * Usage:
 *   app.use('/api/test-webhook', testWebhookRouter(db));   (app.js)
 *
 * Takes:
 *   db - the open database
 *
 * Returns:
 *   An Express router with the routes below.
 */
export function testWebhookRouter(db) {
  const router = Router();

  /**
   * POST /api/test-webhook: receives one post the way n8n would.
   *
   * Usage:
   *   POST /api/test-webhook  { ...the dispatcher's payload }
   *
   * Returns:
   *   200 { received: true, problems: [text] } (empty when the payload matches the contract).
   *   The payload and problems are stored in testWebhookReceipt.
   */
  router.post('/', async (req, res) => {
    const problems = payloadProblems(req.body);
    await db.run('INSERT INTO testWebhookReceipt (payload, problems) VALUES (?, ?)',
      [JSON.stringify(req.body ?? null), JSON.stringify(problems)]);
    res.json({ received: true, problems });
  });

  /**
   * GET /api/test-webhook: the last 50 payloads received, newest first.
   *
   * Usage:
   *   GET /api/test-webhook
   *
   * Returns:
   *   200 [{ id, payload, problems, ...the row }] with payload and problems parsed from JSON.
   */
  router.get('/', async (req, res) => {
    const rows = await db.all('SELECT * FROM testWebhookReceipt ORDER BY id DESC LIMIT 50');
    res.json(rows.map((r) => ({ ...r, payload: JSON.parse(r.payload), problems: JSON.parse(r.problems) })));
  });

  return router;
}
