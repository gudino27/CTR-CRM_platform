/**
 * Archive for old published posts. After a few years the server
 * fills up with posts that went out long ago, so an admin can:
 *   - archive them: the post row, caption, dates and a small copy of its image stay, but it
 *     leaves the Library's lists. Its full-size image goes to Recently deleted (the media
 *     trash flow in mediaTrash.js) when no post that is not archived still uses it; after the
 *     restore window the purge keeps a small JPEG for history, because the post is published.
 *   - unarchive them again,
 *   - delete archived posts for good (and the small copies nothing else uses).
 * Nothing is archived or deleted on its own unless ARCHIVE_AFTER_MONTHS is set (autoArchive).
 *
 * What lives here: listArchive, archivePosts, unarchivePosts, deleteArchivedPosts (the four
 * things routes/archive.js offers), autoArchive and archiveAfterMonths (the automatic hook),
 * and the helpers ArchiveError, cutoffFor, postIdsFrom and deleteConfirmText.
 *
 * When editing:
 *   Each bulk action writes one audit entry (entityId only when it is a single post).
 */
import { rmSync } from 'node:fs';
import { clock } from './clock.js';
import { writeAudit } from './access.js';
import { trashMedia } from './mediaTrash.js';
// The default "Older than" choice of the Archive page (months; 0 = any age)
import { archiveDefaultOlderThan } from '../settings.js';

// When a published post went out: sentAt, or its scheduled time for posts n8n reported without one
const POSTED_AT = 'COALESCE(post.sentAt, post.scheduledAt, post.createdAt)';

/**
 * An error with an HTTP status for the route to send back.
 *
 * Usage:
 *   throw new ArchiveError(400, 'postIds must be a list of post ids');
 *
 * Takes:
 *   status  - the HTTP status
 *   message - the error text the page shows
 *   extra   - more fields for the JSON answer (e.g. { missing: [ids] }); {} by default
 *
 * When editing:
 *   routes/archive.js answers { error: message, ...extra } with this status; any other error
 *   is a 500.
 */
export class ArchiveError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/**
 * The cut-off time for "older than N months".
 *
 * Usage:
 *   cutoffFor(12)   // -> ISO time 12 months before clock.now()
 *
 * Takes:
 *   months - whole months; 0 means any age
 *   now    - a Date; the app clock by default
 *
 * Returns:
 *   The ISO time `months` months before `now`, or null for 0 (any age).
 *
 * When editing:
 *   Uses UTC months, so near a month's end the day can roll over (e.g. Mar 31 minus one
 *   month is Mar 3 in a non-leap year), as Date.setUTCMonth does.
 */
export function cutoffFor(months, now = clock.now()) {
  if (!months) return null;
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff.toISOString();
}

const placeholders = (list) => list.map(() => '?').join(', ');

/**
 * Published posts for the Archive page.
 *
 * Usage:
 *   const result = await listArchive(db, { view, platformId, olderThan, search, limit, offset });
 *
 * Takes:
 *   view       - "published" (posted, not archived) or "archived"
 *   platformId - only this platform, or empty for all
 *   olderThan  - months (see archiveOlderThanChoices in settings.js); default archiveDefaultOlderThan
 *   search     - caption text to look for (any case), or ''
 *   limit, offset - paging (100, 0 by default); the route checks them
 *
 * Returns:
 *   { posts, total, storageBytes, counts: { published, archived }, cutoff }.
 *   posts are in the order they went out (oldest first), each with platformName,
 *   postTypeName, postedAt, its image's name, size and state, and mediaLink
 *   (/api/media/:id/file, or null). total and storageBytes cover every match, not just this
 *   page; storageBytes adds up the images those posts use (each image once). counts are for
 *   both views with the same filters.
 *
 * How it works:
 *   When a post went out is sentAt, or its scheduled time for posts n8n reported without
 *   one (POSTED_AT). The search uses the same escaping as the media search: "!" escapes LIKE
 *   wildcards on both databases.
 *
 * When editing:
 *   The Number() calls keep counts and sizes plain numbers on both SQLite and MariaDB.
 */
