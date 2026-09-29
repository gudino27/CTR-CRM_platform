import { Router } from 'express';
import { config } from '../config.js';
import { WEEKDAYS } from '../services/time.js';
import { parsePlatform, syncPlatform } from '../services/sync.js';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// Returns [column, value] pairs for the fields present in body, or throws a message
function platformUpdates(body) {
  const updates = [];
  if ('postingDays' in body) {
    const days = body.postingDays;
    if (!Array.isArray(days) || !days.every((d) => WEEKDAYS.includes(d))) throw `postingDays must be a list of ${WEEKDAYS.join(', ')}`;
    updates.push(['postingDays', JSON.stringify(WEEKDAYS.filter((d) => days.includes(d)))]);
  }
  if ('postingTimes' in body) {
    const times = body.postingTimes;
    if (!Array.isArray(times) || !times.every((t) => TIME.test(t))) throw 'postingTimes must be a list of "HH:MM" times';
    updates.push(['postingTimes', JSON.stringify([...new Set(times)].sort())]);
  }
  if ('calendarColorId' in body) {
    const id = body.calendarColorId;
    if (id !== null && !/^([1-9]|1[01])$/.test(String(id))) throw 'calendarColorId must be "1" to "11" or null';
    updates.push(['calendarColorId', id === null ? null : String(id)]);
  }
  if ('charLimit' in body) {
    const limit = body.charLimit;
    if (limit !== null && !(Number.isInteger(limit) && limit > 0)) throw 'charLimit must be a positive integer or null';
    updates.push(['charLimit', limit]);
  }
  if ('webhookUrl' in body) {
    const url = body.webhookUrl;
    if (url !== null && !(typeof url === 'string' && /^https?:\/\/\S+$/.test(url))) throw 'webhookUrl must be an http(s) URL or null';
    updates.push(['webhookUrl', url]);
  }
  for (const flag of ['paused', 'enabled']) {
    if (flag in body) {
      if (typeof body[flag] !== 'boolean') throw `${flag} must be true or false`;
      updates.push([flag, body[flag] ? 1 : 0]);
    }
  }
  return updates;
}

export function platformsRouter(db) {
  const router = Router();
  const byId = db.prepare('SELECT * FROM platform WHERE id = ?');

  // The Test platform only exists in test mode
  router.get('/', (req, res) => {
    const rows = db.prepare('SELECT * FROM platform ORDER BY sortOrder').all();
    res.json(rows.map(parsePlatform).filter((p) => config.testMode || !p.isTest));
  });

  // Cadence, color and limits; the queue is reprojected afterwards
  router.patch('/:id', async (req, res) => {
    const row = byId.get(req.params.id);
    if (!row || (row.isTest && !config.testMode)) return res.status(404).json({ error: 'Platform not found' });

    let updates;
    try {
      updates = platformUpdates(req.body ?? {});
    } catch (message) {
      return res.status(400).json({ error: message });
    }
    if (updates.length > 0) {
      db.prepare(`UPDATE platform SET ${updates.map(([col]) => `${col} = ?`).join(', ')} WHERE id = ?`)
        .run(...updates.map(([, value]) => value), row.id);
      await syncPlatform(db, row.id);
    }
    res.json(parsePlatform(byId.get(row.id)));
  });

  return router;
}
