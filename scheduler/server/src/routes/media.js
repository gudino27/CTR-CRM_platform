import express, { Router } from 'express';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { config } from '../config.js';
import { driveDownloader, driveUploader } from '../services/googleDrive.js';
import { extensions, imageInfo } from '../services/imageInfo.js';
import { checkImage } from '../services/imageRules.js';

// Local fallback for development when Drive isn't configured
function localMediaDir() {
  const base = config.dbPath === ':memory:' ? join(tmpdir(), 'ctr-scheduler-media') : resolve(dirname(config.dbPath), 'media');
  mkdirSync(base, { recursive: true });
  return base;
}

export function mediaRouter(db) {
  const router = Router();
  const byId = db.prepare('SELECT * FROM media WHERE id = ?');
  const bySha = db.prepare('SELECT * FROM media WHERE sha256 = ?');

  // Body is the raw file; the original filename comes in ?name=
  router.post('/', express.raw({ type: () => true, limit: '10mb' }), async (req, res) => {
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (buffer.length === 0) return res.status(400).json({ error: 'The image file is empty' });
    const info = imageInfo(buffer);
    if (!info) return res.status(400).json({ error: 'Only JPEG, PNG and WebP images are supported' });

    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const existing = bySha.get(sha256);
    if (existing) return res.json(existing);

    const ext = extensions[info.mimeType];
    const name = String(req.query.name || `image.${ext}`).slice(0, 255);
    const insert = db.prepare(`
      INSERT INTO media (storage, driveFileId, link, localPath, name, mimeType, width, height, sizeBytes, sha256)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    const upload = driveUploader();
    if (upload) {
      let file;
      try {
        file = await upload(buffer, { name, mimeType: info.mimeType });
      } catch (err) {
        // Most often a refresh token without the drive.file scope, or no access to the folder
        console.error('Drive upload failed:', err);
        return res.status(502).json({ error: `Google Drive rejected the upload: ${err.message}` });
      }
      const { lastInsertRowid } = insert.run('drive', file.id, file.webViewLink, null, name, info.mimeType,
        info.width, info.height, buffer.length, sha256);
      return res.status(201).json(byId.get(lastInsertRowid));
    }

    const localPath = join(localMediaDir(), `${sha256}.${ext}`);
    writeFileSync(localPath, buffer);
    const { lastInsertRowid } = insert.run('local', null, null, localPath, name, info.mimeType,
      info.width, info.height, buffer.length, sha256);
    db.prepare('UPDATE media SET link = ? WHERE id = ?').run(`/api/media/${lastInsertRowid}/file`, lastInsertRowid);
    res.status(201).json(byId.get(lastInsertRowid));
  });

  router.get('/:id', (req, res) => {
    const media = byId.get(req.params.id);
    if (!media) return res.status(404).json({ error: 'Image not found' });
    res.json(media);
  });

  router.get('/:id/file', async (req, res) => {
    const media = byId.get(req.params.id);
    if (!media) return res.status(404).json({ error: 'Image not found' });
    if (media.storage === 'drive') {
      // ?inline=1 streams the bytes (for <img> thumbnails), otherwise send people to Drive
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

  // Library listing: newest first, optional name search, with the posts that use each image.
  router.get('/', (req, res) => {
    const search = String(req.query.search ?? '').trim();
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    // Escape LIKE wildcards so "100%" matches literally
    const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const where = search ? "WHERE name LIKE ? ESCAPE '\\'" : '';
    const args = search ? [pattern] : [];

    const rows = db.prepare(`
      SELECT id, name, mimeType, width, height, createdAt FROM media ${where}
      ORDER BY createdAt DESC, id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM media ${where}`).get(...args);

    // Only id, platformId, caption and mediaId, so post schema changes don't break the library
    const usedBy = new Map(rows.map((row) => [row.id, []]));
    if (rows.length) {
      const posts = db.prepare(`
        SELECT id, platformId, caption, mediaId FROM post
        WHERE mediaId IN (${rows.map(() => '?').join(', ')}) ORDER BY id`).all(...rows.map((row) => row.id));
      for (const post of posts) {
        usedBy.get(post.mediaId)?.push({ postId: post.id, platformId: post.platformId, caption: post.caption });
      }
    }
    res.set('X-Total-Count', String(total));
    res.json(rows.map((row) => ({ ...row, link: `/api/media/${row.id}/file`, usedBy: usedBy.get(row.id) })));
  });

  router.get('/:id/check', (req, res) => {
    const media = byId.get(req.params.id);
    if (!media) return res.status(404).json({ error: 'Image not found' });
    if (!req.query.platformId) return res.status(400).json({ error: 'platformId is required' });
    const platform = db.prepare('SELECT name FROM platform WHERE id = ?').get(req.query.platformId);
    if (!platform) return res.status(404).json({ error: 'Platform not found' });
    res.json(checkImage(media, platform.name));
  });
  return router;
}