export async function listArchive(db, { view = 'published', platformId, olderThan = archiveDefaultOlderThan, search = '', limit = 100, offset = 0 } = {}) {
  const cutoff = cutoffFor(olderThan);
  const filters = ["post.status = 'posted'"];
  const args = [];
  if (platformId) {
    filters.push('post.platformId = ?');
    args.push(platformId);
  }
  if (cutoff) {
    filters.push(`${POSTED_AT} < ?`);
    args.push(cutoff);
  }
  if (search) {
    // "!" escapes LIKE wildcards on both databases
    filters.push("lower(post.caption) LIKE lower(?) ESCAPE '!'");
    args.push(`%${search.replace(/[!%_]/g, (c) => `!${c}`)}%`);
  }
  const base = filters.join(' AND ');
  const where = `${base} AND post.archivedAt IS ${view === 'archived' ? 'NOT NULL' : 'NULL'}`;

  const posts = await db.all(`
    SELECT post.id, post.platformId, platform.name AS platformName, post.caption, post.hashtags, post.kind,
           post.postTypeId, postType.name AS postTypeName, post.sentAt, post.scheduledAt, post.fixedAt,
           ${POSTED_AT} AS postedAt, post.platformPostId, post.archivedAt, post.createdAt,
           post.mediaId, media.name AS mediaName, media.sizeBytes AS mediaSizeBytes, media.width AS mediaWidth,
           media.height AS mediaHeight, media.deletedAt AS mediaDeletedAt, media.archivedAt AS mediaArchivedAt
    FROM post JOIN platform ON platform.id = post.platformId
    LEFT JOIN postType ON postType.id = post.postTypeId
    LEFT JOIN media ON media.id = post.mediaId
    WHERE ${where}
    ORDER BY ${POSTED_AT}, post.id LIMIT ? OFFSET ?`, [...args, limit, offset]);
  const { total } = await db.get(`SELECT COUNT(*) AS total FROM post WHERE ${where}`, args);
  const { bytes } = await db.get(`SELECT COALESCE(SUM(sizeBytes), 0) AS bytes FROM media
    WHERE id IN (SELECT DISTINCT post.mediaId FROM post WHERE ${where} AND post.mediaId IS NOT NULL)`, args);
  const counts = {};
  for (const [key, test] of [['published', 'IS NULL'], ['archived', 'IS NOT NULL']]) {
    counts[key] = Number((await db.get(`SELECT COUNT(*) AS n FROM post WHERE ${base} AND post.archivedAt ${test}`, args)).n);
  }
  return {
    posts: posts.map((post) => ({ ...post, mediaLink: post.mediaId ? `/api/media/${post.mediaId}/file` : null })),
    total: Number(total),
    storageBytes: Number(bytes),
    counts,
    cutoff,
  };
}

/**
 * Checks the list of post ids in a request body.
 *
 * Usage:
 *   archivePosts(db, postIdsFrom(req.body), { userId })   // routes/archive.js
 *
 * Takes:
 *   body - the request body: { postIds: [positive whole numbers] }
 *
 * Returns:
 *   The ids with repeats removed. Throws ArchiveError 400 for a missing, empty or bad list.
 */
export function postIdsFrom(body) {
  const ids = body?.postIds;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => Number.isInteger(id) && id > 0)) {
    throw new ArchiveError(400, 'postIds must be a list of post ids');
  }
  return [...new Set(ids)];
}

/**
 * The posts for a list of ids (id, platformId, status, mediaId, archivedAt), by id.
 * Throws ArchiveError 404 { missing: [ids] } when any of them does not exist.
 */
async function postsByIds(db, ids) {
  const rows = await db.all(`SELECT id, platformId, status, mediaId, archivedAt FROM post WHERE id IN (${placeholders(ids)}) ORDER BY id`, ids);
  const missing = ids.filter((id) => !rows.some((row) => row.id === id));
  if (missing.length) throw new ArchiveError(404, `Post ${missing.join(', ')} not found`, { missing });
  return rows;
}

