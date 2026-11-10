
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { openDb } from '../../src/db/index.js';
import { slotsRouter } from '../../src/routes/slots.js';
import {
  setCalendarClient,
  syncPlatform,
} from '../../src/services/sync.js';

const year = new Date().getUTCFullYear() + 2;
const month = `${year}-01`;

// Make an HTTP request to the local test server.
async function request(baseUrl, path, method = 'GET', body) {
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

// Each scenario gets its own temporary database.
async function withTestApi(callback) {
  setCalendarClient(null);

  const db = await openDb(':memory:');
  let server;

  try {
    const result = await db.run(`
      INSERT INTO platform
        (key, name, usesColors)
      VALUES (?, ?, ?)
    `, ['rotation-test', 'Rotation Test', 0]);

    const platformId = result.lastInsertRowid;
    const typeIds = [];

    // Three post types: A, B, C.
    for (const [index, name] of ['A', 'B', 'C'].entries()) {
      const type = await db.run(`
        INSERT INTO postType
          (platformId, name, sortOrder, inRotation)
        VALUES (?, ?, ?, 1)
      `, [platformId, name, index + 1]);

      typeIds.push(type.lastInsertRowid);
    }

    const rule = await db.run(`
      INSERT INTO scheduleRule
        (platformId, byDay, time, startDate)
      VALUES (?, ?, ?, ?)
    `, [platformId, 'MO,FR', '13:00', `${month}-01`]);

    const ruleId = rule.lastInsertRowid;

    // Generate future slots.
    await syncPlatform(db, platformId, {
      months: [month],
    });

    const app = express();
    app.use(express.json());

    // Simulated user; authentication tested separately.
    app.use((req, res, next) => {
      req.user = {
        role: 'superAdmin',
        active: 1,
      };
      next();
    });

    app.use('/api/slots', slotsRouter(db));

    server = await new Promise(resolve => {
      const instance = app.listen(
        0,
        '127.0.0.1',
        () => resolve(instance)
      );
    });

    const baseUrl =
      `http://127.0.0.1:${server.address().port}`;

    const getSlots = () => db.all(`
      SELECT * FROM slot
      WHERE platformId = ? AND date LIKE ?
      ORDER BY scheduledAt
    `, [platformId, `${month}-%`]);

    await callback({
      db,
      baseUrl,
      platformId,
      ruleId,
      typeIds,
      getSlots,
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

// TC-023: Verify all three post-type change choices.
test('TC-023: Slot post type changes support rotation choices', async () => {
  const choices = [
    {
      name: 'Only this slot',
      scope: null,
      expected: ([a, b, c]) => [b, b, c, a],
    },
    {
      name: 'This and later slots',
      scope: 'later',
      expected: ([a, b, c]) => [b, b, c, b],
    },
    {
      name: 'Shift the rotation',
      scope: 'rotation',
      expected: ([a, b, c]) => [b, c, a, b],
    },
  ];

  for (const choice of choices) {
    await withTestApi(async ctx => {
      const before = await ctx.getSlots();
      const [a, b, c] = ctx.typeIds;

      assert.ok(
        before.length >= 4,
        `${choice.name}: expected at least 4 slots`
      );

      // Original rotation: A, B, C, A.
      assert.deepEqual(
        before.slice(0, 4).map(s => s.postTypeId),
        [a, b, c, a],
        `${choice.name}: original rotation`
      );

      const slotId = before[0].id;

      // Preview the change for the two recurring scopes.
      if (choice.scope) {
        const preview = await request(
          ctx.baseUrl,
          `/api/slots/${slotId}/type-change?scope=${choice.scope}&postTypeId=${b}`
        );

        assert.equal(
          preview.status,
          200,
          `${choice.name}: preview should succeed`
        );

        assert.equal(preview.data.scope, choice.scope);

        // Preview must not modify existing slots.
        const afterPreview = await ctx.getSlots();

        assert.deepEqual(
          afterPreview.slice(0, 4).map(s => s.postTypeId),
          [a, b, c, a],
          `${choice.name}: preview must not save changes`
        );
      }

      // Apply the selected change.
      const path = choice.scope
        ? `/api/slots/${slotId}/type-change`
        : `/api/slots/${slotId}`;

      const body = choice.scope
        ? { scope: choice.scope, postTypeId: b }
        : { postTypeId: b };

      const result = await request(
        ctx.baseUrl,
        path,
        choice.scope ? 'POST' : 'PATCH',
        body
      );

      assert.equal(
        result.status,
        200,
        `${choice.name}: update should succeed`
      );

      // Verify the resulting slot sequence.
      const after = await ctx.getSlots();

      assert.deepEqual(
        after.slice(0, 4).map(s => s.postTypeId),
        choice.expected(ctx.typeIds),
        `${choice.name}: incorrect rotation`
      );

      // Verify whether a permanent rule change was saved.
      const saved = await ctx.db.get(`
        SELECT kind FROM ruleTypeChange
        WHERE ruleId = ?
        ORDER BY id DESC
        LIMIT 1
      `, [ctx.ruleId]);

      assert.equal(
        saved?.kind,
        choice.scope ?? undefined,
        `${choice.name}: incorrect saved rule`
      );
    });
  }
});
