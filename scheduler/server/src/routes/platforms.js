import { Router } from 'express';
import { config } from '../config.js';
import { WEEKDAYS } from '../services/time.js';
import { parsePlatform, syncPlatform } from '../services/sync.js';
import { postTypesOf } from '../services/views.js';

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
  const view = (row) => ({ ...parsePlatform(row), postTypes: postTypesOf(db, row.id) });

  // The Test platform only exists in test mode
  router.get('/', (req, res) => {
    const rows = db.prepare('SELECT * FROM platform ORDER BY sortOrder').all();
    res.json(rows.filter((p) => config.testMode || !p.isTest).map(view));
  });

  // Cadence, color and limits, a cadence change regenerates the future unlocked slots, then they refill
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
      const cadence = updates.some(([col]) => col === 'postingDays' || col === 'postingTimes');
      await syncPlatform(db, row.id, { regenerate: cadence });
    }
    res.json(view(byId.get(row.id)));
  });

  // Post types: add or rename one, or move it in or out of the monthly rotation.
  // A rotation change regenerates the future unlocked slots, like a cadence change.
  const typeById = db.prepare('SELECT * FROM postType WHERE id = ? AND platformId = ?');
  const typeNamed = db.prepare('SELECT id FROM postType WHERE platformId = ? AND name = ? COLLATE NOCASE AND id != ?');
  const rotationCount = db.prepare('SELECT COUNT(*) AS n FROM postType WHERE platformId = ? AND inRotation = 1');
  const cleanName = (name) => (typeof name === 'string' ? name.trim() : '');

  router.post('/:id/post-types', async (req, res) => {
    const row = byId.get(req.params.id);
    if (!row || (row.isTest && !config.testMode)) return res.status(404).json({ error: 'Platform not found' });
    const name = cleanName(req.body?.name);
    const inRotation = req.body?.inRotation ?? true;
    if (!name || name.length > 60) return res.status(400).json({ error: 'name must be 1 to 60 characters' });
    if (typeof inRotation !== 'boolean') return res.status(400).json({ error: 'inRotation must be true or false' });
    if (typeNamed.get(row.id, name, 0)) return res.status(409).json({ error: `${row.name} already has a "${name}" post type` });

    const { next } = db.prepare('SELECT COALESCE(MAX(sortOrder), -1) + 1 AS next FROM postType WHERE platformId = ? AND inRotation = 1').get(row.id);
    db.prepare('INSERT INTO postType (platformId, name, sortOrder, inRotation) VALUES (?, ?, ?, ?)')
      .run(row.id, name, inRotation ? next : 99, inRotation ? 1 : 0);
    if (inRotation) await syncPlatform(db, row.id, { regenerate: true });
    res.status(201).json(view(byId.get(row.id)));
  });

  router.patch('/:id/post-types/:typeId', async (req, res) => {
    const row = byId.get(req.params.id);
    const type = row && typeById.get(req.params.typeId, row.id);
    if (!type || (row.isTest && !config.testMode)) return res.status(404).json({ error: 'Post type not found' });
    const body = req.body ?? {};

    if ('name' in body) {
      const name = cleanName(body.name);
      if (!name || name.length > 60) return res.status(400).json({ error: 'name must be 1 to 60 characters' });
      if (typeNamed.get(row.id, name, type.id)) return res.status(409).json({ error: `${row.name} already has a "${name}" post type` });
      db.prepare('UPDATE postType SET name = ? WHERE id = ?').run(name, type.id);
    }
    if ('inRotation' in body && Boolean(body.inRotation) !== Boolean(type.inRotation)) {
      if (typeof body.inRotation !== 'boolean') return res.status(400).json({ error: 'inRotation must be true or false' });
      if (!body.inRotation && rotationCount.get(row.id).n <= 1) {
        return res.status(400).json({ error: 'The monthly rotation needs at least one post type' });
      }
      const { next } = db.prepare('SELECT COALESCE(MAX(sortOrder), -1) + 1 AS next FROM postType WHERE platformId = ? AND inRotation = 1').get(row.id);
      db.prepare('UPDATE postType SET inRotation = ?, sortOrder = ? WHERE id = ?')
        .run(body.inRotation ? 1 : 0, body.inRotation ? next : 99, type.id);
      await syncPlatform(db, row.id, { regenerate: true });
    }
    res.json(view(byId.get(row.id)));
  });
  return router;
}