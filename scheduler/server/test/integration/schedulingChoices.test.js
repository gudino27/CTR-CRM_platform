
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { openDb } from '../../src/db/index.js';
import { platformsRouter } from '../../src/routes/platforms.js';
import {
  setCalendarClient,
  syncPlatform,
} from '../../src/services/sync.js';

// Use a future year so no test slots have passed.
const year = new Date().getUTCFullYear() + 2;
const month = `${year}-01`;

// Create an isolated API and SQLite database.
async function withTestApi(callback) {
  setCalendarClient(null);

  const db = await openDb(':memory:');
  let server;

  try {
    const platform = await db.run(`
      INSERT INTO platform
        (key, name, postingDays, postingTimes, usesColors)
      VALUES (?, ?, ?, ?, ?)
    `, [
      'scheduling-test',
      'Scheduling Test',
      '[]',
      '[]',
      0,
    ]);

    const platformId = platform.lastInsertRowid;

    const type = await db.run(`
      INSERT INTO postType
        (platformId, name, sortOrder, inRotation)
      VALUES (?, ?, ?, ?)
    `, [platformId, 'Newsletter', 1, 1]);

    const rule = await db.run(`
      INSERT INTO scheduleRule
        (platformId, byDay, time, startDate)
      VALUES (?, ?, ?, ?)
    `, [
      platformId,
      'MO',
      '13:00',
      `${month}-01`,
    ]);

    const ruleId = rule.lastInsertRowid;

    const post = await db.run(`
      INSERT INTO post
        (platformId, caption, kind, postTypeId)
      VALUES (?, ?, ?, ?)
    `, [
      platformId,
      'Test scheduled post',
      'library',
      type.lastInsertRowid,
    ]);

    const postId = post.lastInsertRowid;

    // Generate and populate the original schedule.
    await syncPlatform(db, platformId, {
      months: [month],
    });

    const app = express();
    app.use(express.json());

    // Simulate an authorized user for route testing.
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

    const getAssignedSlot = () => db.get(
      'SELECT * FROM slot WHERE postId = ?',
      [postId]
    );

    await callback({
      db,
      baseUrl,
      platformId,
      ruleId,
      postId,
      getAssignedSlot,
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

// Local API request helper.
async function request(baseUrl, path, method, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return {
    status: response.status,
    data: await response.json(),
  };
}

// TC-022: Keep or move existing scheduled posts.
test('TC-022: Posting day changes support keep or move', async () => {
  for (const keepPosts of [true, false]) {
    await withTestApi(async ctx => {
      const original = await ctx.getAssignedSlot();

      assert.ok(original, 'Post should be scheduled');

      // Original posting day is Monday.
      const originalDay = new Date(
        `${original.date}T12:00:00Z`
      ).getUTCDay();

      assert.equal(originalDay, 1);

      // Preview moving Monday posts to Tuesday.
      const preview = await request(
        ctx.baseUrl,
        `/api/platforms/${ctx.platformId}/rules/impact`,
        'POST',
        {
          ruleId: ctx.ruleId,
          rule: { byDay: 'TU' },
        }
      );

      assert.equal(preview.status, 200);
      assert.equal(preview.data.moving, 1);

      // Apply Keep Posts or Move Posts.
      const result = await request(
        ctx.baseUrl,
        `/api/platforms/${ctx.platformId}/rules/${ctx.ruleId}`,
        'PATCH',
        {
          byDay: 'TU',
          keepPosts,
        }
      );

      assert.equal(result.status, 200);

      const updated = await ctx.getAssignedSlot();

      assert.ok(updated, 'Post should remain scheduled');

      if (keepPosts) {
        // Existing post remains on Monday.
        assert.equal(updated.date, original.date);
        assert.equal(updated.time, original.time);
        assert.equal(updated.kept, 1);

      } else {
        // Existing post moves to Tuesday.
        assert.notEqual(updated.date, original.date);

        const updatedDay = new Date(
          `${updated.date}T12:00:00Z`
        ).getUTCDay();

        assert.equal(updatedDay, 2);
      }
    });
  }
});