// "1, 2, 3", or the first 20 and "and N more", for audit summaries
const idList = (ids) => (ids.length > 20 ? `${ids.slice(0, 20).join(', ')} and ${ids.length - 20} more` : ids.join(', '));
// "1 post", "3 posts"
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/**
 * Sends the full-size images of just-archived posts to Recently deleted, each only when no
 * post that is not archived (of any status) still uses it. Images already deleted are left
 * alone.
 *
 * Returns:
 *   { trashed: [mediaId], kept: [{ mediaId, reason }] }
 *
 * When editing:
 *   An image that fails to move is only logged and listed in kept: the posts stay archived
 *   and the image just stays in the library (it can be deleted on the Media page).
 */
async function trashUnusedImages(db, mediaIds) {
  const trashed = [];
  const kept = [];
  for (const mediaId of mediaIds) {
    const media = await db.get('SELECT * FROM media WHERE id = ?', [mediaId]);
    if (!media || media.deletedAt) continue;
    const { n } = await db.get('SELECT COUNT(*) AS n FROM post WHERE mediaId = ? AND archivedAt IS NULL', [mediaId]);
    if (Number(n) > 0) {
      kept.push({ mediaId, reason: `Still used by ${plural(Number(n), 'post that is not archived', 'posts that are not archived')}` });
      continue;
    }
    try {
      await trashMedia(db, media);
      trashed.push(mediaId);
    } catch (err) {
      // The posts stay archived; the image stays in the library
      console.error(`Archive: image ${mediaId} could not go to Recently deleted:`, err);
      kept.push({ mediaId, reason: err.message });
    }
  }
  return { trashed, kept };
}

/**
 * Archives published posts. Posts already archived are skipped; any other status is refused.
 *
 * Usage:
 *   await archivePosts(db, [12, 13], { userId: req.user.id });   // POST /api/archive/archive
 *
 * Takes:
 *   ids    - post ids (postIdsFrom)
 *   userId - who did it, for the audit log (null for the automatic run)
 *   note   - text added to the audit summary (autoArchive says "automatically ...")
 *
 * Returns:
 *   { archived: [postId], skipped: [postId], imagesTrashed: [mediaId], imagesKept: [{ mediaId, reason }] }.
 *   Throws ArchiveError 404 for an unknown id, 400 { notPosted } when any post has not gone out
 *   (then nothing is archived).
 *
 * How it works:
 *   Stamps archivedAt (app clock) on the posts not archived yet, then sends their images to
 *   Recently deleted where nothing else uses them (trashUnusedImages), then writes one audit entry.
 */
export async function archivePosts(db, ids, { userId = null, note = '' } = {}) {
  const posts = await postsByIds(db, ids);
  const notPosted = posts.filter((post) => post.status !== 'posted');
  if (notPosted.length) {
    throw new ArchiveError(400, `Only published posts can be archived (post ${notPosted.map((p) => p.id).join(', ')} has not gone out)`,
      { notPosted: notPosted.map((p) => p.id) });
  }
  const todo = posts.filter((post) => !post.archivedAt).map((post) => post.id);
  const skipped = posts.filter((post) => post.archivedAt).map((post) => post.id);
  if (todo.length) {
    await db.run(`UPDATE post SET archivedAt = ? WHERE archivedAt IS NULL AND id IN (${placeholders(todo)})`, [clock.now().toISOString(), ...todo]);
  }
  const mediaIds = [...new Set(posts.filter((p) => todo.includes(p.id) && p.mediaId).map((p) => p.mediaId))];
  const images = await trashUnusedImages(db, mediaIds);
  if (todo.length) {
    await writeAudit(db, { userId, action: 'post.archive', entityType: 'post', entityId: todo.length === 1 ? todo[0] : null,
      summary: `Archived ${plural(todo.length, 'published post')} (post ${idList(todo)})`
        + `${images.trashed.length ? `; ${plural(images.trashed.length, 'image')} moved to Recently deleted` : ''}${note}` });
  }
  return { archived: todo, skipped, imagesTrashed: images.trashed, imagesKept: images.kept };
}

