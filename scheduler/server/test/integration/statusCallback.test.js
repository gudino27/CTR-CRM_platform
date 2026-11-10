
import test from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../../src/db/index.js';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';

// TC-123: Verify publishing status callbacks from n8n.
test('TC-123: Handle publishing status callbacks', async () => {
  const db = await openDb(':memory:');
  let server;

  const originalSecret = config.n8nCallbackSecret;
  const testSecret = 'test-callback-secret-123';

  try {
    // Require a callback secret for all unsigned requests.
    config.n8nCallbackSecret = testSecret;

    const platform = await db.run(`
      INSERT INTO platform (key, name)
      VALUES (?, ?)
    `, ['callback-test', 'Callback Test']);

    const platformId = platform.lastInsertRowid;

    // Create posts in different states.
    async function createPost(status) {
      const result = await db.run(`
        INSERT INTO post (platformId, caption, status)
        VALUES (?, ?, ?)
      `, [
        platformId,
        `Callback test: ${status}`,
        status,
      ]);

      return result.lastInsertRowid;
    }

    const successId = await createPost('sending');
    const failureId = await createPost('sending');
    const queuedId = await createPost('queued');

    // Start the actual API with authentication middleware.
    const app = await createApp(db);

    server = await new Promise(resolve => {
      const instance = app.listen(
        0,
        '127.0.0.1',
        () => resolve(instance)
      );
    });

    const baseUrl =
      `http://127.0.0.1:${server.address().port}`;

    async function callback(postId, body, secret) {
      const response = await fetch(
        `${baseUrl}/api/posts/${postId}/status`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(secret === undefined
              ? {}
              : { 'X-Callback-Secret': secret }),
          },
          body: JSON.stringify(body),
        }
      );

      return {
        status: response.status,
        data: await response.json(),
      };
    }

    const successBody = {
      status: 'posted',
      platformPostId: 'social-post-123',
    };

    // 1. Reject a missing callback secret.
    const missingSecret = await callback(
      successId,
      successBody
    );

    assert.equal(missingSecret.status, 401);

    // 2. Reject an incorrect callback secret.
    const wrongSecret = await callback(
      successId,
      successBody,
      'incorrect-secret'
    );

    assert.equal(wrongSecret.status, 401);

    // Authentication failures must not update the post.
    const unchanged = await db.get(
      'SELECT status FROM post WHERE id = ?',
      [successId]
    );

    assert.equal(unchanged.status, 'sending');

    // 3. Accept a successful publishing callback.
    const success = await callback(
      successId,
      successBody,
      testSecret
    );

    assert.equal(success.status, 200);
    assert.equal(success.data.status, 'posted');
    assert.equal(
      success.data.platformPostId,
      'social-post-123'
    );

    const publishedPost = await db.get(
      'SELECT * FROM post WHERE id = ?',
      [successId]
    );

    assert.equal(publishedPost.status, 'posted');
    assert.equal(
      publishedPost.platformPostId,
      'social-post-123'
    );
    assert.equal(publishedPost.lastError, null);

    // 4. Accept a failed publishing callback.
    const failure = await callback(
      failureId,
      {
        status: 'failed',
        error: 'Social platform rejected the post',
      },
      testSecret
    );

    assert.equal(failure.status, 200);
    assert.equal(failure.data.status, 'failed');

    const failedPost = await db.get(
      'SELECT * FROM post WHERE id = ?',
      [failureId]
    );

    assert.equal(failedPost.status, 'failed');
    assert.equal(
      failedPost.lastError,
      'Social platform rejected the post'
    );

    // 5. Reject invalid publishing statuses.
    const invalid = await callback(
      successId,
      { status: 'unknown' },
      testSecret
    );

    assert.equal(invalid.status, 400);

    // 6. Reject callbacks for posts not yet sent.
    const premature = await callback(
      queuedId,
      { status: 'posted' },
      testSecret
    );

    assert.equal(premature.status, 409);

    const queuedPost = await db.get(
      'SELECT status FROM post WHERE id = ?',
      [queuedId]
    );

    assert.equal(queuedPost.status, 'queued');

    // 7. Reject callbacks for nonexistent posts.
    const nonexistent = await callback(
      999999,
      { status: 'posted' },
      testSecret
    );

    assert.equal(nonexistent.status, 404);

  } finally {
    config.n8nCallbackSecret = originalSecret;

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
