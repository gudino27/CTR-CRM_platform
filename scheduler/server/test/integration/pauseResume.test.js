
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { openDb } from '../../src/db/index.js';
import { platformsRouter } from '../../src/routes/platforms.js';
import {
  setCalendarClient,
  syncPlatform,
} from '../../src/services/sync.js';

// TC-118: Pause and resume platform scheduling.
test('TC-118: Pause and resume scheduling', async () => {
  setCalendarClient(null);

  const db = await openDb(':memory:');
  let server;

  try {
    // Choose next month so every slot is in the future.
    const now = new Date();

    const nextMonth = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() + 1,
      1
    ));

    const month = nextMonth.toISOString().slice(0, 7);

    // Create test platform.
    const platform = await db.run(`
      INSERT INTO platform (key, name, usesColors)
      VALUES (?, ?, ?)
    `, ['pause-test', 'Pause Test', 0]);

    const platformId = platform.lastInsertRowid;

    // Create one post type.
    const type = await db.run(`
      INSERT INTO postType
        (platformId, name, sortOrder, inRotation)
      VALUES (?, ?, 1, 1)
    `, [platformId, 'Newsletter']);

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
      'Pause and resume test',
      type.lastInsertRowid,
    ]);

    const postId = post.lastInsertRowid;

    // Generate the original schedule.
    await syncPlatform(db, platformId, {
      months: [month],
    });

    const getPost = () => db.get(
      'SELECT * FROM post WHERE id = ?',
      [postId]
    );

    const getAssignedSlot = () => db.get(
      'SELECT * FROM slot WHERE postId = ?',
      [postId]
    );

    const originalPost = await getPost();
    const originalSlot = await getAssignedSlot();

    assert.ok(originalPost.scheduledAt);
    assert.ok(originalSlot);

    // Start isolated API server.
    const app = express();
    app.use(express.json());

    // Authentication is tested separately.
    app.use((req, res, next) => {
      req.user = {
        role: 'superAdmin',
        active: 1,
      };
      next();
    });

    app.use('/api/platforms', platformsRouter(db));

    server = await new Promise(resolve => {
      const instance = app.listen(
        0,
        '127.0.0.1',
        () => resolve(instance)
      );
    });

    const baseUrl =
      `http://127.0.0.1:${server.address().port}`;

    async function request(path, method, body) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        ...(body === undefined ? {} : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      });

      return {
        status: response.status,
        data: await response.json(),
      };
    }

    // 1. Pause the platform.
    const paused = await request(
      `/api/platforms/${platformId}`,
      'PATCH',
      { paused: true }
    );

    assert.equal(paused.status, 200);
    assert.equal(paused.data.paused, true);

    // 2. Publishing time must be cleared.
    const pausedPost = await getPost();

    assert.equal(pausedPost.scheduledAt, null);
    assert.equal(pausedPost.status, 'queued');

    // The existing slot assignment must remain.
    const pausedSlot = await getAssignedSlot();

    assert.ok(pausedSlot);
    assert.equal(pausedSlot.id, originalSlot.id);
    assert.equal(pausedSlot.date, originalSlot.date);

    // No posts have been missed yet.
    const missed = await request(
      `/api/platforms/${platformId}/missed`,
      'GET'
    );

    assert.equal(missed.status, 200);
    assert.deepEqual(missed.data, []);

    // 3. Resume scheduling.
    const resumed = await request(
      `/api/platforms/${platformId}/resume`,
      'POST',
      { choices: [] }
    );

    assert.equal(resumed.status, 200);
    assert.equal(resumed.data.paused, false);

    // Original scheduled time must be restored.
    const resumedPost = await getPost();
    const resumedSlot = await getAssignedSlot();

    assert.equal(
      resumedPost.scheduledAt,
      originalPost.scheduledAt
    );

    assert.equal(
      resumedSlot.id,
      originalSlot.id
    );

    assert.equal(resumedPost.status, 'queued');

    // 4. Cannot resume an active platform again.
    const duplicateResume = await request(
      `/api/platforms/${platformId}/resume`,
      'POST',
      { choices: [] }
    );

    assert.equal(duplicateResume.status, 409);

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
});
