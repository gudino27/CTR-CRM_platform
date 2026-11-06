/**
 * Notification area routes (/api/notifications): the bell's count,
 * the Notifications page, marking read, and the caption choice after a text edit in Google
 * Calendar. The kinds of notification and their wording are in services/notifications.js.
 *
 * Permissions: everything needs viewNotifications (ROUTES in services/permissions.js); read
 * state is shared by everyone. The caption choice also needs editPosts, checked here.
 */
import { Router } from 'express';
import { can } from '../services/permissions.js';
import { syncPlatform } from '../services/sync.js';
import { notificationView, notifyFailures, resolveTextEdit } from '../services/notifications.js';

const MAX_LIMIT = 500;

/**
 * The /api/notifications router.
 *
 * Usage:
 *   app.use('/api/notifications', notificationsRouter(db));   (app.js)
 *
 * Takes:
 *   db - the open database
 *
 * Returns:
 *   An Express router with the routes below.
 *
 * How it works:
 *   The list and the count first run notifyFailures (fresh), which picks up posts that failed
 *   since the last background scan, so the list is never behind. A scan error is logged, not
 *   returned.
 */
export function notificationsRouter(db) {
  const router = Router();
  const unreadCount = async () => (await db.get('SELECT COUNT(*) AS n FROM notification WHERE readAt IS NULL')).n;
  const byId = async (id) => notificationView(await db.get('SELECT * FROM notification WHERE id = ?', [id]));
  const fresh = () => notifyFailures(db).catch((err) => console.error('Failed-post notifications failed:', err));

  /**
   * GET /api/notifications: the Notifications page's list, newest first. Needs viewNotifications.
   *
   * Usage:
   *   GET /api/notifications?limit=200
   *
   * Takes:
   *   limit - how many, default 200, at most MAX_LIMIT (500)
   *
   * Returns:
   *   200 { notifications: [notificationView rows], unread: number }
   */
  router.get('/', async (req, res) => {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit ?? '200', 10) || 200, 1), MAX_LIMIT);
    await fresh();
    const rows = await db.all('SELECT * FROM notification ORDER BY id DESC LIMIT ?', [limit]);
    res.json({ notifications: rows.map(notificationView), unread: await unreadCount() });
  });

  /**
   * GET /api/notifications/count: the bell's unread count. Needs viewNotifications.
   *
   * Usage:
   *   GET /api/notifications/count
   *
   * Returns:
   *   200 { unread: number }
   *
   * When editing:
   *   The bell asks this every minute. It does not count as activity (renew: false in ROUTES),
   *   so a page left open still times out; keep it that way.
   */
  router.get('/count', async (req, res) => {
    await fresh();
    res.json({ unread: await unreadCount() });
  });

  /**
   * POST /api/notifications/read-all: marks every notification read, for everyone.
   * Needs viewNotifications.
   *
   * Usage:
   *   POST /api/notifications/read-all
   *
   * Returns:
   *   200 { unread: 0 }
   */
  router.post('/read-all', async (req, res) => {
    await db.run("UPDATE notification SET readAt = datetime('now') WHERE readAt IS NULL");
    res.json({ unread: 0 });
  });

  /**
   * POST /api/notifications/:id/read: marks one notification read (already read stays as it was).
   * Needs viewNotifications.
   *
   * Usage:
   *   POST /api/notifications/7/read
   *
   * Returns:
   *   200 { ...the notification, unread }; 404 when there is no such notification.
   */
  router.post('/:id/read', async (req, res) => {
    const row = await byId(req.params.id);
    if (!row) return res.status(404).json({ error: 'Notification not found' });
    if (!row.readAt) await db.run("UPDATE notification SET readAt = datetime('now') WHERE id = ?", [row.id]);
    res.json({ ...(await byId(row.id)), unread: await unreadCount() });
  });

  /**
   * POST /api/notifications/:id/resolve: settles a text edit made in Google Calendar by keeping
   * Google's caption or the app's. Needs viewNotifications (ROUTES) and editPosts (checked here).
   *
   * Usage:
   *   POST /api/notifications/7/resolve  { choice: "google" }
   *
   * Takes:
   *   body.choice - "google" (Google's caption becomes the app's) or "app" (the app's text is
   *                 written over Google's)
   *
   * Returns:
   *   200 { ...the notification, unread }; 403 { error, permission: 'editPosts' } without
   *   editPosts, or { error, permission: 'editScheduledPosts' } for choice "google" without that
   *   (the post is on the calendar, so it is scheduled); the status and error resolveTextEdit
   *   throws otherwise (400 bad choice,
   *   404 not found, 409 already settled or the post can no longer be edited).
   *
   * How it works:
   *   resolveTextEdit (services/notifications.js) stores the choice, updates the post and writes
   *   its own audit entry on the post; then syncPlatform writes the result to the calendar.
   */
  router.post('/:id/resolve', async (req, res) => {
    // Choosing a caption edits the post, so editPosts too (ROUTES only checked viewNotifications)
    if (!(await can(db, req.user, 'editPosts'))) {
      return res.status(403).json({ error: 'Choosing a caption needs the "Edit posts" permission', permission: 'editPosts' });
    }
    // Google's caption changes a post that is on the calendar, i.e. scheduled: that needs editScheduledPosts too
    if (req.body?.choice === 'google' && !(await can(db, req.user, 'editScheduledPosts'))) {
      return res.status(403).json({ error: 'Ask a super admin to change a scheduled post', permission: 'editScheduledPosts' });
    }
    try {
      const { notification, platformId } = await resolveTextEdit(db, req.params.id, req.body?.choice, req.user?.id);
      if (platformId !== null) await syncPlatform(db, platformId);
      res.json({ ...notification, unread: await unreadCount() });
    } catch (err) {
      if (!err?.status) throw err;
      res.status(err.status).json({ error: err.error });
    }
  });

  return router;
}
