// Read queries shared by the routes: posts come back with their image, type and slot, and slots with their post, so pages don't need a second request.
import { config } from '../config.js';
import { COLORS } from './projection.js';

export const SELECT_POST = `SELECT post.*, media.link AS mediaLink, media.name AS mediaName,
                                   postType.name AS postTypeName, slot.id AS slotId
                            FROM post LEFT JOIN media ON media.id = post.mediaId
                            LEFT JOIN postType ON postType.id = post.postTypeId
                            LEFT JOIN slot ON slot.postId = post.id`;

export const SELECT_SLOT = `SELECT slot.*, postType.name AS postTypeName
                            FROM slot LEFT JOIN postType ON postType.id = slot.postTypeId`;

/** Platforms the app shows: the Test platform only exists in test mode. */
export const visible = (platform) => config.testMode || !platform.isTest;

export const postTypesOf = (db, platformId) =>
  db.prepare('SELECT id, name, sortOrder, inRotation FROM postType WHERE platformId = ? ORDER BY sortOrder, id').all(platformId)
    .map((type) => ({ ...type, inRotation: Boolean(type.inRotation) }));

/** Local dates ("YYYY-MM-DD") with a fixed post on the platform; its library slots that day are blocked. */
export function fixedDays(db, platformId) {
  const rows = db.prepare(`SELECT DISTINCT substr(fixedAt, 1, 10) AS date FROM post
                           WHERE platformId = ? AND kind = 'fixed' AND status != 'failed'`).all(platformId);
  return new Set(rows.map((r) => r.date));
}

/** Slot rows as the API returns them: flags as booleans, blocked, and the post in it. */
export function slotViews(db, rows) {
  const postById = db.prepare(`${SELECT_POST} WHERE post.id = ?`);
  const daysByPlatform = new Map();
  return rows.map((row) => {
    if (!daysByPlatform.has(row.platformId)) daysByPlatform.set(row.platformId, fixedDays(db, row.platformId));
    return {
      ...row,
      locked: Boolean(row.locked),
      pinned: Boolean(row.pinned),
      blocked: !row.postId && daysByPlatform.get(row.platformId).has(row.date),
      post: row.postId ? postById.get(row.postId) : null,
    };
  });
}

/**
 * Stock per platform x post type x color (color null without colors): library
 * posts waiting for a slot, and unblocked empty slots still to come in `months`.
 */

export function inventory(db, months, now) {
  const first = `${months[0]}-01`;
  const last = `${months.at(-1)}-31`;
  const platforms = db.prepare('SELECT * FROM platform WHERE enabled = 1 ORDER BY sortOrder').all().filter(visible);
  const inLibrary = db.prepare(`SELECT COUNT(*) AS n FROM post
                                WHERE platformId = ? AND kind = 'library' AND status = 'queued' AND postTypeId = ? AND color IS ?
                                  AND NOT EXISTS (SELECT 1 FROM slot WHERE slot.postId = post.id)`);
  const emptySlots = db.prepare(`SELECT date FROM slot
                                 WHERE platformId = ? AND postTypeId = ? AND color IS ? AND postId IS NULL
                                   AND scheduledAt > ? AND date BETWEEN ? AND ?`);
  const rows = [];
  for (const platform of platforms) {
    const blocked = fixedDays(db, platform.id);
    for (const type of postTypesOf(db, platform.id).filter((t) => t.inRotation)) {
      for (const color of platform.usesColors ? COLORS : [null]) {
        const stock = inLibrary.get(platform.id, type.id, color).n;
        const empty = emptySlots.all(platform.id, type.id, color, now.toISOString(), first, last)
          .filter((s) => !blocked.has(s.date)).length;
        rows.push({
          platformId: platform.id, platformName: platform.name, postTypeId: type.id, postTypeName: type.name,
          color, inLibrary: stock, emptySlots: empty, low: empty > stock,
        });
      }
    }
  }
  return rows;
}