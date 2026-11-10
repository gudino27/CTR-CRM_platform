
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { openDb } from '../../src/db/index.js';
import { postsRouter } from '../../src/routes/posts.js';

// Create an isolated test API and in-memory database.
async function withTestApi(callback) {
  const db = openDb(':memory:');
  const app = express();

  app.use(express.json());
  app.use('/api/posts', postsRouter(db));

  let server;

  try {
    server = await new Promise((resolve) => {
      const instance = app.listen(0, '127.0.0.1', () => {
        resolve(instance);
      });
    });

    const baseUrl =
      `http://127.0.0.1:${server.address().port}/api/posts`;

    await callback(baseUrl);
  } finally {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) =>
          error ? reject(error) : resolve()
        );
      });
    }
    db.close();
  }
}

// TC-074: Retrieve an empty post list
test('TC-074: Retrieve posts from empty database', async () => {
  await withTestApi(async (url) => {
    const response = await fetch(url);
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(data, []);
  });
});

// TC-075: Reject invalid filters
test('TC-075: Reject invalid post filters', async () => {
  await withTestApi(async (url) => {
    const invalidFilters = [
      '?status=invalid',
      '?kind=invalid',
      '?placed=invalid',
    ];

    for (const filter of invalidFilters) {
      const response = await fetch(url + filter);
      assert.equal(response.status, 400);
    }
  });
});

// TC-076: Reject invalid platform
test('TC-076: Reject post with invalid platform', async () => {
  await withTestApi(async (url) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platformId: 999999,
        caption: 'Test post',
        kind: 'library',
      }),
    });

    assert.equal(response.status, 400);

    const result = await response.json();
    assert.match(result.error, /platformId/);
  });
});

// TC-077: Reject editing nonexistent posts
test('TC-077: Reject editing nonexistent post', async () => {
  await withTestApi(async (url) => {
    const response = await fetch(`${url}/999999`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caption: 'Updated caption',
      }),
    });

    assert.equal(response.status, 404);
  });
});

// TC-078: Reject requeuing nonexistent posts
test('TC-078: Reject requeue of nonexistent post', async () => {
  await withTestApi(async (url) => {
    const response = await fetch(
      `${url}/999999/requeue`,
      { method: 'POST' }
    );

    assert.equal(response.status, 404);
  });
});

// TC-079: Reject status updates for unknown posts
test('TC-079: Reject status update for missing post', async () => {
  await withTestApi(async (url) => {
    const response = await fetch(
      `${url}/999999/status`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'posted' }),
      }
    );

    assert.equal(response.status, 404);
  });
});

// TC-080: Reject deleting nonexistent posts
test('TC-080: Reject deleting nonexistent post', async () => {
  await withTestApi(async (url) => {
    const response = await fetch(`${url}/999999`, {
      method: 'DELETE',
    });

    assert.equal(response.status, 404);
  });
});

// TC-081: Retrieve empty dispatch history
test('TC-081: Return empty dispatch history', async () => {
  await withTestApi(async (url) => {
    const response = await fetch(
      `${url}/999999/dispatches`
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
  });
});
