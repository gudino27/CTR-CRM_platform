
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { openDb } from '../../src/db/index.js';
import { postsRouter } from '../../src/routes/posts.js';
import { setCalendarClient } from '../../src/services/sync.js';

// Create an isolated database and local test server.
async function withTestApi(callback) {
  setCalendarClient(null);

  const db = await openDb(':memory:');
  let server;

  try {
    // Create a test platform.
    const platformResult = await db.run(`
      INSERT INTO platform
        (key, name, postingDays, postingTimes, usesColors)
      VALUES (?, ?, ?, ?, ?)
    `, [
      'instagram',
      'Instagram',
      '["MON","FRI"]',
      '["13:00"]',
      1,
    ]);

    const platformId = platformResult.lastInsertRowid;

    // Create a test post type.
    const postTypeResult = await db.run(`
      INSERT INTO postType
        (platformId, name, sortOrder, inRotation)
      VALUES (?, ?, ?, ?)
    `, [
      platformId,
      'Newsletter',
      1,
      1,
    ]);

    const postTypeId = postTypeResult.lastInsertRowid;

    // Current scheduling uses scheduleRule records.
    await db.run(`
      INSERT INTO scheduleRule
        (platformId, label, byDay, time, startDate)
      VALUES (?, ?, ?, ?, ?)
    `, [
      platformId,
      'Test Weekly Schedule',
      'MO,FR',
      '13:00',
      '2026-01-01',
    ]);

    // Create a valid test image record.
    const mediaResult = await db.run(`
      INSERT INTO media
        (name, mimeType, link)
      VALUES (?, ?, ?)
    `, [
      'test-image.jpg',
      'image/jpeg',
      '/media/test-image.jpg',
    ]);

    const mediaId = mediaResult.lastInsertRowid;

    const app = express();
    app.use(express.json());

    // Simulate an authorized user for route-level tests.
    // Authentication middleware is tested separately.
    app.use((req, res, next) => {
      req.user = {
        id: 1,
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

    const url =
      `http://127.0.0.1:${server.address().port}/api/posts`;

    await callback({
      db,
      url,
      platformId,
      postTypeId,
      mediaId,
    });

  } finally {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close(error =>
          error ? reject(error) : resolve()
        );
      });
    }

    await db.close();
  }
}

// Send a request to the local test API.
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

// TC-082: Create valid library post.
test('TC-082: Create valid library post', async () => {
  await withTestApi(async ctx => {
    const post = await createLibrary(ctx);

    assert.ok(post.id);
    assert.equal(post.caption, 'Test newsletter post');
    assert.equal(post.kind, 'library');
    assert.equal(post.status, 'queued');
    assert.equal(post.color, 'Blue');
    assert.equal(post.mediaId, ctx.mediaId);
  });
});

// TC-083: Save and retrieve post.
test('TC-083: Save and retrieve post', async () => {
  await withTestApi(async ctx => {
    const post = await createLibrary(ctx);

    const saved = await ctx.db.get(
      'SELECT * FROM post WHERE id = ?',
      [post.id]
    );

    assert.equal(saved.caption, post.caption);
    assert.equal(saved.platformId, ctx.platformId);

    const result = await request(ctx.url);

    assert.equal(result.status, 200);
    assert.ok(
      result.data.some(p => p.id === post.id)
    );
  });
});

// TC-084: Edit queued post.
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

// TC-085: Prevent editing published post.
test('TC-085: Prevent editing published post', async () => {
  await withTestApi(async ctx => {
    const post = await createLibrary(ctx);

    await ctx.db.run(
      "UPDATE post SET status = 'posted' WHERE id = ?",
      [post.id]
    );

    const result = await request(
      `${ctx.url}/${post.id}`,
      'PATCH',
      { caption: 'Unauthorized edit' }
    );

    assert.equal(result.status, 409);
  });
});

// TC-086: Create Specific Date post.
test('TC-086: Create Specific Date post', async () => {
  await withTestApi(async ctx => {
    const result = await createFixed(
      ctx,
      '2099-11-09T13:00'
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

// TC-087: Detect scheduling conflict.
test('TC-087: Detect scheduling conflict', async () => {
  await withTestApi(async ctx => {
    const first = await createFixed(
      ctx,
      '2099-11-09T13:00'
    );

    assert.equal(first.status, 201);

    const second = await createFixed(
      ctx,
      '2099-11-09T14:00'
    );

    assert.equal(second.status, 409);
    assert.ok(second.data.suggestedAt);
  });
});

// TC-088: Requeue failed library post.
test('TC-088: Requeue failed library post', async () => {
  await withTestApi(async ctx => {
    const post = await createLibrary(ctx);

    await ctx.db.run(`
      UPDATE post
      SET status = 'failed',
          lastError = 'Simulated failure'
      WHERE id = ?
    `, [post.id]);

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

// TC-089: Update post publishing status.
test('TC-089: Update post publishing status', async () => {
  await withTestApi(async ctx => {
    const post = await createLibrary(ctx);

    await ctx.db.run(
      "UPDATE post SET status = 'sending' WHERE id = ?",
      [post.id]
    );

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

// TC-090: Delete queued post.
test('TC-090: Delete queued post', async () => {
  await withTestApi(async ctx => {
    const post = await createLibrary(ctx);

    const result = await request(
      `${ctx.url}/${post.id}`,
      'DELETE'
    );

    assert.equal(result.status, 204);

    const saved = await ctx.db.get(
      'SELECT * FROM post WHERE id = ?',
      [post.id]
    );

    assert.equal(saved, undefined);
  });
});
