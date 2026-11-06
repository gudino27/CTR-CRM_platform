/**
 * Image routes (/api/media): upload, the Media page's library, one image, its file, the
 * platform check, delete to Recently deleted, restore, and rotate.
 *
 * Uploads are turned into JPEGs (services/imageConvert.js) and stored on Google Drive when it is
 * configured, otherwise on the server (localMediaDir). Recently deleted, purging and the
 * "Kept for history" copies are in services/mediaTrash.js.
 *
 * Permissions (ROUTES in services/permissions.js, which also writes the audit entries): GETs need
 * any signed-in user; upload and rotate uploadMedia; delete and restore deleteMedia. An upload
 * that would bring an image back from Recently deleted is for super admins only (checked here).
 *
 * What lives here:
 *   conversionOf  what was uploaded next to what is stored
 *   mediaRouter   the routes
 */
import express, { Router } from 'express';
import { createHash } from 'node:crypto';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { driveDownloader, driveUpdater, driveUploader } from '../services/googleDrive.js';
import { jpegName, rotateJpeg, toJpeg } from '../services/imageConvert.js';
import { extensions, imageInfo } from '../services/imageInfo.js';
import { checkImage } from '../services/imageRules.js';
import { config } from '../config.js';
import { clock } from '../services/clock.js';
import { serialized } from '../services/lock.js';
import { can } from '../services/permissions.js';
import {
  keepVersionForPosted, localMediaDir, MediaError, pendingPostsUsing, purgeInfo, restoreMedia, trashDays, trashMedia, undoKeptVersion,
} from '../services/mediaTrash.js';

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
// "Nov 3, 2026" in the app's time zone
const dayLabel = (date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: config.timezone });

/**
 * What was uploaded next to what is stored, for the Compose before/after preview.
 *
 * Usage:
 *   conversionOf(mediaRow).converted   // true when a PNG/WebP became a JPEG
 *
 * Takes:
 *   media - a media row
 *
 * Returns:
 *   { converted, originalMimeType, originalWidth, originalHeight, originalSizeBytes,
 *     mimeType, width, height, sizeBytes, rotatedFromExif, exifOrientation, rotation }
 *   converted       - the stored file differs from the upload. Rows from before conversion have
 *                     no original hash; they were stored as uploaded, so the original* values
 *                     fall back to the stored ones.
 *   rotatedFromExif - a JPEG the camera stored sideways (EXIF orientation other than 1) was
 *                     re-saved upright on upload
 *   rotation        - degrees turned by hand since upload (POST /:id/rotate), clockwise
 */
export function conversionOf(media) {
  return {
    converted: media.originalSha256 != null && media.originalSha256 !== media.sha256,
    originalMimeType: media.originalMimeType ?? media.mimeType,
    originalWidth: media.originalWidth ?? media.width,
    originalHeight: media.originalHeight ?? media.height,
    originalSizeBytes: media.originalSizeBytes ?? media.sizeBytes,
    mimeType: media.mimeType,
    width: media.width,
    height: media.height,
    sizeBytes: media.sizeBytes,
    rotatedFromExif: media.originalMimeType === 'image/jpeg' && media.exifOrientation != null && media.exifOrientation !== 1,
    exifOrientation: media.exifOrientation ?? null,
    rotation: media.rotation ?? 0,
  };
}
// When a deleted image is purged (purgeAt, daysLeft; null while it is in the library).
// Archived copies are already purged, so they have none.
const purgeOf = (media) => purgeInfo(media.archivedAt ? null : media.deletedAt);
// A media row as the API sends it: the row, its conversion, and its purge info
const withConversion = (media) => ({ ...media, conversion: conversionOf(media), ...purgeOf(media) });

// A MediaError becomes its status and message; anything else is a real error
const sendError = (res, err) => {
  if (err instanceof MediaError) return res.status(err.status).json({ error: err.message });
  throw err;
};

/**
 * The /api/media router.
 *
 * Usage:
 *   app.use('/api/media', mediaRouter(db));   (app.js, before express.json)
 *
 * Takes:
 *   db - the open database
 *
 * Returns:
 *   An Express router with the routes below. Single images come back as withConversion(row).
 *
 * When editing:
 *   This router is mounted before express.json so uploads keep their raw body; a route here
 *   that takes JSON adds express.json() itself (see rotate).
 */
