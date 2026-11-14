
import test from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../../src/db/index.js';
import {
  setCalendarClient,
  syncPlatform,
} from '../../src/services/sync.js';

// TC-124: Test the Google Calendar event lifecycle.
test('TC-124: Create, update, and remove Calendar events', async () => {
  const db = await openDb(':memory:');

  const calls = [];

  // Fake Google Calendar client.
  // No requests go to the real Google Calendar.
  const mockCalendar = {
    async insert(event) {
      calls.push({ action: 'insert', event });

      return {
        id: 'mock-event-1',
        etag: 'etag-1',
      };
    },

    async patch(eventId, event, etag) {
      calls.push({
        action: 'patch',
        eventId,
        event,
        etag,
      });

      return {
        id: eventId,
        etag: 'etag-2',
      };
    },

    async remove(eventId) {
      calls.push({
        action: 'remove',
        eventId,
      });
    },
  };

  setCalendarClient(mockCalendar);

  try {
    // Schedule the post next month.
    const now = new Date();

    const nextMonth = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() + 1,
      1
    ));

    const month = nextMonth.toISOString().slice(0, 7);

    // Create test platform.
    const platform = await db.run(`
      INSERT INTO platform
        (key, name, usesColors)
      VALUES (?, ?, 0)
    `, ['calendar-test', 'Calendar Test']);

    const platformId = platform.lastInsertRowid;

    // Create post type.
    const type = await db.run(`
      INSERT INTO postType
        (platformId, name, sortOrder, inRotation)
      VALUES (?, 'Newsletter', 1, 1)
    `, [platformId]);

    // Schedule every Monday at 1 PM.
    await db.run(`
      INSERT INTO scheduleRule
        (platformId, byDay, time, startDate)
      VALUES (?, 'MO', '13:00', ?)
    `, [platformId, `${month}-01`]);

    // Create the post.
    const post = await db.run(`
      INSERT INTO post
        (platformId, caption, hashtags, kind, postTypeId)
      VALUES (?, ?, ?, 'library', ?)
    `, [
      platformId,
      'Original calendar caption',
      '#CTR',
      type.lastInsertRowid,
    ]);

    const postId = post.lastInsertRowid;

    const getPost = () => db.get(
      'SELECT * FROM post WHERE id = ?',
      [postId]
    );

    // 1. Create a Calendar event.
    await syncPlatform(db, platformId, {
      months: [month],
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, 'insert');

    const createdEvent = calls[0].event;

    assert.equal(createdEvent.summary, 'Calendar Test');
    assert.equal(
      createdEvent.extendedProperties.private.postId,
      String(postId)
    );

    assert.match(
      createdEvent.description,
      /Original calendar caption/
    );

    const originalPost = await getPost();

    assert.ok(originalPost.scheduledAt);
    assert.equal(originalPost.calendarEventId, 'mock-event-1');
    assert.equal(originalPost.calendarEventEtag, 'etag-1');
    assert.ok(originalPost.calendarEventHash);

    // 2. Update the post caption.
    await db.run(
      'UPDATE post SET caption = ? WHERE id = ?',
      ['Updated calendar caption', postId]
    );

    await syncPlatform(db, platformId);

    assert.equal(calls.length, 2);
    assert.equal(calls[1].action, 'patch');
    assert.equal(calls[1].eventId, 'mock-event-1');
    assert.equal(calls[1].etag, 'etag-1');

    assert.match(
      calls[1].event.description,
      /Updated calendar caption/
    );

    const updatedPost = await getPost();

    assert.equal(updatedPost.calendarEventEtag, 'etag-2');
    assert.notEqual(
      updatedPost.calendarEventHash,
      originalPost.calendarEventHash
    );

    // 3. Sync again without changes.
    await syncPlatform(db, platformId);

    assert.equal(
      calls.length,
      2,
      'Unchanged events must not be updated again'
    );

    // 4. Pause the platform.
    await db.run(
      'UPDATE platform SET paused = 1 WHERE id = ?',
      [platformId]
    );

    await syncPlatform(db, platformId);

    // The event must be removed from Calendar.
    assert.equal(calls.length, 3);
    assert.equal(calls[2].action, 'remove');
    assert.equal(calls[2].eventId, 'mock-event-1');

    // Calendar metadata and publishing time are cleared.
    const pausedPost = await getPost();

    assert.equal(pausedPost.calendarEventId, null);
    assert.equal(pausedPost.calendarEventHash, null);
    assert.equal(pausedPost.calendarEventEtag, null);
    assert.equal(pausedPost.scheduledAt, null);

    // The post itself remains queued.
    assert.equal(pausedPost.status, 'queued');

    // 5. Confirm no duplicate Calendar operations.
    assert.deepEqual(
      calls.map(call => call.action),
      ['insert', 'patch', 'remove']
    );

  } finally {
    // Disconnect the fake Calendar client.
    setCalendarClient(null);

    await db.close();
  }
});
