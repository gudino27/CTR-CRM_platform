
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { openDb } from '../../src/db/index.js';
import { postsRouter } from '../../src/routes/posts.js';
import { setCalendarClient } from '../../src/services/sync.js';

// Create an isolated database and local test server.
async function withTestApi(callback) {
  setCalendarClient(null);

  const db = openDb(':memory:');
  let server;

  try {
    const platformId = Number(db.prepare(`
      INSERT INTO platform
        (key, name, postingDays, postingTimes, usesColors)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'instagram',
      'Instagram',
      '["MON","FRI"]',
      '["13:00"]',
      1
    ).lastInsertRowid);

    const postTypeId = Number(db.prepare(`
      INSERT INTO postType
        (platformId, name, sortOrder, inRotation)
      VALUES (?, ?, ?, ?)
    `).run(
      platformId, 'Newsletter', 1, 1
    ).lastInsertRowid);

    const mediaId = Number(db.prepare(`
      INSERT INTO media (name, mimeType, link)
      VALUES (?, ?, ?)
    `).run(
      'test-image.jpg',
      'image/jpeg',
      '/media/test-image.jpg'
    ).lastInsertRowid);

    const app = express();
    app.use(express.json());
    app.use('/api/posts', postsRouter(db));

    server = await new Promise(resolve => {
      const instance = app.listen(0, '127.0.0.1', () => {
        resolve(instance);
      });
    });

    const url =
      `http://127.0.0.1:${server.address().port}/api/posts`;

    await callback({
      db, url, platformId, postTypeId, mediaId
    });

  } finally {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close(error =>
          error ? reject(error) : resolve()
        );
      });
    }
    db.close();
  }
}

// Send a local API request.
async function request(url, method = 'GET', body) {
  const response = await fetch(url, {
    method,
    ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });

  return {
    status: response.status,
    data: response.status === 204
      ? null
      : await response.json(),
  };
}

// Create a valid library post.
async function createLibrary(ctx) {
  const result = await request(ctx.url, 'POST', {
    platformId: ctx.platformId,
    caption: 'Test newsletter post',
    kind: 'library',
    postTypeId: ctx.postTypeId,
    color: 'Blue',
    mediaId: ctx.mediaId,
  });

  assert.equal(result.status, 201);
  return result.data;
}

// Create a valid Specific Date post.
async function createFixed(ctx, fixedAt) {
  return request(ctx.url, 'POST', {
    platformId: ctx.platformId,
    caption: 'Scheduled announcement',
    kind: 'fixed',
    fixedAt,
    mediaId: ctx.mediaId,
  });
}

// TC-082
test('TC-082: Create valid library post', async () => {
  await withTestApi(async ctx => {
    const post = await createLibrary(ctx);

    assert.ok(post.id);
    assert.equal(post.caption, 'Test newsletter post');
    assert.equal(post.kind, 'library');
    assert.equal(post.status, 'queued');
    assert.equal(post.color, 'Blue');
  });
});

// TC-083
test('TC-083: Save and retrieve post', async () => {
  await withTestApi(async ctx => {
    const post = await createLibrary(ctx);

    const saved = ctx.db.prepare(
      'SELECT * FROM post WHERE id = ?'
    ).get(post.id);

    assert.equal(saved.caption, post.caption);
    assert.equal(saved.platformId, ctx.platformId);

    const result = await request(ctx.url);

    assert.equal(result.status, 200);
    assert.ok(result.data.some(p => p.id === post.id));
  });
});

// TC-084
test('TC-084: Edit queued post', async () => {
  await withTestApi(async ctx => {
    const post = await createLibrary(ctx);

    const result = await request(
      `${ctx.url}/${post.id}`,
      'PATCH',
      { caption: 'Updated newsletter caption' }
    );

    assert.equal(result.status, 200);
    assert.equal(
      result.data.caption,
      'Updated newsletter caption'
    );
  });
});

// TC-085
test('TC-085: Prevent editing published post', async () => {
  await withTestApi(async ctx => {
    const post = await createLibrary(ctx);

    ctx.db.prepare(
      "UPDATE post SET status = 'posted' WHERE id = ?"
    ).run(post.id);

    const result = await request(
      `${ctx.url}/${post.id}`,
      'PATCH',
      { caption: 'Unauthorized edit' }
    );

    assert.equal(result.status, 409);
  });
});

// TC-086
test('TC-086: Create Specific Date post', async () => {
  await withTestApi(async ctx => {
    const result = await createFixed(
      ctx, '2099-11-09T13:00'
    );

    assert.equal(result.status, 201);
    assert.equal(result.data.kind, 'fixed');
    assert.equal(
      result.data.fixedAt,
      '2099-11-09T13:00'
    );
    assert.ok(result.data.scheduledAt);
  });
});

// TC-087
test('TC-087: Detect scheduling conflict', async () => {
  await withTestApi(async ctx => {
    const first = await createFixed(
      ctx, '2099-11-09T13:00'
    );

    assert.equal(first.status, 201);

    const second = await createFixed(
      ctx, '2099-11-09T14:00'
    );

    assert.equal(second.status, 409);
    assert.ok(second.data.suggestedAt);
  });
});

// TC-088
test('TC-088: Requeue failed library post', async () => {
  await withTestApi(async ctx => {
    const post = await createLibrary(ctx);

    ctx.db.prepare(`
      UPDATE post
      SET status = 'failed',
          lastError = 'Simulated failure'
      WHERE id = ?
    `).run(post.id);

    const result = await request(
      `${ctx.url}/${post.id}/requeue`,
      'POST',
      {}
    );

    assert.equal(result.status, 200);
    assert.equal(result.data.status, 'queued');
    assert.equal(result.data.lastError, null);
  });
});

// TC-089
test('TC-089: Update post publishing status', async () => {
  await withTestApi(async ctx => {
    const post = await createLibrary(ctx);

    ctx.db.prepare(
      "UPDATE post SET status = 'sending' WHERE id = ?"
    ).run(post.id);

    const result = await request(
      `${ctx.url}/${post.id}/status`,
      'POST',
      {
        status: 'posted',
        platformPostId: 'test-platform-123',
      }
    );

    assert.equal(result.status, 200);
    assert.equal(result.data.status, 'posted');
    assert.equal(
      result.data.platformPostId,
      'test-platform-123'
    );
  });
});

// TC-090
test('TC-090: Delete queued post', async () => {
  await withTestApi(async ctx => {
    const post = await createLibrary(ctx);

    const result = await request(
      `${ctx.url}/${post.id}`,
      'DELETE'
    );

    assert.equal(result.status, 204);

    const saved = ctx.db.prepare(
      'SELECT * FROM post WHERE id = ?'
    ).get(post.id);

    assert.equal(saved, undefined);
  });
});
