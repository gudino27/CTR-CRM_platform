
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { openDb } from '../../src/db/index.js';
import { slotsRouter } from '../../src/routes/slots.js';
import { platformsRouter } from '../../src/routes/platforms.js';
import {
  setCalendarClient,
  syncPlatform,
} from '../../src/services/sync.js';

// TC-120: Locked and pinned slots survive schedule changes.
test('TC-120: Preserve locked and pinned calendar slots', async () => {
  setCalendarClient(null);

  const db = await openDb(':memory:');
  let server;

  try {
    const year = new Date().getUTCFullYear() + 2;
    const month = `${year}-01`;

    // Create an isolated platform.
    const platform = await db.run(`
      INSERT INTO platform (key, name, usesColors)
      VALUES (?, ?, 0)
    `, ['slot-protection-test', 'Slot Protection Test']);

    const platformId = platform.lastInsertRowid;

    const type = await db.run(`
      INSERT INTO postType
        (platformId, name, sortOrder, inRotation)
      VALUES (?, 'Newsletter', 1, 1)
    `, [platformId]);

    // Original schedule: Mondays at 1 PM.
    const rule = await db.run(`
      INSERT INTO scheduleRule
        (platformId, byDay, time, startDate)
      VALUES (?, 'MO', '13:00', ?)
    `, [platformId, `${month}-01`]);

    // Create three posts.
    for (let i = 1; i <= 3; i++) {
      await db.run(`
        INSERT INTO post
          (platformId, caption, kind, postTypeId)
        VALUES (?, ?, 'library', ?)
      `, [
        platformId,
        `Protection test ${i}`,
        type.lastInsertRowid,
      ]);
    }

    await syncPlatform(db, platformId, {
      months: [month],
    });

    const getSlot = id => db.get(
      'SELECT * FROM slot WHERE id = ?',
      [id]
    );

    const assigned = await db.all(`
      SELECT * FROM slot
      WHERE platformId = ? AND postId IS NOT NULL
      ORDER BY scheduledAt
    `, [platformId]);

    assert.equal(assigned.length, 3);

    const [lockedOriginal, pinnedOriginal, normalOriginal] =
      assigned;

    // Start the API server.
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

    app.use('/api/slots', slotsRouter(db));
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      return {
        status: response.status,
        data: await response.json(),
      };
    }

    // 1. Lock the first slot.
    const locked = await request(
      `/api/slots/${lockedOriginal.id}`,
      'PATCH',
      { locked: true }
    );

    assert.equal(locked.status, 200);
    assert.equal(locked.data.locked, true);

    // 2. Pin the second post to its current slot.
    const pinned = await request(
      `/api/slots/${pinnedOriginal.id}`,
      'PATCH',
      { postId: pinnedOriginal.postId }
    );

    assert.equal(pinned.status, 200);
    assert.equal(pinned.data.pinned, true);

    // Confirm both posts are still assigned.
    assert.equal(
      (await getSlot(lockedOriginal.id)).postId,
      lockedOriginal.postId
    );

    assert.equal(
      (await getSlot(pinnedOriginal.id)).postId,
      pinnedOriginal.postId
    );

    // 3. Change the schedule from Monday to Tuesday.
    const changed = await request(
      `/api/platforms/${platformId}/rules/${rule.lastInsertRowid}`,
      'PATCH',
      { byDay: 'TU', keepPosts: false }
    );

    assert.equal(changed.status, 200);

    // 4. Locked slot must remain unchanged.
    const lockedAfter = await getSlot(lockedOriginal.id);

    assert.ok(lockedAfter);
    assert.equal(lockedAfter.locked, 1);
    assert.equal(lockedAfter.date, lockedOriginal.date);
    assert.equal(lockedAfter.time, lockedOriginal.time);
    assert.equal(lockedAfter.postId, lockedOriginal.postId);

    // 5. Pinned slot must remain unchanged.
    const pinnedAfter = await getSlot(pinnedOriginal.id);

    assert.ok(pinnedAfter);
    assert.equal(pinnedAfter.pinned, 1);
    assert.equal(pinnedAfter.date, pinnedOriginal.date);
    assert.equal(pinnedAfter.time, pinnedOriginal.time);
    assert.equal(pinnedAfter.postId, pinnedOriginal.postId);

    // 6. Normal slot should follow the new schedule.
 
    const oldMondaySlot = await db.get(`
    SELECT * FROM slot
    WHERE platformId = ?
        AND date = ?
        AND time = ?
    `, [
    platformId,
    normalOriginal.date,
    normalOriginal.time,
    ]);

    assert.equal(
    oldMondaySlot,
    undefined,
    'Unprotected Monday slot should be removed'
    );


    // Its post should move to a Tuesday slot.
    const movedPostSlot = await db.get(`
      SELECT * FROM slot WHERE postId = ?
    `, [normalOriginal.postId]);

    assert.ok(movedPostSlot);
    assert.notEqual(
      movedPostSlot.date,
      normalOriginal.date
    );

    assert.equal(
      new Date(
        `${movedPostSlot.date}T12:00:00Z`
      ).getUTCDay(),
      2
    );

    // 7. Confirm only the protected Monday assignments remain.
    const mondayAssignments = await db.all(`
      SELECT * FROM slot
      WHERE platformId = ?
        AND postId IS NOT NULL
        AND id IN (?, ?)
    `, [
      platformId,
      lockedOriginal.id,
      pinnedOriginal.id,
    ]);

    assert.equal(mondayAssignments.length, 2);

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
