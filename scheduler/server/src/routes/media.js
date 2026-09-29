import express, { Router } from 'express';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { config } from '../config.js';
import { driveUploader } from '../services/googleDrive.js';
import { extensions, imageInfo } from '../services/imageInfo.js';

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

  router.get('/:id/file', (req, res) => {
    const media = byId.get(req.params.id);
    if (!media) return res.status(404).json({ error: 'Image not found' });
    if (media.storage === 'drive') return res.redirect(302, media.link);
    if (!media.localPath || !existsSync(media.localPath)) return res.status(404).json({ error: 'Image file is missing' });
    res.type(media.mimeType).sendFile(media.localPath);
  });

  return router;
}
