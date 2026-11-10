
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { openDb } from '../../src/db/index.js';
import { blackoutsRouter } from '../../src/routes/blackouts.js';
import {
  setCalendarClient,
  syncPlatform,
} from '../../src/services/sync.js';

// TC-117: Verify blackout scheduling behavior.
test('TC-117: Blackout dates prevent regular posting', async () => {
  setCalendarClient(null);

  const db = await openDb(':memory:');
  let server;

  try {
    // Use next month to keep all scheduled dates in the future.
    const now = new Date();
    const nextMonth = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() + 1,
      1
    ));

    const month = nextMonth.toISOString().slice(0, 7);

    // Create a test platform.
    const platform = await db.run(`
      INSERT INTO platform (key, name, usesColors)
      VALUES (?, ?, ?)
    `, ['blackout-test', 'Blackout Test', 0]);

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

    // Create one library post.
    const post = await db.run(`
      INSERT INTO post
        (platformId, caption, kind, postTypeId)
      VALUES (?, ?, 'library', ?)
    `, [
      platformId,
      'Blackout scheduling test',
      type.lastInsertRowid,
    ]);

    const postId = post.lastInsertRowid;

    // Generate the original posting schedule.
    await syncPlatform(db, platformId, {
      months: [month],
    });

    const getAssignedSlot = () => db.get(
      'SELECT * FROM slot WHERE postId = ?',
      [postId]
    );

    const original = await getAssignedSlot();

    assert.ok(original, 'Post should initially be scheduled');

    // Confirm original date is Monday.
    assert.equal(
      new Date(`${original.date}T12:00:00Z`).getUTCDay(),
      1
    );

    // Start an isolated API server.
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

    app.use('/api/blackouts', blackoutsRouter(db));

    server = await new Promise(resolve => {
      const instance = app.listen(
        0,
        '127.0.0.1',
        () => resolve(instance)
      );
    });

    const baseUrl =
      `http://127.0.0.1:${server.address().port}`;

    // 1. Create a blackout on the original posting date.
    const createResponse = await fetch(
      `${baseUrl}/api/blackouts`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platformId,
          startDate: original.date,
          endDate: original.date,
          reason: 'Test blackout',
        }),
      }
    );

    assert.equal(createResponse.status, 201);

    const blackout = await createResponse.json();

    // 2. Original regular slot must be removed.
    const blockedSlot = await db.get(`
      SELECT * FROM slot
      WHERE platformId = ? AND date = ?
    `, [platformId, original.date]);

    assert.equal(blockedSlot, undefined);

    // 3. Library post should move to a later Monday.
    const moved = await getAssignedSlot();

    assert.ok(moved, 'Post should be rescheduled');
    assert.ok(moved.date > original.date);

    assert.equal(
      new Date(`${moved.date}T12:00:00Z`).getUTCDay(),
      1
    );

    // 4. Remove the blackout.
    const deleteResponse = await fetch(
      `${baseUrl}/api/blackouts/${blackout.id}`,
      { method: 'DELETE' }
    );

    assert.equal(deleteResponse.status, 204);

    // 5. Original posting slot should return.
    const restoredSlot = await db.get(`
      SELECT * FROM slot
      WHERE platformId = ? AND date = ?
    `, [platformId, original.date]);

    assert.ok(
      restoredSlot,
      'Original slot should return after blackout removal'
    );

    // Existing assignments should not move backward automatically.
    const finalAssignment = await getAssignedSlot();

    assert.equal(finalAssignment.date, moved.date);

    // Confirm the blackout record was deleted.
    const deleted = await db.get(
      'SELECT * FROM blackout WHERE id = ?',
      [blackout.id]
    );

    assert.equal(deleted, undefined);

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