/**
 * Brings archived posts back to the Library's lists. Their images are not restored on their
 * own: one in Recently deleted can be restored on the Media page until it is purged.
 *
 * Usage:
 *   await unarchivePosts(db, [12], { userId: req.user.id });   // POST /api/archive/unarchive
 *
 * Returns:
 *   { unarchived: [postId], skipped: [postId] (were not archived), imagesInTrash: [mediaId] }.
 *   imagesInTrash lists their images still in Recently deleted (not yet purged to a small
 *   copy); those can still be restored on the Media page. Throws ArchiveError 404 for an unknown id.
 */
export async function unarchivePosts(db, ids, { userId = null } = {}) {
  const posts = await postsByIds(db, ids);
  const todo = posts.filter((post) => post.archivedAt).map((post) => post.id);
  const skipped = posts.filter((post) => !post.archivedAt).map((post) => post.id);
  if (todo.length) {
    await db.run(`UPDATE post SET archivedAt = NULL WHERE id IN (${placeholders(todo)})`, todo);
    await writeAudit(db, { userId, action: 'post.unarchive', entityType: 'post', entityId: todo.length === 1 ? todo[0] : null,
      summary: `Unarchived ${plural(todo.length, 'post')} (post ${idList(todo)})` });
  }
  const mediaIds = [...new Set(posts.filter((p) => todo.includes(p.id) && p.mediaId).map((p) => p.mediaId))];
  const inTrash = mediaIds.length
    ? await db.all(`SELECT id FROM media WHERE deletedAt IS NOT NULL AND archivedAt IS NULL AND id IN (${placeholders(mediaIds)}) ORDER BY id`, mediaIds)
    : [];
  return { unarchived: todo, skipped, imagesInTrash: inTrash.map((m) => m.id) };
}

/**
 * The words someone types to confirm a permanent delete.
 *
 * Usage:
 *   deleteConfirmText(12)   // -> 'delete 12 posts'; deleteConfirmText(1) -> 'delete 1 post'
 *
 * When editing:
 *   The Archive page shows these words for the user to type; deleteArchivedPosts compares
 *   them (trimmed, any case).
 */
export const deleteConfirmText = (count) => `delete ${count} post${count === 1 ? '' : 's'}`;

/**
 * Deletes archived posts for good, with their send history. Only archived posts; `confirm`
 * must be the typed words from deleteConfirmText. The small history copies (and earlier
 * "Kept for history" versions) of their images go too when no other post uses them; images
 * still in the library or in Recently deleted are left to the media flow. Calendar events of
 * these long-gone posts are left in Google Calendar (no Google calls here).
 *
 * Usage:
 *   await deleteArchivedPosts(db, ids, req.body.confirm, { userId });   // POST /api/archive/delete
 *
 * Takes:
 *   ids     - post ids (postIdsFrom)
 *   confirm - what the user typed
 *   userId  - who did it, for the audit log
 *
 * Returns:
 *   { deleted: [postId], imagesDeleted: [mediaId] }. Throws ArchiveError 404 for an unknown
 *   id, 400 { notArchived } when any post is not archived, 400 { confirmText } for wrong
 *   confirm words; nothing is deleted then.
 *
 * How it works:
 *   1. In one transaction: deletes the posts (their dispatch rows go with them, ON DELETE
 *      CASCADE; slots and notifications let go, SET NULL). Then, for each of their images that
 *      is only a small archived copy (media.archivedAt) and that no post uses any more: clears
 *      versionOfId on its earlier versions, deletes the media row, and notes its local file.
 *      Writes one audit entry.
 *   2. Removes the local files last, once the rows are gone for sure.
 *
 * When editing:
 *   This cannot be undone. The route also checks archivePosts on top of deletePosts.
 */
