/**
 * "Recently deleted" for the media library: a deleted image is kept for a few days so it can
 * be restored, then purged. While it waits, the server holds a copy of the file in
 * media-trash/ (next to the local media folder) and Drive holds the file in its trash.
 * Purging an image that posts already published used keeps a small JPEG in media-archive/,
 * so those posts' history still shows it (it can't bring back the full-quality image).
 * Rotating an image that published posts used keeps the version they went out with (full
 * quality) the same way, as a "Kept for history" row (keepVersionForPosted below).
 *
 * What lives here: trashMedia, restoreMedia, purgeExpiredMedia (the trash flow),
 * keepVersionForPosted and undoKeptVersion (rotation history), trashDays, purgeInfo, the
 * folders (localMediaDir, trashDir, archiveDir), pendingPostsUsing, postedPostsUsing and
 * MediaError.
 *
 * When editing:
 *   A media row is in one of these states: in the library (deletedAt null), in Recently
 *   deleted (deletedAt set, archivedAt null), or a small history copy or kept version
 *   (archivedAt set; archiveNote set for kept versions). Queries elsewhere rely on that.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { config } from '../config.js';
import { clock } from './clock.js';
import { driveDeleter, driveDownloader, driveTrasher, driveUploader, isNotFound } from './googleDrive.js';
import { lowResJpeg } from './imageConvert.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Days a deleted image can still be restored (env MEDIA_TRASH_DAYS).
 * The default of 7 is a placeholder until the window is confirmed.
 *
 * Usage:
 *   res.set('X-Trash-Days', String(trashDays()));   // routes/media.js
 *
 * Returns:
 *   MEDIA_TRASH_DAYS as a number (0 or more; may have decimals), or 7 when it is unset or
 *   not valid.
 *
 * When editing:
 *   Read from process.env on every call, not from config.js. The purge uses it too, so a
 *   shorter window purges images already waiting on the next tick.
 */
export function trashDays() {
  const days = Number(process.env.MEDIA_TRASH_DAYS ?? 7);
  return Number.isFinite(days) && days >= 0 ? days : 7;
}

/**
 * A media folder next to the database file (the data folder), made if missing: media/,
 * media-trash/ or media-archive/. In-memory test databases use the OS temp dir instead.
 *
 * Takes:
 *   suffix - '' (uploads), '-trash' or '-archive'
 */
function mediaFolder(suffix = '') {
  const base = config.dbPath === ':memory:' ? join(tmpdir(), 'ctr-scheduler-media') : resolve(dirname(config.dbPath), 'media');
  const dir = `${base}${suffix}`;
  mkdirSync(dir, { recursive: true });
  return dir;
}
/** Where uploads are stored when Drive isn't configured. */
export const localMediaDir = () => mediaFolder();
/** Copies of deleted images while they can still be restored. */
export const trashDir = () => mediaFolder('-trash');
/** Low-resolution copies kept for published posts' history. */
export const archiveDir = () => mediaFolder('-archive');

/**
 * When a deleted image is purged, and how many days that is from now (app clock).
 *
 * Usage:
 *   purgeInfo(media.archivedAt ? null : media.deletedAt)   // routes/media.js
 *
 * Takes:
 *   deletedAt - the ISO time it was deleted, or null
 *   now       - a Date; the app clock by default
 *
 * Returns:
 *   { purgeAt (ISO), daysLeft (whole days rounded up, never below 0) }, or both null when
 *   deletedAt is empty.
 */
export function purgeInfo(deletedAt, now = clock.now()) {
  if (!deletedAt) return { purgeAt: null, daysLeft: null };
  const purgeAt = new Date(new Date(deletedAt).getTime() + trashDays() * DAY_MS);
  return { purgeAt: purgeAt.toISOString(), daysLeft: Math.max(0, Math.ceil((purgeAt - now) / DAY_MS)) };
}

/**
 * Posts that haven't gone out yet (queued, sending, failed); they block deleting and purging.
 *
 * Usage:
 *   const usedBy = await pendingPostsUsing(db, media.id);   // DELETE /api/media/:id
 *
 * Returns:
 *   A promise for [{ postId, platformId, caption, status }], by id.
 */
export const pendingPostsUsing = (db, mediaId) => db.all(`
  SELECT id AS postId, platformId, caption, status FROM post
  WHERE mediaId = ? AND status <> 'posted' ORDER BY id`, [mediaId]);

