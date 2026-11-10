
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { openDb } from '../../src/db/index.js';
import { config } from '../../src/config.js';
import {
  dispatchDue,
  payloadProblems,
} from '../../src/services/dispatch.js';

// TC-121: Verify successful webhook dispatch.
test('TC-121: Publish a due post only once', async () => {
  const db = await openDb(':memory:');

  let server;

  // Save existing settings to restore after testing.
  const originalTestUrl = config.webhook.testUrl;
  const originalDryRun = config.dryRun;

  try {
    const received = [];

    // Create a local mock webhook.
    const app = express();
    app.use(express.json());

    app.post('/publish', (req, res) => {
      received.push(req.body);
      res.status(200).json({ accepted: true });
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

    // All publishing goes to our local mock server.
    config.webhook.testUrl = webhookUrl;
    config.dryRun = false;

    // Create a test platform.
    const platform = await db.run(`
      INSERT INTO platform (key, name, webhookUrl)
      VALUES (?, ?, ?)
    `, [
      'dispatch-test',
      'Dispatch Test',
      webhookUrl,
    ]);

    const platformId = platform.lastInsertRowid;

    // Create a post type.
    const type = await db.run(`
      INSERT INTO postType
        (platformId, name, sortOrder, inRotation)
      VALUES (?, ?, 1, 1)
    `, [platformId, 'Newsletter']);

    // The post became due one minute ago.
    const scheduledAt = new Date(
      Date.now() - 60_000
    ).toISOString();

    const post = await db.run(`
      INSERT INTO post
        (platformId, caption, hashtags, kind,
         postTypeId, scheduledAt)
      VALUES (?, ?, ?, 'library', ?, ?)
    `, [
      platformId,
      'Test webhook publishing',
      '#CTR',
      type.lastInsertRowid,
      scheduledAt,
    ]);

    const postId = post.lastInsertRowid;

    // 1. Dispatch the due post.
    const count = await dispatchDue(db);

    assert.equal(count, 1);
    assert.equal(received.length, 1);

    // 2. Verify the webhook received valid data.
    const payload = received[0];

    assert.deepEqual(payloadProblems(payload), []);

    assert.equal(payload.postId, String(postId));
    assert.equal(payload.platform, 'dispatch-test');
    assert.equal(payload.caption, 'Test webhook publishing\n\n#CTR');
    assert.equal(payload.kind, 'library');
    assert.equal(payload.postType, 'Newsletter');

    // 3. Verify the post status.
    const updated = await db.get(
      'SELECT * FROM post WHERE id = ?',
      [postId]
    );

    assert.equal(updated.status, 'posted');
    assert.ok(updated.sentAt);
    assert.equal(updated.lastError, null);

    // 4. Verify the dispatch history.
    const history = await db.all(
      'SELECT * FROM dispatch WHERE postId = ?',
      [postId]
    );

    assert.equal(history.length, 1);
    assert.equal(history[0].httpStatus, 200);
    assert.equal(history[0].dryRun, 0);
    assert.equal(history[0].error, null);
    assert.equal(history[0].url, webhookUrl);

    assert.deepEqual(
      JSON.parse(history[0].payload),
      payload
    );

    // 5. Dispatch again.
    const secondCount = await dispatchDue(db);

    assert.equal(secondCount, 0);

    // The same post must not be published twice.
    assert.equal(received.length, 1);

    const finalHistory = await db.all(
      'SELECT * FROM dispatch WHERE postId = ?',
      [postId]
    );

    assert.equal(finalHistory.length, 1);

  } finally {
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
