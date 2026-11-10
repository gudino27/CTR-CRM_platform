
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import sharp from 'sharp';

import {
  mkdtempSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb } from '../../src/db/index.js';
import { mediaRouter } from '../../src/routes/media.js';
import { config } from '../../src/config.js';
import {
  driveUploader,
  setDriveUploader,
} from '../../src/services/googleDrive.js';

// TC-126: Verify image upload, deletion, and restoration.
test('TC-126: Handle image upload and deletion', async () => {
  const db = await openDb(':memory:');

  // Keep all test images in a temporary folder.
  const tempDir = mkdtempSync(
    join(tmpdir(), 'ctr-media-test-')
  );

  const originalDbPath = config.dbPath;
  const originalUploader = driveUploader();

  let server;

  try {
    config.dbPath = join(tempDir, 'scheduler.db');

    // Force local storage. Never upload to Google Drive.
    setDriveUploader(null);

    const app = express();

    // Authentication is tested separately.
    app.use((req, res, next) => {
      req.user = {
        role: 'superAdmin',
        active: 1,
      };
      next();
    });

    app.use('/api/media', mediaRouter(db));

    server = await new Promise(resolve => {
      const instance = app.listen(
        0,
        '127.0.0.1',
        () => resolve(instance)
      );
    });

    const baseUrl =
      `http://127.0.0.1:${server.address().port}`;

    // Create a small, valid PNG in memory.
    const image = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 3,
        background: {
          r: 50,
          g: 120,
          b: 180,
        },
      },
    }).png().toBuffer();

    async function upload(buffer) {
      const response = await fetch(
        `${baseUrl}/api/media?name=test.png`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'image/png',
          },
          body: buffer,
        }
      );

      return {
        status: response.status,
        data: await response.json(),
      };
    }

    async function request(path, method) {
      const response = await fetch(
        `${baseUrl}${path}`,
        { method }
      );

      return {
        status: response.status,
        data: response.status === 204
          ? null
          : await response.json(),
      };
    }

    // 1. Reject invalid image data.
    const invalid = await upload(
      Buffer.from('This is not an image')
    );

    assert.equal(invalid.status, 400);

    // 2. Upload a valid PNG.
    const uploaded = await upload(image);

    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.data.mimeType, 'image/jpeg');
    assert.equal(uploaded.data.width, 10);
    assert.equal(uploaded.data.height, 10);
    assert.equal(uploaded.data.storage, 'local');

    const mediaId = uploaded.data.id;

    // Verify the image exists on disk.
    const stored = await db.get(
      'SELECT * FROM media WHERE id = ?',
      [mediaId]
    );

    assert.ok(stored);
    assert.ok(existsSync(stored.localPath));

    // 3. Duplicate upload must reuse the existing image.
    const duplicate = await upload(image);

    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.data.id, mediaId);

    const count = await db.get(
      'SELECT COUNT(*) AS total FROM media'
    );

    assert.equal(count.total, 1);

    // 4. Create a pending post using the image.
    const platform = await db.run(`
      INSERT INTO platform (key, name)
      VALUES (?, ?)
    `, ['media-test', 'Media Test']);

    const post = await db.run(`
      INSERT INTO post
        (platformId, caption, kind, mediaId)
      VALUES (?, ?, 'library', ?)
    `, [
      platform.lastInsertRowid,
      'Pending post with image',
      mediaId,
    ]);

    // Deletion must be blocked.
    const blocked = await request(
      `/api/media/${mediaId}`,
      'DELETE'
    );

    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.usedBy.length, 1);

    // Remove the pending post.
    await db.run(
      'DELETE FROM post WHERE id = ?',
      [post.lastInsertRowid]
    );

    // 5. Delete the image.
    const deleted = await request(
      `/api/media/${mediaId}`,
      'DELETE'
    );

    assert.equal(deleted.status, 204);

    const trashed = await db.get(
      'SELECT * FROM media WHERE id = ?',
      [mediaId]
    );

    assert.ok(trashed.deletedAt);
    assert.ok(trashed.trashPath);
    assert.ok(existsSync(trashed.trashPath));

    // 6. Restore the deleted image.
    const restored = await request(
      `/api/media/${mediaId}/restore`,
      'POST'
    );

    assert.equal(restored.status, 200);
    assert.equal(restored.data.id, mediaId);
    assert.equal(restored.data.deletedAt, null);

    const finalImage = await db.get(
      'SELECT * FROM media WHERE id = ?',
      [mediaId]
    );

    assert.ok(existsSync(finalImage.localPath));
    assert.equal(finalImage.deletedAt, null);
    assert.equal(finalImage.trashPath, null);

  } finally {
    // Restore configuration.
    config.dbPath = originalDbPath;
    setDriveUploader(originalUploader);

    if (server) {
      await new Promise((resolve, reject) => {
        server.close(error =>
          error ? reject(error) : resolve()
        );
      });
    }

    await db.close();

    // Remove all temporary test images.
    rmSync(tempDir, {
      recursive: true,
      force: true,
    });
  }
});