// Moves a file, copying then removing when rename can't (another disk)
function moveFile(from, to) {
  try {
    renameSync(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    copyFileSync(from, to);
    rmSync(from, { force: true });
  }
}

/**
 * An error with an HTTP status for the route to send back.
 *
 * Usage:
 *   throw new MediaError(502, 'Google Drive is not configured, so the file could not be deleted');
 *
 * When editing:
 *   routes/media.js answers { error: message } with this status; any other error is a 500.
 */
export class MediaError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Sends an image to Recently deleted: keeps a copy on the server, moves the Drive file to
 * Drive's trash (or the local file into the trash folder) and sets deletedAt.
 * The caller has already checked that no pending post uses it.
 *
 * Usage:
 *   await trashMedia(db, media);   // DELETE /api/media/:id, and archiving (services/archive.js)
 *
 * Takes:
 *   media - the media row
 *
 * Returns:
 *   Nothing. Throws MediaError 502 when Drive is not configured, cannot send the file to keep
 *   a copy, or cannot trash it; the row is unchanged then.
 *
 * How it works:
 *   Drive: downloads the file into media-trash/ (a file already gone from Drive leaves
 *   nothing to keep, but the row can still go to Recently deleted), then trashes it in Drive;
 *   if that fails, the copy is removed again. Local: moves the file into media-trash/.
 *   Then sets deletedAt (app clock) and trashPath (null when no copy was kept).
 *
 * When editing:
 *   The copy is made before Drive's trash call on purpose: restore needs it if Drive empties
 *   its trash.
 */
export async function trashMedia(db, media) {
  const trashPath = join(trashDir(), `${media.id}-${media.sha256 ?? 'file'}.jpg`);
  let savedCopy = false;
  if (media.storage === 'drive' && media.driveFileId) {
    const download = driveDownloader();
    const trash = driveTrasher();
    if (!download || !trash) throw new MediaError(502, 'Google Drive is not configured, so the file could not be deleted');
    try {
      writeFileSync(trashPath, await download(media.driveFileId));
      savedCopy = true;
    } catch (err) {
      // Already gone from Drive: nothing to keep, the row still goes
      if (!isNotFound(err)) {
        console.error('Drive download before delete failed:', err);
        throw new MediaError(502, `Google Drive could not send the file to keep a copy: ${err.message}`);
      }
    }
    try {
      await trash(media.driveFileId, true);
    } catch (err) {
      if (!isNotFound(err)) {
        rmSync(trashPath, { force: true });
        console.error('Drive trash failed:', err);
        throw new MediaError(502, `Google Drive could not delete the file: ${err.message}`);
      }
    }
  } else if (media.localPath && existsSync(media.localPath)) {
    moveFile(media.localPath, trashPath);
    savedCopy = true;
  }
  await db.run('UPDATE media SET deletedAt = ?, trashPath = ? WHERE id = ?',
    [clock.now().toISOString(), savedCopy ? trashPath : null, media.id]);
}

/**
 * Brings an image back from Recently deleted. Drive: untrash the file; if Drive no longer
 * has it, upload the saved copy again (new id and link on the row; posts read the link from
 * the row, so they follow). Local: move the copy back.
 *
 * Usage:
 *   await restoreMedia(db, media);   // POST /api/media/:id/restore, and a repeat upload
 *
 * Takes:
 *   media - the media row
 *
 * Returns:
 *   Nothing. Throws MediaError: 409 not in Recently deleted; 410 a kept earlier version, an
 *   image already purged to a small copy, or no file left anywhere; 502 Drive not configured
 *   or refusing.
 *
 * How it works:
 *   After the file is back, removes the server's copy and clears deletedAt and trashPath.
 */
export async function restoreMedia(db, media) {
  if (!media.deletedAt) throw new MediaError(409, 'This image is not in Recently deleted');
  if (media.archivedAt && media.archiveNote) {
    throw new MediaError(410, 'This is an earlier version of an image, kept for the history of posts that already went out. It cannot be restored.');
  }
  if (media.archivedAt) {
    throw new MediaError(410, 'This image was permanently deleted. Only a low-resolution copy is kept for the history of posts that used it.');
  }
  const copy = media.trashPath && existsSync(media.trashPath) ? media.trashPath : null;

  if (media.storage === 'drive' && media.driveFileId) {
    const trash = driveTrasher();
    if (!trash) throw new MediaError(502, 'Google Drive is not configured, so the file could not be restored');
    try {
      await trash(media.driveFileId, false);
    } catch (err) {
      if (!isNotFound(err)) {
        console.error('Drive restore failed:', err);
        throw new MediaError(502, `Google Drive could not restore the file: ${err.message}`);
      }
      // Drive emptied its trash: upload the server's copy as a new file
      const upload = driveUploader();
      if (!copy) throw new MediaError(410, 'Google Drive no longer has this image and the server has no copy, so it cannot be restored');
      if (!upload) throw new MediaError(502, 'Google Drive is not configured, so the image could not be uploaded again');
      let file;
      try {
        file = await upload(readFileSync(copy), { name: media.name, mimeType: media.mimeType });
      } catch (uploadErr) {
        console.error('Drive re-upload failed:', uploadErr);
        throw new MediaError(502, `Google Drive rejected the upload: ${uploadErr.message}`);
      }
      await db.run('UPDATE media SET driveFileId = ?, link = ? WHERE id = ?', [file.id, file.webViewLink, media.id]);
    }
  } else if (media.storage === 'local') {
    if (!copy) throw new MediaError(410, 'The server no longer has this image, so it cannot be restored');
    const localPath = media.localPath ?? join(localMediaDir(), `${media.sha256 ?? media.id}.jpg`);
    moveFile(copy, localPath);
    await db.run('UPDATE media SET localPath = ? WHERE id = ?', [localPath, media.id]);
  }
  if (copy) rmSync(copy, { force: true });
  await db.run('UPDATE media SET deletedAt = NULL, trashPath = NULL WHERE id = ?', [media.id]);
}

/**
 * Purges one image whose restore window has passed.
 *
 * Returns:
 *   'purged' (row and files gone), 'archived' (a small copy kept for published posts) or
 *   'skipped' (a pending post still points at it, Drive is not configured, or Drive refused;
 *   it is tried again on the next tick).
 *
 * How it works:
 *   1. Skips it while a post that has not gone out uses it.
 *   2. If published posts used it, makes the small copy first, while the full image is still
 *      around (from the server's copy, else from Drive). A failed copy is only logged.
 *   3. Deletes the Drive file for good (a 404 counts as done) and the server's copy.
 *   4. With a small copy: writes it to media-archive/<id>.jpg and turns the row into a local
 *      history row (archivedAt set, link /api/media/<id>/file). It keeps no hashes, so a new
 *      upload of the same image makes a new row.
 *      Without one: in one transaction, posts let go of it, earlier versions stop naming it
 *      (they stay for their posts), and the row is deleted.
 *
 * When editing:
 *   Permanent: the full image cannot come back after this. Keep the pending-post check first.
 */
async function purgeOne(db, media) {
  const pending = await pendingPostsUsing(db, media.id);
  if (pending.length) {
    console.warn(`Not purging image ${media.id}: ${pending.length} post(s) that have not gone out still use it`);
    return 'skipped';
  }
  const posted = await db.get("SELECT COUNT(*) AS count FROM post WHERE mediaId = ? AND status = 'posted'", [media.id]);

  // The small copy first, while the full image is still around
  let lowRes = null;
  if (posted.count > 0) {
    let source = media.trashPath && existsSync(media.trashPath) ? readFileSync(media.trashPath) : null;
    if (!source && media.storage === 'drive' && media.driveFileId && driveDownloader()) {
      source = await driveDownloader()(media.driveFileId).catch(() => null);
    }
    if (source) {
      try {
        lowRes = await lowResJpeg(source);
      } catch (err) {
        console.error(`Low-resolution copy of image ${media.id} failed:`, err);
      }
    }
  }

  if (media.storage === 'drive' && media.driveFileId) {
    const remove = driveDeleter();
    if (!remove) {
      console.warn(`Not purging image ${media.id}: Google Drive is not configured`);
      return 'skipped';
    }
    try {
      await remove(media.driveFileId); // ignores 404
    } catch (err) {
      console.error(`Drive could not permanently delete image ${media.id}:`, err);
      return 'skipped';
    }
  }
  if (media.trashPath) rmSync(media.trashPath, { force: true });

  if (lowRes) {
    const localPath = join(archiveDir(), `${media.id}.jpg`);
    writeFileSync(localPath, lowRes.buffer);
    // No hashes, so a new upload of the same image makes a new row
    await db.run(`UPDATE media SET archivedAt = ?, storage = 'local', driveFileId = NULL, localPath = ?, trashPath = NULL,
                    link = ?, mimeType = 'image/jpeg', width = ?, height = ?, sizeBytes = ?, sha256 = NULL, originalSha256 = NULL
                  WHERE id = ?`,
    [clock.now().toISOString(), localPath, `/api/media/${media.id}/file`, lowRes.width, lowRes.height, lowRes.buffer.length, media.id]);
    return 'archived';
  }
  await db.transaction(async (tx) => {
    await tx.run('UPDATE post SET mediaId = NULL WHERE mediaId = ?', [media.id]);
    // Earlier versions stay for their posts; they just no longer name this image
    await tx.run('UPDATE media SET versionOfId = NULL WHERE versionOfId = ?', [media.id]);
    await tx.run('DELETE FROM media WHERE id = ?', [media.id]);
  });
  return 'purged';
}

/**
 * Purges every image whose restore window ended by `now` (app clock).
 *
 * Usage:
 *   await purgeExpiredMedia(db);   // the scheduler tick (routes/system.js)
 *
 * Returns:
 *   { purged, archived, skipped } counts. An image whose purge throws is logged and counted as
 *   skipped, so one bad image never stops the rest.
 */
export async function purgeExpiredMedia(db, now = clock.now()) {
  const cutoff = new Date(now.getTime() - trashDays() * DAY_MS).toISOString();
  const due = await db.all('SELECT * FROM media WHERE deletedAt IS NOT NULL AND archivedAt IS NULL AND deletedAt <= ? ORDER BY id', [cutoff]);
  const counts = { purged: 0, archived: 0, skipped: 0 };
  for (const media of due) {
    try {
      counts[await purgeOne(db, media)] += 1;
    } catch (err) {
      console.error(`Purging image ${media.id} failed:`, err);
      counts.skipped += 1;
    }
  }
  return counts;
}

/**
 * Posts that already went out with this image.
 *
 * Returns:
 *   A promise for [{ id }], by id.
 */
export const postedPostsUsing = (db, mediaId) => db.all(
  "SELECT id FROM post WHERE mediaId = ? AND status = 'posted' ORDER BY id", [mediaId]);

/**
 * Before an image is changed in place (rotated), keeps the version that published posts went
 * out with: a server-side copy of `buffer` (the current file, full quality) in a new "Kept
 * for history" row, and those posts point at it. Posts still waiting keep the image itself.
 *
 * Usage:
 *   const kept = await keepVersionForPosted(db, media, current, `Version before rotation on ${day}`);
 *   // ...rotate; on failure: await undoKeptVersion(db, media, kept);
 *
 * Takes:
 *   media  - the media row about to change
 *   buffer - its current bytes
 *   note   - the archiveNote shown on the kept row
 *
 * Returns:
 *   null when no published post uses the image (nothing done); otherwise { id, postIds, path }
 *   for undoKeptVersion. Throws on failure, after removing any file it wrote.
 *
 * How it works:
 *   In one transaction: inserts the new row (local, deletedAt and archivedAt set, versionOfId
 *   = the image, the image's original details and createdAt), writes the file to
 *   media-archive/<new id>.jpg (named by its own id, like the low-resolution copies), sets
 *   its localPath and link, and moves the published posts onto it.
 *
 * When editing:
 *   The new row has no hashes, so uploads and rotations never match it; deletedAt keeps it
 *   out of the library. lastInsertRowid works on both SQLite and MariaDB (db/client.js).
 */
export async function keepVersionForPosted(db, media, buffer, note) {
  const postIds = (await postedPostsUsing(db, media.id)).map((p) => p.id);
  if (!postIds.length) return null;
  const now = clock.now().toISOString();
  let path = null;
  try {
    const id = await db.transaction(async (tx) => {
      // No hashes (never matched by uploads); deletedAt keeps it out of the library
      const { lastInsertRowid } = await tx.run(`
        INSERT INTO media (storage, name, mimeType, width, height, sizeBytes,
          originalMimeType, originalWidth, originalHeight, originalSizeBytes, exifOrientation, rotation,
          deletedAt, archivedAt, archiveNote, versionOfId, createdAt)
        VALUES ('local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [media.name, media.mimeType ?? 'image/jpeg', media.width, media.height, buffer.length,
        media.originalMimeType, media.originalWidth, media.originalHeight, media.originalSizeBytes,
        media.exifOrientation, media.rotation ?? 0, now, now, note, media.id, media.createdAt]);
      path = join(archiveDir(), `${lastInsertRowid}.jpg`);
      writeFileSync(path, buffer);
      await tx.run('UPDATE media SET localPath = ?, link = ? WHERE id = ?', [path, `/api/media/${lastInsertRowid}/file`, lastInsertRowid]);
      await tx.run(`UPDATE post SET mediaId = ? WHERE mediaId = ? AND status = 'posted' AND id IN (${postIds.map(() => '?').join(', ')})`,
        [lastInsertRowid, media.id, ...postIds]);
      return lastInsertRowid;
    });
    return { id, postIds, path };
  } catch (err) {
    if (path) rmSync(path, { force: true });
    throw err;
  }
}

/**
 * Puts things back when the change that keepVersionForPosted prepared for failed: the posts
 * point at the image again, and the kept row and its file are removed.
 *
 * Usage:
 *   await undoKeptVersion(db, media, kept);   // kept may be null (does nothing)
 */
export async function undoKeptVersion(db, media, kept) {
  if (!kept) return;
  await db.transaction(async (tx) => {
    await tx.run('UPDATE post SET mediaId = ? WHERE mediaId = ?', [media.id, kept.id]);
    await tx.run('DELETE FROM media WHERE id = ?', [kept.id]);
  });
  rmSync(kept.path, { force: true });
}
