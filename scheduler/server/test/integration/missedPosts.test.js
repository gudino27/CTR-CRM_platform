
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { openDb } from '../../src/db/index.js';
import { platformsRouter } from '../../src/routes/platforms.js';
import { clock } from '../../src/services/clock.js';
import {
  setCalendarClient,
  syncPlatform,
} from '../../src/services/sync.js';

// TC-119: Handle posts missed while a platform was paused.
test('TC-119: Resolve missed posts after a pause', async () => {
  setCalendarClient(null);

  const db = await openDb(':memory:');
  let server;

  try {
    // Move the test clock to a future January.
    const year = new Date().getUTCFullYear() + 2;
    const month = `${year}-01`;

    clock.set(`${month}-01T12:00:00Z`);

    const platform = await db.run(`
      INSERT INTO platform (key, name, usesColors)
      VALUES (?, ?, 0)
    `, ['missed-test', 'Missed Test']);

    const platformId = platform.lastInsertRowid;

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

    // Create three library posts.
    for (let i = 1; i <= 3; i++) {
      await db.run(`
        INSERT INTO post
          (platformId, caption, kind, postTypeId)
        VALUES (?, ?, 'library', ?)
      `, [
        platformId,
        `Missed post ${i}`,
        type.lastInsertRowid,
      ]);
    }

    await syncPlatform(db, platformId, {
      months: [month],
    });

    const scheduled = await db.all(`
      SELECT post.id, slot.date, slot.scheduledAt
      FROM post
      JOIN slot ON slot.postId = post.id
      WHERE post.platformId = ?
      ORDER BY slot.scheduledAt
    `, [platformId]);

    assert.equal(scheduled.length, 3);

    // Start isolated API server.
    const app = express();
    app.use(express.json());

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

    async function request(path, method = 'GET', body) {
      const response = await fetch(`${baseUrl}${path}`, {
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

    // 1. Pause the platform.
    const paused = await request(
      `/api/platforms/${platformId}`,
      'PATCH',
      { paused: true }
    );

    assert.equal(paused.status, 200);
    assert.equal(paused.data.paused, true);

    // 2. Advance the clock beyond all three posting times.
    const lastSlot = scheduled.at(-1);

    clock.set(
      new Date(
        Date.parse(lastSlot.scheduledAt) + 60_000
      ).toISOString()
    );

    // The three posts should appear as missed.
    const missed = await request(
      `/api/platforms/${platformId}/missed`
    );

    assert.equal(missed.status, 200);
    assert.equal(missed.data.length, 3);

    assert.deepEqual(
      missed.data.map(p => p.id).sort((a, b) => a - b),
      scheduled.map(p => p.id).sort((a, b) => a - b)
    );

    const [returnPost, datePost, skipPost] = scheduled;

    // Choose a specific future date for the second post.
    const future = new Date(
      `${lastSlot.date}T12:00:00Z`
    );

    future.setUTCDate(future.getUTCDate() + 28);

    const fixedAt =
      `${future.toISOString().slice(0, 10)}T13:00`;

    // 3. Resume and apply all three choices.
    const resumed = await request(
      `/api/platforms/${platformId}/resume`,
      'POST',
      {
        choices: [
          {
            postId: returnPost.id,
            action: 'library',
          },
          {
            postId: datePost.id,
            action: 'date',
            fixedAt,
          },
          {
            postId: skipPost.id,
            action: 'skip',
          },
        ],
      }
    );

    assert.equal(resumed.status, 200);
    assert.equal(resumed.data.paused, false);

    // 4. Return to Library: post gets a new future slot.
    const returned = await db.get(
      'SELECT * FROM post WHERE id = ?',
      [returnPost.id]
    );

    const newSlot = await db.get(
      'SELECT * FROM slot WHERE postId = ?',
      [returnPost.id]
    );

    assert.equal(returned.kind, 'library');
    assert.equal(returned.status, 'queued');
    assert.ok(newSlot);
    assert.ok(newSlot.scheduledAt > clock.now().toISOString());
    assert.ok(newSlot.date > returnPost.date);

    // 5. Choose New Date: post becomes fixed.
    const dated = await db.get(
      'SELECT * FROM post WHERE id = ?',
      [datePost.id]
    );

    assert.equal(dated.kind, 'fixed');
    assert.equal(dated.fixedAt, fixedAt);
    assert.equal(dated.status, 'queued');
    assert.ok(dated.scheduledAt > clock.now().toISOString());

    // 6. Skip: post is marked failed.
    const skipped = await db.get(
      'SELECT * FROM post WHERE id = ?',
      [skipPost.id]
    );

    assert.equal(skipped.status, 'failed');
    assert.equal(skipped.lastError, 'Skipped after pause');
    assert.equal(skipped.scheduledAt, null);

    // 7. Resumed platform has no unresolved missed posts.
    const remaining = await request(
      `/api/platforms/${platformId}/missed`
    );

    assert.equal(remaining.status, 200);
    assert.deepEqual(remaining.data, []);

  } finally {
    clock.reset();

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
