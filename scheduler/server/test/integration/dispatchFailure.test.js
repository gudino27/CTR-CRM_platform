
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { openDb } from '../../src/db/index.js';
import { config } from '../../src/config.js';
import { dispatchDue } from '../../src/services/dispatch.js';

// TC-122: Verify webhook failure handling.
test('TC-122: Handle failed webhook publishing', async () => {
  const db = await openDb(':memory:');
  let server;

  const originalTestUrl = config.webhook.testUrl;
  const originalDryRun = config.dryRun;

  try {
    let attempts = 0;

    // Create a local webhook that always fails.
    const app = express();
    app.use(express.json());

    app.post('/publish', (req, res) => {
      attempts++;
      res.status(503).json({
        error: 'Service unavailable',
      });
    });

    server = await new Promise(resolve => {
      const instance = app.listen(
        0,
        '127.0.0.1',
        () => resolve(instance)
      );
    });

    const webhookUrl =
      `http://127.0.0.1:${server.address().port}/publish`;

    // Use the mock webhook instead of n8n.
    config.webhook.testUrl = webhookUrl;
    config.dryRun = false;

    // Create a test platform.
    const platform = await db.run(`
      INSERT INTO platform (key, name, webhookUrl)
      VALUES (?, ?, ?)
    `, [
      'failure-test',
      'Failure Test',
      webhookUrl,
    ]);

    const platformId = platform.lastInsertRowid;

    // Create a post type.
    const type = await db.run(`
      INSERT INTO postType
        (platformId, name, sortOrder, inRotation)
      VALUES (?, 'Newsletter', 1, 1)
    `, [platformId]);

    // Create a post scheduled one minute ago.
    const scheduledAt = new Date(
      Date.now() - 60_000
    ).toISOString();

    const post = await db.run(`
      INSERT INTO post
        (platformId, caption, kind, postTypeId, scheduledAt)
      VALUES (?, ?, 'library', ?, ?)
    `, [
      platformId,
      'Webhook failure test',
      type.lastInsertRowid,
      scheduledAt,
    ]);

    const postId = post.lastInsertRowid;

    // 1. Attempt to publish.
    const count = await dispatchDue(db);

    assert.equal(count, 1);
    assert.equal(attempts, 1);

    // 2. Verify the post is marked failed.
    const updated = await db.get(
      'SELECT * FROM post WHERE id = ?',
      [postId]
    );

    assert.equal(updated.status, 'failed');
    assert.match(
      updated.lastError,
      /Webhook answered HTTP 503/
    );

    // 3. Verify the dispatch history.
    const history = await db.all(
      'SELECT * FROM dispatch WHERE postId = ?',
      [postId]
    );

    assert.equal(history.length, 1);
    assert.equal(history[0].httpStatus, 503);
    assert.equal(history[0].dryRun, 0);

    assert.match(
      history[0].error,
      /Webhook answered HTTP 503/
    );

    assert.equal(history[0].url, webhookUrl);

    // 4. Run the dispatcher again.
    const secondCount = await dispatchDue(db);

    // Failed posts must not retry automatically.
    assert.equal(secondCount, 0);
    assert.equal(attempts, 1);

    const finalHistory = await db.all(
      'SELECT * FROM dispatch WHERE postId = ?',
      [postId]
    );

    assert.equal(finalHistory.length, 1);

    // Post remains failed until manually requeued.
    const finalPost = await db.get(
      'SELECT status FROM post WHERE id = ?',
      [postId]
    );

    assert.equal(finalPost.status, 'failed');

  } finally {
    // Restore original configuration.
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