export function mediaRouter(db) {
  const router = Router();
  const byId = (id) => db.get('SELECT * FROM media WHERE id = ?', [id]);

  // Upload or original matches, so re-uploading the same PNG doesn't make a second JPEG
  const bySha = (hash) => db.get('SELECT * FROM media WHERE sha256 = ? OR originalSha256 = ? ORDER BY id LIMIT 1', [hash, hash]);

  /**
   * POST /api/media: uploads an image. Needs uploadMedia.
   *
   * Usage:
   *   POST /api/media?name=spring.png   (body: the raw file, up to 10 MB)
   *
   * Takes:
   *   body       - the file itself: JPEG, PNG or WebP
   *   query.name - the original filename (default "image.<ext>"), cut to 255 characters
   *
   * Returns:
   *   201 with the new image; 200 with the existing one when the same file (or one that converts
   *   to the same JPEG) was uploaded before; 400 empty, unsupported or unreadable file;
   *   409 { error, mediaId } when that image is in Recently deleted and the uploader is not a
   *   super admin (nothing is restored or added); 502 when Google Drive rejects the upload.
   *
   * How it works:
   *   1. Recognizes the type from the bytes (imageInfo).
   *   2. The same file again reuses its row. One waiting in Recently deleted comes back, since
   *      uploading it again says it is wanted (same id and Drive link as before), but only for a
   *      super admin, anyone else gets the 409.
   *   3. Converts to JPEG (toJpeg); a different original that converts to the same JPEG (rare)
   *      reuses that row too. A converted file's name ends in .jpg (jpegName).
   *   4. Stores the JPEG on Drive when configured, otherwise in localMediaDir with the link
   *      /api/media/:id/file. Both the stored and the original size, type and hash are kept.
   *
   * When editing:
   *   The platform rules (imageRules in settings.js) only warn; an upload is never refused for them.
   */
  router.post('/', express.raw({ type: () => true, limit: '10mb' }), async (req, res) => {
    const original = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (original.length === 0) return res.status(400).json({ error: 'The image file is empty' });
    const info = imageInfo(original);
    if (!info) return res.status(400).json({ error: 'Only JPEG, PNG and WebP images are supported' });

    const reuse = async (media) => {
      // Only super admins bring an image back by uploading it; others ask one (no restore, no new copy)
      if (media.deletedAt && !(await can(db, req.user, 'superAdmin'))) {
        return res.status(409).json({ error: 'This image is in Recently deleted. Ask a super admin to bring it back.', mediaId: media.id });
      }
      if (media.deletedAt) await restoreMedia(db, media);
      return res.json(withConversion(await byId(media.id)));
    };

    const originalSha256 = sha(original);
    const existing = await bySha(originalSha256);
    if (existing) return reuse(existing).catch((err) => sendError(res, err));

    let jpeg;
    try {
      jpeg = await toJpeg(original, info);
    } catch (err) {
      console.error('Image conversion failed:', err);
      return res.status(400).json({ error: 'The image could not be read. Try saving it again as a JPEG or PNG.' });
    }
    const buffer = jpeg.buffer;
    const sha256 = jpeg.converted ? sha(buffer) : originalSha256;
    const sameJpeg = jpeg.converted ? await bySha(sha256) : null;
    if (sameJpeg) return reuse(sameJpeg).catch((err) => sendError(res, err));

    const uploadedName = String(req.query.name || `image.${extensions[info.mimeType]}`).slice(0, 255);
    const name = jpeg.converted ? jpegName(uploadedName) : uploadedName;
    const insert = (...values) => db.run(`
      INSERT INTO media (storage, driveFileId, link, localPath, name, mimeType, width, height, sizeBytes, sha256,
        originalMimeType, originalWidth, originalHeight, originalSizeBytes, originalSha256, exifOrientation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, values);
    const stored = [name, jpeg.mimeType, jpeg.width, jpeg.height, buffer.length, sha256,
      info.mimeType, info.width, info.height, original.length, originalSha256, jpeg.exifOrientation];

    const upload = driveUploader();
    if (upload) {
      let file;
      try {
        file = await upload(buffer, { name, mimeType: jpeg.mimeType });
      } catch (err) {
        // Most often a refresh token without the drive.file scope, or no access to the folder
        console.error('Drive upload failed:', err);
        return res.status(502).json({ error: `Google Drive rejected the upload: ${err.message}` });
      }
      const { lastInsertRowid } = await insert('drive', file.id, file.webViewLink, null, ...stored);
      return res.status(201).json(withConversion(await byId(lastInsertRowid)));
    }

    const localPath = join(localMediaDir(), `${sha256}.${extensions[jpeg.mimeType]}`);
    writeFileSync(localPath, buffer);
    const { lastInsertRowid } = await insert('local', null, null, localPath, ...stored);
    await db.run('UPDATE media SET link = ? WHERE id = ?', [`/api/media/${lastInsertRowid}/file`, lastInsertRowid]);
    res.status(201).json(withConversion(await byId(lastInsertRowid)));
  });

  /**
   * GET /api/media/:id: one image's row. Any signed-in user.
   *
   * Usage:
   *   GET /api/media/7
   *
   * Returns:
   *   200 with withConversion(row); 404 unknown.
   */
  router.get('/:id', async (req, res) => {
    const media = await byId(req.params.id);
    if (!media) return res.status(404).json({ error: 'Image not found' });
    res.json(withConversion(media));
  });

  /**
   * DELETE /api/media/:id: moves an image to Recently deleted. Needs deleteMedia.
   *
   * Usage:
   *   DELETE /api/media/7
   *
   * Returns:
   *   204; 404 unknown or already deleted; 409 { error, usedBy } when posts that haven't gone out
   *   yet use it (they still need their image); 502 when Google Drive is not configured or fails.
   *
   * How it works:
   *   trashMedia (services/mediaTrash.js) keeps a server copy; the image can be restored until it
   *   is purged after trashDays days. Posted posts keep pointing at it meanwhile.
   */
  router.delete('/:id', async (req, res) => {
    const media = await byId(req.params.id);
    if (!media || media.deletedAt) return res.status(404).json({ error: 'Image not found' });
    // Posts still waiting to go out block the delete
    const usedBy = await pendingPostsUsing(db, media.id);
    if (usedBy.length) {
      const count = usedBy.length === 1 ? '1 post that has' : `${usedBy.length} posts that have`;
      return res.status(409).json({
        error: `This image is used by ${count} not been posted yet. Change their image or delete them first.`,
        usedBy,
      });
    }
    try {
      await trashMedia(db, media);
    } catch (err) {
      return sendError(res, err);
    }
    res.status(204).end();
  });

  /**
   * POST /api/media/:id/restore: brings an image back from Recently deleted, with the same id
   * (and the same Drive link, when Drive still has the file). Needs deleteMedia.
   *
   * Usage:
   *   POST /api/media/7/restore
   *
   * Returns:
   *   200 with the image; 404 unknown; a MediaError's status otherwise: 409 not in Recently
   *   deleted, 410 purged or a history copy, 502 Google Drive not configured or failed.
   */
  router.post('/:id/restore', async (req, res) => {
    const media = await byId(req.params.id);
    if (!media) return res.status(404).json({ error: 'Image not found' });
    try {
      await restoreMedia(db, media);
    } catch (err) {
      return sendError(res, err);
    }
    res.json(withConversion(await byId(media.id)));
  });

  /**
   * POST /api/media/:id/rotate: turns the stored JPEG clockwise and replaces the file in place.
   * Needs uploadMedia.
   *
   * Usage:
   *   POST /api/media/7/rotate  { degrees: 90 }
   *
   * Takes:
   *   body.degrees - 90, 180 or 270
   *
   * Returns:
   *   200 { ...the image, keptVersion }; keptVersion is { mediaId, postIds }, the history copy
   *   published posts now use, or null when none had gone out.
   *   400 bad degrees or unreadable image; 404 unknown or file missing; 409 a history copy, an
   *   image in Recently deleted, a post with it being sent right now, or the rotated image is the
   *   same as another image ({ mediaId }); 502 Drive not configured or Drive failed.
   *
   * How it works:
   *   1. Reads the current file (Drive or local) and rotates it (rotateJpeg).
   *   2. Posts that already went out keep the image as it was when they were published: the
   *      current version is first copied to a "Kept for history" row and those posts move to it
   *      (keepVersionForPosted in services/mediaTrash.js).
   *   3. Replaces the file: the Drive file keeps its id and link (posts waiting to go out and
   *      their calendar events keep working and get the rotated picture); a local file is
   *      overwritten. If that fails, the history copy is undone.
   *   4. Updates size, hash and rotation; the original* columns keep describing the upload.
   *
   * When editing:
   *   Runs one at a time with sending and calendar sync (serialized), so no post changes status
   *   midway. A post being sent right now blocks the rotation, since it is unclear which version
   *   it goes out with.
   */
  router.post('/:id/rotate', express.json(), (req, res) => serialized(() => rotate(req, res)));

  async function rotate(req, res) {
    const degrees = Number(req.body?.degrees);
    if (![90, 180, 270].includes(degrees)) return res.status(400).json({ error: 'degrees must be 90, 180 or 270' });
    const media = await byId(req.params.id);
    if (!media) return res.status(404).json({ error: 'Image not found' });
    if (media.archivedAt) return res.status(409).json({ error: 'Images kept for history cannot be rotated' });
    if (media.deletedAt) return res.status(409).json({ error: 'Restore this image before rotating it' });
    const sending = await db.all("SELECT id FROM post WHERE mediaId = ? AND status = 'sending' ORDER BY id", [media.id]);
    if (sending.length) {
      return res.status(409).json({
        error: `Post ${sending.map((p) => p.id).join(', ')} with this image is being sent right now. Try again in a minute.`,
        sending: sending.map((p) => p.id),
      });
    }

    let current;
    try {
      if (media.storage === 'drive') {
        const download = driveDownloader();
        if (!download || !driveUpdater()) return res.status(502).json({ error: 'Google Drive is not configured, so the image could not be rotated' });
        current = await download(media.driveFileId);
      } else {
        if (!media.localPath || !existsSync(media.localPath)) return res.status(404).json({ error: 'Image file is missing' });
        current = readFileSync(media.localPath);
      }
    } catch (err) {
      console.error('Reading the image to rotate failed:', err);
      return res.status(502).json({ error: `Google Drive could not send the image: ${err.message}` });
    }

    let turned;
    try {
      turned = await rotateJpeg(current, degrees);
    } catch (err) {
      console.error('Rotation failed:', err);
      return res.status(400).json({ error: 'The image could not be read, so it was not rotated' });
    }
    const sha256 = sha(turned.buffer);
    const twin = await db.get('SELECT id FROM media WHERE sha256 = ? AND id <> ?', [sha256, media.id]);
    if (twin) return res.status(409).json({ error: `Rotated, this image is the same as image ${twin.id}. Use that one instead.`, mediaId: twin.id });

    // Published posts first move to a copy of the version they went out with
    const kept = await keepVersionForPosted(db, media, current, `Version before rotation on ${dayLabel(clock.now())}`);
    try {
      if (media.storage === 'drive') {
        try {
          await driveUpdater()(media.driveFileId, turned.buffer, { mimeType: 'image/jpeg' });
        } catch (err) {
          console.error('Drive update failed:', err);
          await undoKeptVersion(db, media, kept);
          return res.status(502).json({ error: `Google Drive rejected the rotated image: ${err.message}` });
        }
      } else {
        writeFileSync(media.localPath, turned.buffer);
      }
    } catch (err) {
      await undoKeptVersion(db, media, kept);
      throw err;
    }
    await db.run('UPDATE media SET mimeType = ?, width = ?, height = ?, sizeBytes = ?, sha256 = ?, rotation = ? WHERE id = ?',
      ['image/jpeg', turned.width, turned.height, turned.buffer.length, sha256, ((media.rotation ?? 0) + degrees) % 360, media.id]);
    res.json({ ...withConversion(await byId(media.id)), keptVersion: kept ? { mediaId: kept.id, postIds: kept.postIds } : null });
  }

  /**
   * GET /api/media/:id/file: the image file itself. Any signed-in user.
   *
   * Usage:
   *   <img src="/api/media/7/file?inline=1">
   *
   * Takes:
   *   query.inline - for Drive images: stream the bytes (for <img> thumbnails) instead of
   *                  sending people to Drive
   *
   * Returns:
   *   The file; a 302 to the Drive link (without inline, or when the download fails);
   *   404 unknown or file missing.
   *
   * How it works:
   *   An image in Recently deleted is served from the server's copy, so history and the restore
   *   list still show it.
   */
  router.get('/:id/file', async (req, res) => {
    const media = await byId(req.params.id);
    if (!media) return res.status(404).json({ error: 'Image not found' });
    if (media.deletedAt && !media.archivedAt) {
      if (!media.trashPath || !existsSync(media.trashPath)) return res.status(404).json({ error: 'Image file is missing' });
      return res.type(media.mimeType).sendFile(media.trashPath);
    }
    if (media.storage === 'drive') {
      const download = req.query.inline ? driveDownloader() : null;
      if (!download) return res.redirect(302, media.link);
      try {
        return res.type(media.mimeType).send(await download(media.driveFileId));
      } catch (err) {
        console.error('Drive download failed:', err);
        return res.redirect(302, media.link);
      }
    }
    if (!media.localPath || !existsSync(media.localPath)) return res.status(404).json({ error: 'Image file is missing' });
    res.type(media.mimeType).sendFile(media.localPath);
  });

  /**
   * GET /api/media: the Media page's listing, with the posts that use each image.
   * Any signed-in user.
   *
   * Usage:
   *   GET /api/media?search=spring&limit=50&offset=0
   *   GET /api/media?view=deleted
   *
   * Takes:
   *   view   - default the library itself (newest first); "deleted" lists Recently deleted
   *            (soonest purge first); "archived" the low-resolution copies kept for published
   *            posts' history
   *   search - optional, part of the name (any letter case)
   *   limit  - default 50, 1 to 200; offset - default 0
   *
   * Returns:
   *   200 [{ id, name, mimeType, width, height, sha256, createdAt, deletedAt, archivedAt,
   *          archiveNote, versionOfId, link, usedBy: [{ postId, platformId, caption }], purgeAt,
   *          daysLeft }]
   *   with headers X-Total-Count (all matches) and X-Trash-Days (days a deleted image can be
   *   restored, for the Media page's delete confirmation).
   *
   * When editing:
   *   The search must work on SQLite and MariaDB: LIKE wildcards are escaped with "!" so "100%"
   *   matches literally (a backslash means different things to the two), and lower() on both
   *   sides keeps SQLite's case-insensitive LIKE. usedBy reads only id, platformId, caption and
   *   mediaId, so post schema changes don't break the library.
   */
  router.get('/', async (req, res) => {
    const search = String(req.query.search ?? '').trim();
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const views = {
      library: { where: 'deletedAt IS NULL', order: 'createdAt DESC, id DESC' },
      deleted: { where: 'deletedAt IS NOT NULL AND archivedAt IS NULL', order: 'deletedAt, id' },
      archived: { where: 'archivedAt IS NOT NULL', order: 'archivedAt DESC, id DESC' },
    };
    const view = views[req.query.view] ?? views.library;
    // "!" escapes LIKE wildcards on both databases (see above)
    const pattern = `%${search.replace(/[!%_]/g, (c) => `!${c}`)}%`;
    const where = `WHERE ${view.where}${search ? " AND lower(name) LIKE lower(?) ESCAPE '!'" : ''}`;
    const args = search ? [pattern] : [];

    const rows = await db.all(`
      SELECT id, name, mimeType, width, height, sha256, createdAt, deletedAt, archivedAt, archiveNote, versionOfId FROM media ${where}
      ORDER BY ${view.order} LIMIT ? OFFSET ?`, [...args, limit, offset]);
    const { total } = await db.get(`SELECT COUNT(*) AS total FROM media ${where}`, args);

    const usedBy = new Map(rows.map((row) => [row.id, []]));
    if (rows.length) {
      const posts = await db.all(`
        SELECT id, platformId, caption, mediaId FROM post
        WHERE mediaId IN (${rows.map(() => '?').join(', ')}) ORDER BY id`, rows.map((row) => row.id));
      for (const post of posts) {
        usedBy.get(post.mediaId)?.push({ postId: post.id, platformId: post.platformId, caption: post.caption });
      }
    }
    res.set('X-Total-Count', String(total));
    res.set('X-Trash-Days', String(trashDays()));
    res.json(rows.map((row) => ({ ...row, link: `/api/media/${row.id}/file`, usedBy: usedBy.get(row.id), ...purgeOf(row) })));
  });

  /**
   * GET /api/media/:id/check: checks an image against one platform's rules (type, file size,
   * width, shape). Any signed-in user.
   *
   * Usage:
   *   GET /api/media/7/check?platformId=2
   *
   * Returns:
   *   200 with checkImage's answer (services/imageRules.js; the rules are imageRules in
   *   settings.js); 404 unknown image or platform; 400 without platformId.
   */
  router.get('/:id/check', async (req, res) => {
    const media = await byId(req.params.id);
    if (!media) return res.status(404).json({ error: 'Image not found' });
    if (!req.query.platformId) return res.status(400).json({ error: 'platformId is required' });
    const platform = await db.get('SELECT name FROM platform WHERE id = ?', [req.query.platformId]);
    if (!platform) return res.status(404).json({ error: 'Platform not found' });
    res.json(checkImage(media, platform.name));
  });
  return router;
}