export async function deleteArchivedPosts(db, ids, confirm, { userId = null } = {}) {
  const posts = await postsByIds(db, ids);
  const notArchived = posts.filter((post) => !post.archivedAt);
  if (notArchived.length) {
    throw new ArchiveError(400, `Only archived posts can be deleted permanently (post ${notArchived.map((p) => p.id).join(', ')} is not archived)`,
      { notArchived: notArchived.map((p) => p.id) });
  }
  const expected = deleteConfirmText(posts.length);
  if (String(confirm ?? '').trim().toLowerCase() !== expected) {
    throw new ArchiveError(400, `Type "${expected}" to confirm`, { confirmText: expected });
  }
  const postIds = posts.map((p) => p.id);
  const mediaIds = [...new Set(posts.filter((p) => p.mediaId).map((p) => p.mediaId))];
  const files = [];
  const imagesDeleted = [];
  await db.transaction(async (tx) => {
    // Permanent: dispatch rows go too (ON DELETE CASCADE); slots and notifications SET NULL
    await tx.run(`DELETE FROM post WHERE id IN (${placeholders(postIds)})`, postIds);
    for (const mediaId of mediaIds) {
      const media = await tx.get('SELECT id, archivedAt, localPath FROM media WHERE id = ?', [mediaId]);
      if (!media?.archivedAt) continue;
      const { n } = await tx.get('SELECT COUNT(*) AS n FROM post WHERE mediaId = ?', [mediaId]);
      if (Number(n) > 0) continue;
      await tx.run('UPDATE media SET versionOfId = NULL WHERE versionOfId = ?', [mediaId]);
      await tx.run('DELETE FROM media WHERE id = ?', [mediaId]);
      if (media.localPath) files.push(media.localPath);
      imagesDeleted.push(mediaId);
    }
    await writeAudit(tx, { userId, action: 'post.deleteArchived', entityType: 'post', entityId: postIds.length === 1 ? postIds[0] : null,
      summary: `Permanently deleted ${plural(postIds.length, 'archived post')} (post ${idList(postIds)})`
        + `${imagesDeleted.length ? `; ${plural(imagesDeleted.length, 'small image copy', 'small image copies')} removed` : ''}` });
  });
  // Files last, once the rows are gone for sure
  for (const path of files) rmSync(path, { force: true });
  return { deleted: postIds, imagesDeleted };
}

/**
 * Reads ARCHIVE_AFTER_MONTHS, the switch for automatic archiving.
 *
 * Usage:
 *   const months = archiveAfterMonths();
 *
 * Returns:
 *   The number of months (a whole number, 1 or more), or null when it is unset, empty or not
 *   valid (a bad value is logged as a warning and counts as off).
 *
 * When editing:
 *   Read from process.env on every call, not from config.js; it is listed in the README's
 *   .env table.
 */
export function archiveAfterMonths() {
  const raw = process.env.ARCHIVE_AFTER_MONTHS;
  if (raw === undefined || String(raw).trim() === '') return null;
  const months = Number(raw);
  if (!Number.isInteger(months) || months < 1) {
    console.warn(`ARCHIVE_AFTER_MONTHS must be a whole number of months (1 or more), not "${raw}"; automatic archiving is off`);
    return null;
  }
  return months;
}

/**
 * Hook for automatic archiving. No retention period has been chosen yet, so this
 * is OFF unless ARCHIVE_AFTER_MONTHS is set. When set (a whole
 * number of months), published posts older than that are archived (never deleted), once a
 * day from index.js.
 *
 * Usage:
 *   autoArchive(db).catch(...)   // index.js, at startup and every autoArchiveCheckMs
 *
 * Takes:
 *   now - a Date; the app clock by default
 *
 * Returns:
 *   null when off, else archivePosts' result (empty lists when nothing is old enough).
 *
 * When editing:
 *   It only ever archives. Never make it delete unless deleting is explicitly decided.
 */
export async function autoArchive(db, now = clock.now()) {
  const months = archiveAfterMonths();
  if (!months) return null;
  const rows = await db.all(`SELECT post.id FROM post WHERE post.status = 'posted' AND post.archivedAt IS NULL AND ${POSTED_AT} < ? ORDER BY post.id`,
    [cutoffFor(months, now)]);
  if (!rows.length) return { archived: [], skipped: [], imagesTrashed: [], imagesKept: [] };
  return archivePosts(db, rows.map((r) => r.id), { note: ` automatically (ARCHIVE_AFTER_MONTHS=${months})` });
}
