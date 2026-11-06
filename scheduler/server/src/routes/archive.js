/**
 * Archive page routes (/api/archive): published posts filtered by
 * platform and age, archived and unarchived in bulk, and archived ones deleted for good. The
 * work itself is in services/archive.js, which also writes the audit entries (one per bulk
 * action, with the count and ids).
 *
 * Permissions: everything needs archivePosts (ROUTES in services/permissions.js). Deleting for
 * good needs deletePosts there AND archivePosts, which is checked here, since a route has one
 * permission in ROUTES.
 */
import { Router } from 'express';
import { can } from '../services/permissions.js';
import {
  ArchiveError, archivePosts, deleteArchivedPosts, listArchive, postIdsFrom, unarchivePosts,
} from '../services/archive.js';
import { archiveDefaultOlderThan, archiveOlderThanChoices } from '../settings.js';
import { trashDays } from '../services/mediaTrash.js';

const VIEWS = ['published', 'archived'];
const MAX_LIMIT = 500;

/**
 * The /api/archive router.
 *
 * Usage:
 *   app.use('/api/archive', archiveRouter(db));   (app.js)
 *
 * Takes:
 *   db - the open database
 *
 * Returns:
 *   An Express router with the routes below.
 */
export function archiveRouter(db) {
  const router = Router();

  /**
   * Wraps a handler that returns the JSON answer: an ArchiveError becomes its status and
   * message (plus any extra fields); anything else is a real error and goes to app.js's handler.
   *
   * Usage:
   *   router.post('/archive', handle(async (req) => archivePosts(...)));
   */
  const handle = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      if (!(err instanceof ArchiveError)) throw err;
      res.status(err.status).json({ error: err.message, ...err.extra });
    }
  };

  /**
   * GET /api/archive: one page of published (or archived) posts for the Archive page.
   * Needs archivePosts.
   *
   * Usage:
   *   GET /api/archive?view=published&platformId=2&olderThan=12&search=spring&limit=100&offset=0
   *
   * Takes:
   *   view       - "published" (default) or "archived"
   *   olderThan  - months, one of archiveOlderThanChoices (settings.js); 0 = any age;
   *                missing or empty = archiveDefaultOlderThan
   *   platformId - optional, one platform
   *   search     - optional text to look for
   *   limit      - page size, default 100, at most MAX_LIMIT (500); offset - default 0
   *
   * Returns:
   *   200 with listArchive's answer plus { view, olderThan, trashDays }; trashDays is how many
   *   days an image sent to Recently deleted can still be restored, for the page's wording.
   *   400 for a bad view, olderThan or platformId.
   */
  router.get('/', handle(async (req) => {
    const view = req.query.view ?? 'published';
    if (!VIEWS.includes(view)) throw new ArchiveError(400, 'view must be "published" or "archived"');
    const olderThan = req.query.olderThan === undefined || req.query.olderThan === '' ? archiveDefaultOlderThan : Number(req.query.olderThan);
    if (!archiveOlderThanChoices.includes(olderThan)) throw new ArchiveError(400, `olderThan must be one of ${archiveOlderThanChoices.join(', ')} (months; 0 = any age)`);
    const platformId = req.query.platformId ? Number(req.query.platformId) : null;
    if (platformId !== null && !Number.isInteger(platformId)) throw new ArchiveError(400, 'platformId must be a number');
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), MAX_LIMIT);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const search = String(req.query.search ?? '').trim();
    const result = await listArchive(db, { view, platformId, olderThan, search, limit, offset });
    return { ...result, view, olderThan, trashDays: trashDays() };
  }));

  /**
   * POST /api/archive/archive: archives published posts. Needs archivePosts.
   *
   * Usage:
   *   POST /api/archive/archive  { postIds: [12, 13] }
   *
   * Takes:
   *   body - { postIds } (read by postIdsFrom in services/archive.js)
   *
   * Returns:
   *   200 with archivePosts' answer; an ArchiveError's status and message otherwise.
   */
  router.post('/archive', handle(async (req) => archivePosts(db, postIdsFrom(req.body), { userId: req.user?.id ?? null })));

  /**
   * POST /api/archive/unarchive: brings archived posts back to the published list.
   * Needs archivePosts.
   *
   * Usage:
   *   POST /api/archive/unarchive  { postIds: [12, 13] }
   *
   * Takes:
   *   body - { postIds }
   *
   * Returns:
   *   200 with unarchivePosts' answer; an ArchiveError's status and message otherwise.
   */
  router.post('/unarchive', handle(async (req) => unarchivePosts(db, postIdsFrom(req.body), { userId: req.user?.id ?? null })));

  /**
   * POST /api/archive/delete: deletes archived posts for good. Needs deletePosts (ROUTES)
   * and archivePosts (checked here).
   *
   * Usage:
   *   POST /api/archive/delete  { postIds: [12, 13], confirm: "delete 2 posts" }
   *
   * Takes:
   *   body - { postIds, confirm }; confirm is the typed confirmation deleteArchivedPosts checks
   *
   * Returns:
   *   200 with deleteArchivedPosts' answer; 403 { error, permission: 'archivePosts' } without
   *   archivePosts; an ArchiveError's status and message otherwise (e.g. a wrong confirm).
   *
   * When editing:
   *   This deletes for good: keep both permission checks and the typed confirm.
   */
  router.post('/delete', handle(async (req) => {
    // Second permission check: ROUTES only checked deletePosts
    if (!(await can(db, req.user, 'archivePosts'))) {
      throw new ArchiveError(403, 'Deleting archived posts needs the "Archive old posts" permission', { permission: 'archivePosts' });
    }
    const ids = postIdsFrom(req.body);
    return deleteArchivedPosts(db, ids, req.body?.confirm, { userId: req.user?.id ?? null });
  }));

  return router;
}
