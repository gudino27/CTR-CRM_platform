
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { openDb } from '../../src/db/index.js';
import { notificationsRouter } from '../../src/routes/notifications.js';
import { postsRouter } from '../../src/routes/posts.js';
import { buildEvent } from '../../src/services/googleCalendar.js';

import {
  setCalendarClient,
  syncPlatform,
} from '../../src/services/sync.js';

import {
  setPullCalendarClient,
  pullCalendar,
} from '../../src/services/calendarPull.js';

// TC-128: Verify notifications and activity logging.
test('TC-128: Handle notifications and audit history', async () => {
  const db = await openDb(':memory:');
  let server;

  // Disable real Google Calendar connections.
  setCalendarClient(null);
  setPullCalendarClient(null);

  try {
    const year = new Date().getUTCFullYear() + 2;
    const month = `${year}-01`;

    // Create a test platform.
    const platform = await db.run(`
      INSERT INTO platform (key, name, usesColors)
      VALUES (?, ?, 0)
    `, ['activity-test', 'Activity Test']);

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
      'Activity logging test',
      type.lastInsertRowid,
    ]);

    const postId = post.lastInsertRowid;

    const getPost = () => db.get(
      'SELECT * FROM post WHERE id = ?',
      [postId]
    );

    // Generate the original schedule.
    await syncPlatform(db, platformId, {
      months: [month],
    });

    const originalPost = await getPost();

    const originalSlot = await db.get(
      'SELECT * FROM slot WHERE postId = ?',
      [postId]
    );

    assert.ok(originalSlot);
    assert.ok(originalPost.scheduledAt);

    // Simulate an existing Google Calendar event.
    const eventId = 'mock-activity-event-1';

    await db.run(`
      UPDATE post
      SET calendarEventId = ?,
          calendarEventEtag = ?
      WHERE id = ?
    `, [eventId, 'original-etag', postId]);

    const eventBody = buildEvent({
      platform: {
        name: 'Activity Test',
      },
      post: originalPost,
      media: null,
      slot: new Date(originalSlot.scheduledAt),
    });

    // Simulate a user moving the event into the past.
    const pastTime = new Date(
      Date.now() - 24 * 60 * 60 * 1000
    );

    const changedEvent = {
      ...eventBody,
      id: eventId,
      etag: 'google-changed-etag',
      start: {
        ...eventBody.start,
        dateTime: pastTime.toISOString(),
      },
    };

    let pendingChange = true;

    setPullCalendarClient({
      async list() {
        const items = pendingChange
          ? [changedEvent]
          : [];

        pendingChange = false;

        return {
          items,
          nextPageToken: null,
          nextSyncToken: 'activity-test-token',
        };
      },

      async read() {
        return null;
      },
    });

    // 1. Pull the change from Google Calendar.
    const pulled = await pullCalendar(db);

    assert.ok(pulled);
    assert.equal(pulled.changed, 1);

    // Moving a scheduled post into the past
    // must fail safely instead of publishing it.
    const failedPost = await getPost();

    assert.equal(failedPost.status, 'failed');
    assert.match(
      failedPost.lastError,
      /already passed/
    );

    // 2. Verify the activity was recorded.
    const audit = await db.get(`
      SELECT * FROM auditLog
      WHERE action = 'post.calendarMove'
        AND entityType = 'post'
        AND entityId = ?
    `, [postId]);

    assert.ok(audit);
    assert.match(audit.summary, /Google Calendar/);

    // 3. Verify a failure notification was created.
    const notification = await db.get(`
      SELECT * FROM notification
      WHERE kind = 'postFailed'
        AND postId = ?
    `, [postId]);

    assert.ok(notification);
    assert.equal(notification.readAt, null);
    assert.equal(notification.resolvedAt, null);

    // Start a local API server.
    const app = express();
    app.use(express.json());

    // Authentication is covered by separate tests.
    app.use((req, res, next) => {
      req.user = {
        role: 'superAdmin',
        active: 1,
      };
      next();
    });

    app.use(
      '/api/notifications',
      notificationsRouter(db)
    );

    app.use('/api/posts', postsRouter(db));

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
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
      });

      return {
        status: response.status,
        data: await response.json(),
      };
    }

    // 4. Verify the unread notification count.
    const count = await request(
      '/api/notifications/count'
    );

    assert.equal(count.status, 200);
    assert.equal(count.data.unread, 1);

    // Verify the notification listing.
    const listing = await request(
      '/api/notifications'
    );

    assert.equal(listing.status, 200);
    assert.equal(listing.data.notifications.length, 1);
    assert.equal(listing.data.unread, 1);

    assert.equal(
      listing.data.notifications[0].kind,
      'postFailed'
    );

    // 5. Mark the notification as read.
    const markedRead = await request(
      `/api/notifications/${notification.id}/read`,
      'POST'
    );

    assert.equal(markedRead.status, 200);
    assert.equal(markedRead.data.unread, 0);
    assert.ok(markedRead.data.readAt);

    const updatedCount = await request(
      '/api/notifications/count'
    );

    assert.equal(updatedCount.data.unread, 0);

    // 6. Requeue the failed library post.
    const requeued = await request(
      `/api/posts/${postId}/requeue`,
      'POST',
      {}
    );

    assert.equal(requeued.status, 200);
    assert.equal(requeued.data.status, 'queued');
    assert.equal(requeued.data.lastError, null);

    // The notification scan closes resolved failures.
    const afterRequeue = await request(
      '/api/notifications/count'
    );

    assert.equal(afterRequeue.status, 200);
    assert.equal(afterRequeue.data.unread, 0);

    const resolved = await db.get(
      'SELECT * FROM notification WHERE id = ?',
      [notification.id]
    );

    assert.ok(resolved.resolvedAt);

    // 7. Confirm no duplicate failure notifications.
    const allFailures = await db.all(`
      SELECT * FROM notification
      WHERE kind = 'postFailed'
        AND postId = ?
    `, [postId]);

    assert.equal(allFailures.length, 1);

    // Confirm the original audit record remains.
    const savedAudit = await db.get(
      'SELECT * FROM auditLog WHERE id = ?',
      [audit.id]
    );

    assert.ok(savedAudit);

  } finally {
    setCalendarClient(null);
    setPullCalendarClient(null);

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
