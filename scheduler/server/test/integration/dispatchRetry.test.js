
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { openDb } from '../../src/db/index.js';
import { config } from '../../src/config.js';
import { clock } from '../../src/services/clock.js';
import { postsRouter } from '../../src/routes/posts.js';
import { dispatchDue } from '../../src/services/dispatch.js';
import {
  setCalendarClient,
  syncPlatform,
} from '../../src/services/sync.js';

// TC-127: Failed posts require manual requeue before retry.
test('TC-127: Requeue and successfully retry a failed post', async () => {
  const db = await openDb(':memory:');
  let server;

  const originalTestUrl = config.webhook.testUrl;
  const originalDryRun = config.dryRun;

  setCalendarClient(null);

  try {
    const year = new Date().getUTCFullYear() + 2;
    const month = `${year}-01`;

    clock.set(`${month}-01T12:00:00Z`);

    let attempts = 0;

    // Mock webhook: first attempt fails, second succeeds.
    const app = express();
    app.use(express.json());

    app.post('/publish', (req, res) => {
      attempts++;

      if (attempts === 1) {
        return res.status(503).json({
          error: 'Service unavailable',
        });
      }

      res.status(200).json({
        accepted: true,
      });
    });

    // Simulate an authorized user for the requeue API.
    app.use((req, res, next) => {
      req.user = {
        role: 'superAdmin',
        active: 1,
      };
      next();
    });

    app.use('/api/posts', postsRouter(db));

    server = await new Promise(resolve => {
      const instance = app.listen(
        0,
        '127.0.0.1',
        () => resolve(instance)
      );
    });

    const baseUrl =
      `http://127.0.0.1:${server.address().port}`;

    config.webhook.testUrl = `${baseUrl}/publish`;
    config.dryRun = false;

    // Create a test platform.
    const platform = await db.run(`
      INSERT INTO platform (key, name, usesColors)
      VALUES (?, ?, 0)
    `, ['retry-test', 'Retry Test']);

    const platformId = platform.lastInsertRowid;

    // Create a post type.
    const type = await db.run(`
      INSERT INTO postType
        (platformId, name, sortOrder, inRotation)
      VALUES (?, 'Newsletter', 1, 1)
    `, [platformId]);

    // Schedule posts every Monday.
    await db.run(`
      INSERT INTO scheduleRule
        (platformId, byDay, time, startDate)
      VALUES (?, 'MO', '13:00', ?)
    `, [platformId, `${month}-01`]);

    // Create a library post.
    const post = await db.run(`
      INSERT INTO post
        (platformId, caption, kind, postTypeId)
      VALUES (?, ?, 'library', ?)
    `, [
      platformId,
      'Webhook retry test',
      type.lastInsertRowid,
    ]);

    const postId = post.lastInsertRowid;

    const getPost = () => db.get(
      'SELECT * FROM post WHERE id = ?',
      [postId]
    );

    const getSlot = () => db.get(
      'SELECT * FROM slot WHERE postId = ?',
      [postId]
    );

    // Generate the initial schedule.
    await syncPlatform(db, platformId, {
      months: [month],
    });

    const originalSlot = await getSlot();

    assert.ok(originalSlot);

    // Move the simulated clock past the first posting time.
    clock.set(
      new Date(
        Date.parse(originalSlot.scheduledAt) + 1000
      ).toISOString()
    );

    // 1. First publishing attempt fails.
    assert.equal(await dispatchDue(db), 1);
    assert.equal(attempts, 1);

    const failedPost = await getPost();

    assert.equal(failedPost.status, 'failed');
    assert.match(failedPost.lastError, /HTTP 503/);

    // 2. Failed posts must not retry automatically.
    assert.equal(await dispatchDue(db), 0);
    assert.equal(attempts, 1);

    // 3. Manually requeue the failed post.
    const response = await fetch(
      `${baseUrl}/api/posts/${postId}/requeue`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }
    );

    assert.equal(response.status, 200);

    const requeuedPost = await response.json();

    assert.equal(requeuedPost.status, 'queued');
    assert.equal(requeuedPost.lastError, null);

    // The post should receive a new future slot.
    const newSlot = await getSlot();

    assert.ok(newSlot);
    assert.ok(newSlot.date > originalSlot.date);
    assert.ok(
      newSlot.scheduledAt > clock.now().toISOString()
    );

    // It should not publish before the new scheduled time.
    assert.equal(await dispatchDue(db), 0);
    assert.equal(attempts, 1);

    // 4. Advance to the new posting time.
    clock.set(
      new Date(
        Date.parse(newSlot.scheduledAt) + 1000
      ).toISOString()
    );

    // Second publishing attempt succeeds.
    assert.equal(await dispatchDue(db), 1);
    assert.equal(attempts, 2);

    const published = await getPost();

    assert.equal(published.status, 'posted');
    assert.equal(published.lastError, null);
    assert.ok(published.sentAt);

    // 5. Verify both attempts were recorded.
    const history = await db.all(`
      SELECT * FROM dispatch
      WHERE postId = ?
      ORDER BY id
    `, [postId]);

    assert.equal(history.length, 2);
    assert.equal(history[0].httpStatus, 503);
    assert.equal(history[1].httpStatus, 200);

    // 6. A published post must never be sent again.
    assert.equal(await dispatchDue(db), 0);
    assert.equal(attempts, 2);

  } finally {
    clock.reset();
    setCalendarClient(null);

    config.webhook.testUrl = originalTestUrl;
    config.dryRun = originalDryRun;

    if (server) {
      await new Promise((resolve, reject) => {
        server.close(error =>
          error ? reject(error) : resolve()
        );
      });
    }

    await db.close();
  }
});
