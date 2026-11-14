
import test from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../../src/db/index.js';
import { config } from '../../src/config.js';
import { localDateTimeString } from '../../src/services/time.js';

import {
  setCalendarClient,
  syncPlatform,
} from '../../src/services/sync.js';

import {
  setPullCalendarClient,
  pullCalendar,
} from '../../src/services/calendarPull.js';

// TC-125: Verify changes made in Google Calendar
// are synchronized back to the Social Scheduler.
test('TC-125: Synchronize Google Calendar changes', async () => {
  const db = await openDb(':memory:');

  const writes = [];
  const pullRequests = [];
  let eventNumber = 0;
  let incomingEvents = [];

  // Fake Google Calendar client for outgoing changes.
  const mockCalendar = {
    async insert(event) {
      const id = `mock-event-${++eventNumber}`;
      const etag = `local-etag-${eventNumber}`;

      writes.push({ action: 'insert', id, event });

      return { id, etag };
    },

    async patch(id, event, etag) {
      writes.push({ action: 'patch', id, event, etag });

      return {
        id,
        etag: 'local-updated-etag',
      };
    },

    async remove(id) {
      writes.push({ action: 'remove', id });
    },
  };

  // Fake Google Calendar client for incoming changes.
  const mockPull = {
    async list({ syncToken, pageToken } = {}) {
      pullRequests.push({ syncToken, pageToken });

      return {
        items: incomingEvents,
        nextPageToken: null,
        nextSyncToken: `test-token-${pullRequests.length}`,
      };
    },

    async read() {
      return null;
    },
  };

  setCalendarClient(mockCalendar);
  setPullCalendarClient(mockPull);

  try {
    // Use next month so the post is in the future.
    const now = new Date();

    const futureMonth = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() + 1,
      1
    ));

    const month = futureMonth.toISOString().slice(0, 7);

    // Create a test platform.
    const platform = await db.run(`
      INSERT INTO platform (key, name, usesColors)
      VALUES (?, ?, 0)
    `, ['calendar-pull-test', 'Calendar Pull Test']);

    const platformId = platform.lastInsertRowid;

    // Create a post type.
    const type = await db.run(`
      INSERT INTO postType
        (platformId, name, sortOrder, inRotation)
      VALUES (?, 'Newsletter', 1, 1)
    `, [platformId]);

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
      'Two-way synchronization test',
      type.lastInsertRowid,
    ]);

    const postId = post.lastInsertRowid;

    const getPost = () => db.get(
      'SELECT * FROM post WHERE id = ?',
      [postId]
    );

    // 1. Generate the original Calendar event.
    await syncPlatform(db, platformId, {
      months: [month],
    });

    const original = await getPost();

    assert.ok(original.scheduledAt);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].action, 'insert');

    const originalEventId = original.calendarEventId;
    const originalEvent = writes[0].event;

    // 2. An unchanged event should be ignored.
    incomingEvents = [{
      ...originalEvent,
      id: originalEventId,
      etag: original.calendarEventEtag,
    }];

    const unchanged = await pullCalendar(db);

    assert.equal(unchanged.changed, 0);
    assert.equal((await getPost()).kind, 'library');
    assert.equal(writes.length, 1);

    // 3. Simulate someone moving the event
    // three days later in Google Calendar.
    const movedTime = new Date(
      Date.parse(original.scheduledAt) +
      3 * 24 * 60 * 60 * 1000
    );

    const expectedFixedAt = localDateTimeString(
      movedTime,
      config.timezone
    );

    incomingEvents = [{
      ...originalEvent,
      id: originalEventId,
      etag: 'remote-moved-etag',
      start: {
        dateTime: movedTime.toISOString(),
        timeZone: config.timezone,
      },
    }];

    const moved = await pullCalendar(db);

    assert.equal(moved.changed, 1);

    // The library post should become a Specific Date post.
    const movedPost = await getPost();

    assert.equal(movedPost.kind, 'fixed');
    assert.equal(movedPost.fixedAt, expectedFixedAt);
    assert.equal(movedPost.status, 'queued');
    assert.equal(
      movedPost.scheduledAt,
      movedTime.toISOString()
    );

    // The change should be reflected in the Calendar sync.
    assert.equal(writes.length, 2);
    assert.equal(writes[1].action, 'patch');
    assert.equal(writes[1].id, originalEventId);

    // Confirm the move was recorded in the audit log.
    const moveAudit = await db.get(`
      SELECT * FROM auditLog
      WHERE entityId = ?
        AND action = 'post.calendarMove'
    `, [postId]);

    assert.ok(moveAudit);

    // 4. Simulate someone deleting the Calendar event.
    incomingEvents = [{
      id: originalEventId,
      status: 'cancelled',
      extendedProperties: {
        private: {
          postId: String(postId),
        },
      },
    }];

    const deleted = await pullCalendar(db);

    assert.equal(deleted.changed, 1);

    // Since the type is part of the rotation,
    // the Specific Date post returns to the library.
    const returnedPost = await getPost();

    assert.equal(returnedPost.kind, 'library');
    assert.equal(returnedPost.fixedAt, null);
    assert.equal(returnedPost.status, 'queued');

    // The post should receive a new future slot.
    const newSlot = await db.get(
      'SELECT * FROM slot WHERE postId = ?',
      [postId]
    );

    assert.ok(newSlot);
    assert.ok(
      newSlot.scheduledAt > new Date().toISOString()
    );

    // A replacement Calendar event should be created.
    assert.equal(writes.length, 3);
    assert.equal(writes[2].action, 'insert');

    assert.notEqual(
      returnedPost.calendarEventId,
      originalEventId
    );

    // 5. Confirm the deletion was recorded.
    const deleteAudit = await db.get(`
      SELECT * FROM auditLog
      WHERE entityId = ?
        AND action = 'post.calendarDelete'
    `, [postId]);

    assert.ok(deleteAudit);

    // 6. Confirm incremental synchronization.
    assert.equal(pullRequests.length, 3);
    assert.equal(pullRequests[1].syncToken, 'test-token-1');
    assert.equal(pullRequests[2].syncToken, 'test-token-2');

  } finally {
    // Disconnect both mock Calendar clients.
    setCalendarClient(null);
    setPullCalendarClient(null);

    await db.close();
  }
});
