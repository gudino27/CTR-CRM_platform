/**
 * Platform routes (/api/platforms): the Platforms page's settings, post types, and schedule rules.
 *
 * A platform's slots are the union of its active schedule rules' dates and times. A change to the
 * rules or to which post types are in the monthly rotation regenerates the future unlocked slots
 * (syncPlatform with regenerate: true); posts in slots that go away return to the library.
 *
 * Permissions (ROUTES in services/permissions.js, which also writes the audit entries): GETs need
 * any signed-in user; PATCH /:id editPlatforms; post types managePostTypes; rules editSchedules.
 * The Test platform only exists in test mode: outside it, its routes answer 404.
 *
 *  the color suggestion for Specific Date posts, the
 * "Move posts / Keep posts" choice when the rules change (keepPosts and rules/impact), and
 * resuming a paused platform with a choice per missed post (missed and resume).
 */
import { Router } from 'express';
import { config } from '../config.js';
import { clock } from '../services/clock.js';
import { RULE_DAYS } from '../services/projection.js';
import { localDateString, parseDateString, parseLocalDateTime } from '../services/time.js';
import { parsePlatform, ruleChangeImpact, suggestColor, syncPlatform } from '../services/sync.js';
import { cadenceOf, missedPosts, postTypesOf, rulesOf } from '../services/views.js';
import { writeAudit } from '../services/access.js';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
// Monday first, the order the rules editor shows
const RULE_DAY_ORDER = [...RULE_DAYS.slice(1), RULE_DAYS[0]];
const MAX_INTERVAL_WEEKS = 52;
const MAX_SEQUENCE = 50;

/**
 * Checks the platform settings present in body.
 *
 * Usage:
 *   const updates = platformUpdates(req.body ?? {});   // [['charLimit', 2200], ...]
 *
 * Takes:
 *   body - any of calendarColorId ("1" to "11" or null), charLimit (a positive integer or null),
 *          webhookUrl (an http(s) URL or null), paused, enabled (true/false)
 *
 * Returns:
 *   [column, value] pairs for the fields present. Throws a message (a 400) for a bad value, or
 *   for postingDays/postingTimes, which are set by schedule rules now.
 */
function platformUpdates(body) {
  const updates = [];
  if ('postingDays' in body || 'postingTimes' in body) {
    throw 'Posting days and times are set by schedule rules now: use /api/platforms/:id/rules';
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

/**
 * Checks the schedule rule fields present in body against the current rule.
 *
 * Usage:
 *   const updates = ruleUpdates(body, rule, await rotationIds(platformId));
 *
 * Takes:
 *   body     - any of label (up to 60 characters, or null), byDay (["TU","TH"] or "TU,TH"),
 *              intervalWeeks (1 = every week, up to MAX_INTERVAL_WEEKS), time ("HH:MM", 24-hour),
 *              startDate, endDate ("YYYY-MM-DD"; endDate null = no end), postTypeIds (rotation
 *              type ids, up to MAX_SEQUENCE; empty cycles the rotation), active, sortOrder
 *   current  - the stored rule, or null for a new one (then byDay and time are required)
 *   rotation - the platform's rotation type ids in their monthly order
 *
 * Returns:
 *   [column, value] pairs. byDay is stored Monday first, comma-separated. Throws a message (a 400).
 *
 * How it works:
 *   postTypeIds equal to the rotation itself, in its own order, is stored as empty: the rule then
 *   keeps following the rotation, so a type added to it later joins this rule too. Only a changed
 *   order (fewer types, another order, repeats) is stored as a list of its own.
 */
function ruleUpdates(body, current, rotation) {
  const rotationIds = new Set(rotation);
  const updates = [];
  const merged = { ...current };
  if ('label' in body) {
    const label = body.label === null ? '' : body.label;
    if (typeof label !== 'string' || label.trim().length > 60) throw 'label must be up to 60 characters, or null';
    updates.push(['label', label.trim() || null]);
  }
  if ('byDay' in body || !current) {
    const raw = body.byDay;
    const codes = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',').map((d) => d.trim().toUpperCase()) : null;
    if (!codes || codes.length === 0 || !codes.every((d) => RULE_DAYS.includes(d))) {
      throw `byDay must list at least one day: ${RULE_DAY_ORDER.join(', ')} (e.g. "TU,TH")`;
    }
    updates.push(['byDay', RULE_DAY_ORDER.filter((d) => codes.includes(d)).join(',')]);
  }
  if ('intervalWeeks' in body) {
    const n = body.intervalWeeks;
    if (!Number.isInteger(n) || n < 1 || n > MAX_INTERVAL_WEEKS) throw `intervalWeeks must be a whole number from 1 (every week) to ${MAX_INTERVAL_WEEKS}`;
    updates.push(['intervalWeeks', n]);
  }
  if ('time' in body || !current) {
    if (!TIME.test(body.time ?? '')) throw 'time must be "HH:MM" (24-hour)';
    updates.push(['time', body.time]);
  }
  if ('startDate' in body) {
    if (!parseDateString(body.startDate)) throw 'startDate must be a date "YYYY-MM-DD"';
    updates.push(['startDate', body.startDate]);
    merged.startDate = body.startDate;
  }
  if ('endDate' in body) {
    if (body.endDate !== null && !parseDateString(body.endDate)) throw 'endDate must be a date "YYYY-MM-DD", or null for no end';
    updates.push(['endDate', body.endDate]);
    merged.endDate = body.endDate;
  }
  if (merged.endDate && merged.startDate && merged.endDate < merged.startDate) throw 'endDate cannot be before startDate';
  if ('postTypeIds' in body) {
    const ids = body.postTypeIds;
    if (!Array.isArray(ids) || ids.length > MAX_SEQUENCE || !ids.every((id) => rotationIds.has(id))) {
      throw `postTypeIds must be a list (up to ${MAX_SEQUENCE}) of the platform's monthly rotation post type ids; empty cycles the rotation`;
    }
    const same = ids.length === rotation.length && ids.every((id, i) => id === rotation[i]);
    updates.push(['postTypeIds', JSON.stringify(same ? [] : ids)]);
  }
  if ('active' in body) {
    if (typeof body.active !== 'boolean') throw 'active must be true or false';
    updates.push(['active', body.active ? 1 : 0]);
  }
  if ('sortOrder' in body) {
    if (!Number.isInteger(body.sortOrder)) throw 'sortOrder must be a whole number';
    updates.push(['sortOrder', body.sortOrder]);
  }
  return updates;
}

/**
 * The /api/platforms router.
 *
 * Usage:
 *   app.use('/api/platforms', platformsRouter(db));   (app.js)
 *
 * Takes:
 *   db - the open database
 *
 * Returns:
 *   An Express router with the routes below. A platform comes back as view(row):
 *   { ...parsePlatform(row), postingDays, postingTimes, postTypes, rules }, where postingDays and
 *   postingTimes are worked out from the active rules (read-only; pages use them for default times).
 */
export function platformsRouter(db) {
  const router = Router();
  const byId = (id) => db.get('SELECT * FROM platform WHERE id = ?', [id]);
  const view = async (row) => {
    const rules = await rulesOf(db, row.id);
    return { ...parsePlatform(row), ...cadenceOf(rules), postTypes: await postTypesOf(db, row.id), rules };
  };
  const views = async (rows) => {
    const result = [];
    for (const row of rows) result.push(await view(row));
    return result;
  };

  /**
   * GET /api/platforms: every platform in display order (the Test platform only in test mode).
   * Any signed-in user.
   *
   * Usage:
   *   GET /api/platforms
   *
   * Returns:
   *   200 [view(row)]
   */
  router.get('/', async (req, res) => {
    const rows = await db.all('SELECT * FROM platform ORDER BY sortOrder');
    res.json(await views(rows.filter((p) => config.testMode || !p.isTest)));
  });

  /**
   * PATCH /api/platforms/:id: color, character limit, webhook, and pause/enable; the cadence
   * lives in the schedule rules below. Needs editPlatforms.
   *
   * Usage:
   *   PATCH /api/platforms/2  { paused: true }
   *
   * Takes:
   *   body - see platformUpdates
   *
   * Returns:
   *   200 with view(row); 404 unknown; 400 with a message for a bad value.
   *
   * How it works:
   *   Saves, then syncPlatform. Pausing keeps the slots and which post is in each, but takes every
   *   queued post's time and calendar event away so nothing sends (see syncPlatformNow); resuming
   *   puts them back. Library posts whose slot passed meanwhile refill later slots; Specific Date
   *   posts whose time passed are marked failed so a person can requeue them with a new date.
   */
  router.patch('/:id', async (req, res) => {
    const row = await byId(req.params.id);
    if (!row || (row.isTest && !config.testMode)) return res.status(404).json({ error: 'Platform not found' });

    let updates;
    try {
      updates = platformUpdates(req.body ?? {});
    } catch (message) {
      return res.status(400).json({ error: message });
    }
    if (updates.length > 0) {
      await db.run(`UPDATE platform SET ${updates.map(([col]) => `${col} = ?`).join(', ')} WHERE id = ?`,
        [...updates.map(([, value]) => value), row.id]);
      await syncPlatform(db, row.id);
    }
    res.json(await view(await byId(row.id)));
  });

  // ---- Post types: add or rename one, or move it in or out of the monthly rotation ----
  const typeById = (id, platformId) => db.get('SELECT * FROM postType WHERE id = ? AND platformId = ?', [id, platformId]);
  // Names differ in more than letter case (lower() on both sides works the same in SQLite and MariaDB)
  const typeNamed = (platformId, name, exceptId) =>
    db.get('SELECT id FROM postType WHERE platformId = ? AND lower(name) = lower(?) AND id != ?', [platformId, name, exceptId]);
  const rotationCount = async (platformId) =>
    (await db.get('SELECT COUNT(*) AS n FROM postType WHERE platformId = ? AND inRotation = 1', [platformId])).n;
  const nextTypeOrder = async (platformId) =>
    (await db.get('SELECT COALESCE(MAX(sortOrder), -1) + 1 AS next FROM postType WHERE platformId = ? AND inRotation = 1', [platformId])).next;
  const cleanName = (name) => (typeof name === 'string' ? name.trim() : '');

  /**
   * POST /api/platforms/:id/post-types: adds a post type. Needs managePostTypes.
   *
   * Usage:
   *   POST /api/platforms/2/post-types  { name: "Event Recap", inRotation: true }
   *
   * Takes:
   *   body.name       - 1 to 60 characters, unique on the platform ignoring letter case
   *   body.inRotation - default true; false makes a Specific Date only type (like Holiday)
   *
   * Returns:
   *   201 with view(row); 404 unknown platform; 400 bad name or inRotation; 409 name taken.
   *
   * How it works:
   *   A rotation type goes last in the rotation and regenerates the future unlocked slots, like a
   *   cadence change; a type outside the rotation gets sortOrder 99.
   */
  router.post('/:id/post-types', async (req, res) => {
    const row = await byId(req.params.id);
    if (!row || (row.isTest && !config.testMode)) return res.status(404).json({ error: 'Platform not found' });
    const name = cleanName(req.body?.name);
    const inRotation = req.body?.inRotation ?? true;
    if (!name || name.length > 60) return res.status(400).json({ error: 'name must be 1 to 60 characters' });
    if (typeof inRotation !== 'boolean') return res.status(400).json({ error: 'inRotation must be true or false' });
    if (await typeNamed(row.id, name, 0)) return res.status(409).json({ error: `${row.name} already has a "${name}" post type` });

    const next = await nextTypeOrder(row.id);
    await db.run('INSERT INTO postType (platformId, name, sortOrder, inRotation) VALUES (?, ?, ?, ?)',
      [row.id, name, inRotation ? next : 99, inRotation ? 1 : 0]);
    if (inRotation) await syncPlatform(db, row.id, { regenerate: true });
    res.status(201).json(await view(await byId(row.id)));
  });

  /**
   * PATCH /api/platforms/:id/post-types/:typeId: renames a post type, or moves it in or out of
   * the monthly rotation. Needs managePostTypes.
   *
   * Usage:
   *   PATCH /api/platforms/2/post-types/5  { name: "Mission" }   or   { inRotation: false }
   *
   * Returns:
   *   200 with view(row); 404 unknown; 400 bad name or inRotation, or taking the last type out of
   *   the rotation (it needs at least one); 409 name taken.
   *
   * How it works:
   *   A rename keeps the id, so posts keep their type. A rotation change puts the type last (or
   *   at sortOrder 99 when it leaves) and regenerates the future unlocked slots.
   */
  router.patch('/:id/post-types/:typeId', async (req, res) => {
    const row = await byId(req.params.id);
    const type = row && (await typeById(req.params.typeId, row.id));
    if (!type || (row.isTest && !config.testMode)) return res.status(404).json({ error: 'Post type not found' });
    const body = req.body ?? {};

    if ('name' in body) {
      const name = cleanName(body.name);
      if (!name || name.length > 60) return res.status(400).json({ error: 'name must be 1 to 60 characters' });
      if (await typeNamed(row.id, name, type.id)) return res.status(409).json({ error: `${row.name} already has a "${name}" post type` });
      await db.run('UPDATE postType SET name = ? WHERE id = ?', [name, type.id]);
    }
    if ('inRotation' in body && Boolean(body.inRotation) !== Boolean(type.inRotation)) {
      if (typeof body.inRotation !== 'boolean') return res.status(400).json({ error: 'inRotation must be true or false' });
      if (!body.inRotation && (await rotationCount(row.id)) <= 1) {
        return res.status(400).json({ error: 'The monthly rotation needs at least one post type' });
      }
      const next = await nextTypeOrder(row.id);
      await db.run('UPDATE postType SET inRotation = ?, sortOrder = ? WHERE id = ?',
        [body.inRotation ? 1 : 0, body.inRotation ? next : 99, type.id]);
      await syncPlatform(db, row.id, { regenerate: true });
    }
    res.json(await view(await byId(row.id)));
  });

  // ---- Schedule rules: any change regenerates the future unlocked slots ----
  const ruleById = (id, platformId) => db.get('SELECT * FROM scheduleRule WHERE id = ? AND platformId = ?', [id, platformId]);
  const activeRuleCount = async (platformId) =>
    (await db.get('SELECT COUNT(*) AS n FROM scheduleRule WHERE platformId = ? AND active = 1', [platformId])).n;
  // In the order rules with an empty list cycle them (postTypesOf sorts by sortOrder, id like monthBlueprint)
  const rotationIds = async (platformId) => (await postTypesOf(db, platformId)).filter((t) => t.inRotation).map((t) => t.id);
  const usable = (row) => row && !(row.isTest && !config.testMode);

  /**
   * GET /api/platforms/:id/rules: the platform's schedule rules. Any signed-in user.
   *
   * Usage:
   *   GET /api/platforms/2/rules
   *
   * Returns:
   *   200 [rule] (rulesOf in services/views.js); 404 unknown platform.
   */
  router.get('/:id/rules', async (req, res) => {
    const row = await byId(req.params.id);
    if (!usable(row)) return res.status(404).json({ error: 'Platform not found' });
    res.json(await rulesOf(db, row.id));
  });

  /**
   * POST /api/platforms/:id/rules: adds a schedule rule. Needs editSchedules.
   *
   * Usage:
   *   POST /api/platforms/2/rules  { byDay: "TU,TH", time: "11:00", intervalWeeks: 1 }
   *
   * Takes:
   *   body - see ruleUpdates; byDay and time are required, startDate defaults to today (app time
   *          zone), sortOrder to last. keepPosts: true keeps the posts already on the calendar
   *          where they are (see keepPosts); otherwise they move to the new days.
   *
   * Returns:
   *   201 with view(row); 404 unknown platform; 400 with a message for a bad field.
   */
  router.post('/:id/rules', async (req, res) => {
    const row = await byId(req.params.id);
    if (!usable(row)) return res.status(404).json({ error: 'Platform not found' });
    const body = { startDate: localDateString(clock.now(), config.timezone), ...(req.body ?? {}) };
    let updates;
    try {
      updates = ruleUpdates(body, null, await rotationIds(row.id));
    } catch (message) {
      return res.status(400).json({ error: message });
    }
    if (!updates.some(([col]) => col === 'sortOrder')) {
      const { next } = await db.get('SELECT COALESCE(MAX(sortOrder), -1) + 1 AS next FROM scheduleRule WHERE platformId = ?', [row.id]);
      updates.push(['sortOrder', next]);
    }
    if (body.keepPosts === true) await keepPosts(req, row, await proposedRules(row.id, { updates }));
    const cols = ['platformId', ...updates.map(([col]) => col)];
    await db.run(`INSERT INTO scheduleRule (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      [row.id, ...updates.map(([, value]) => value)]);
    await syncPlatform(db, row.id, { regenerate: true });
    res.status(201).json(await view(await byId(row.id)));
  });

  /**
   * PATCH /api/platforms/:id/rules/:ruleId: changes a schedule rule. Needs editSchedules.
   *
   * Usage:
   *   PATCH /api/platforms/2/rules/7  { time: "12:30" }   or   { active: false }
   *   PATCH /api/platforms/2/rules/7  { byDay: "MO,FR", keepPosts: true }
   *
   * Returns:
   *   200 with view(row); 404 unknown rule; 400 with a message for a bad field, or turning off the
   *   last active rule (pause the platform to stop posting instead).
   */
  router.patch('/:id/rules/:ruleId', async (req, res) => {
    const row = await byId(req.params.id);
    const rule = usable(row) && (await ruleById(req.params.ruleId, row.id));
    if (!rule) return res.status(404).json({ error: 'Schedule rule not found' });
    const body = req.body ?? {};
    let updates;
    try {
      updates = ruleUpdates(body, rule, await rotationIds(row.id));
    } catch (message) {
      return res.status(400).json({ error: message });
    }
    if (body.active === false && rule.active && (await activeRuleCount(row.id)) <= 1) {
      return res.status(400).json({ error: `${row.name} needs at least one active schedule rule; pause the platform to stop posting` });
    }
    if (updates.length > 0) {
      if (body.keepPosts === true) await keepPosts(req, row, await proposedRules(row.id, { ruleId: rule.id, updates }));
      await db.run(`UPDATE scheduleRule SET ${updates.map(([col]) => `${col} = ?`).join(', ')} WHERE id = ?`,
        [...updates.map(([, value]) => value), rule.id]);
      await syncPlatform(db, row.id, { regenerate: true });
    }
    res.json(await view(await byId(row.id)));
  });

  /**
   * DELETE /api/platforms/:id/rules/:ruleId: deletes a schedule rule. Needs editSchedules.
   *
   * Usage:
   *   DELETE /api/platforms/2/rules/7
   *   DELETE /api/platforms/2/rules/7?keepPosts=true   (posts on the calendar stay)
   *
   * Returns:
   *   200 with view(row); 404 unknown rule; 400 for the last active rule (pause the platform to
   *   stop posting instead).
   *
   * How it works:
   *   Deletes the row and regenerates the future unlocked slots; posts in slots that go away
   *   return to the library.
   */
  router.delete('/:id/rules/:ruleId', async (req, res) => {
    const row = await byId(req.params.id);
    const rule = usable(row) && (await ruleById(req.params.ruleId, row.id));
    if (!rule) return res.status(404).json({ error: 'Schedule rule not found' });
    // A platform always keeps one active rule
    if (rule.active && (await activeRuleCount(row.id)) <= 1) {
      return res.status(400).json({ error: `${row.name} needs at least one active schedule rule, so its last one cannot be deleted; pause the platform to stop posting` });
    }
    if (req.query.keepPosts === 'true') await keepPosts(req, row, await proposedRules(row.id, { ruleId: rule.id, remove: true }));
    await db.run('DELETE FROM scheduleRule WHERE id = ?', [rule.id]);
    await syncPlatform(db, row.id, { regenerate: true });
    res.json(await view(await byId(row.id)));
  });

  // ---- color suggestion, keep-or-move on rule changes, resume choices ----

  /**
   * The platform's schedule rules as they would be after a change, for
   * ruleChangeImpact.
   *
   * Usage:
   *   const rules = await proposedRules(platformId, { ruleId: 7, updates });   // PATCH
   *   const rules = await proposedRules(platformId, { updates });              // a new rule
   *   const rules = await proposedRules(platformId, { ruleId: 7, remove: true });
   *
   * Takes:
   *   ruleId  - the rule being changed or removed; absent for a new rule
   *   updates - ruleUpdates output ([column, value] pairs; postTypeIds as JSON text)
   *   remove  - true to leave the rule out
   *
   * Returns:
   *   rulesOf-shaped rules; a new rule gets id 0 and the table's defaults.
   */
  const proposedRules = async (platformId, { ruleId = null, updates = [], remove = false }) => {
    const changes = Object.fromEntries(updates.map(([col, value]) => [col, col === 'postTypeIds' ? JSON.parse(value)
      : col === 'active' ? Boolean(value) : value]));
    const rules = await rulesOf(db, platformId);
    if (remove) return rules.filter((r) => r.id !== ruleId);
    if (ruleId) return rules.map((r) => (r.id === ruleId ? { ...r, ...changes } : r));
    return [...rules, { id: 0, platformId, label: null, intervalWeeks: 1, endDate: null, postTypeIds: [],
      sortOrder: rules.length, active: true, ...changes }];
  };

  /**
   * "Keep posts already on the calendar where they are": marks the future slots whose
   * post the rule change would move as kept, before the change is saved, so regenerating leaves
   * them (and their posts) where they are until they pass. Writes one audit entry when any are kept.
   *
   * Usage:
   *   if (body.keepPosts === true) await keepPosts(req, row, await proposedRules(row.id, { updates }));
   *
   * Takes:
   *   req   - the request (for the audit entry's user)
   *   row   - the platform row
   *   rules - proposedRules output
   *
   * When editing:
   *   Call it before the rule is written: it compares the current slots with the new rules.
   */
  const keepPosts = async (req, row, rules) => {
    const { moving } = await ruleChangeImpact(db, parsePlatform(row), rules);
    if (!moving.length) return;
    await db.run(`UPDATE slot SET kept = 1 WHERE id IN (${moving.map(() => '?').join(', ')})`, moving.map((m) => m.slotId));
    await writeAudit(db, { userId: req.user?.id ?? null, action: 'scheduleRule.keepPosts', entityType: 'platform', entityId: row.id,
      summary: `Kept ${moving.length} ${row.name} post${moving.length === 1 ? '' : 's'} where ${moving.length === 1 ? 'it was' : 'they were'} `
        + `when the schedule changed (until ${moving.at(-1).date}); only new posts follow the new days` });
  };

  /**
   * POST /api/platforms/:id/rules/impact: how many posts already on the calendar a rule change
   * would move, before saving it. Nothing is saved. Needs editSchedules.
   *
   * Usage:
   *   POST /api/platforms/2/rules/impact  { ruleId: 7, rule: { byDay: "MO,FR" } }   (a change)
   *   POST /api/platforms/2/rules/impact  { rule: { byDay: "TU", time: "09:00" } }  (a new rule)
   *   POST /api/platforms/2/rules/impact  { ruleId: 7, remove: true }               (a delete)
   *
   * Takes:
   *   body.ruleId - the rule being changed or deleted (absent for a new rule)
   *   body.rule   - the fields being saved (see ruleUpdates)
   *   body.remove - true for a delete
   *
   * Returns:
   *   200 { onCalendar, moving (count), until (last date or null), posts: [{ slotId, postId, date, time }] };
   *   404 unknown platform or rule; 400 with a message for a bad field.
   */
  router.post('/:id/rules/impact', async (req, res) => {
    const row = await byId(req.params.id);
    if (!usable(row)) return res.status(404).json({ error: 'Platform not found' });
    const body = req.body ?? {};
    const rule = body.ruleId ? await ruleById(body.ruleId, row.id) : null;
    if (body.ruleId && !rule) return res.status(404).json({ error: 'Schedule rule not found' });
    let updates = [];
    if (!body.remove) {
      const fields = rule ? (body.rule ?? {}) : { startDate: localDateString(clock.now(), config.timezone), ...(body.rule ?? {}) };
      try {
        updates = ruleUpdates(fields, rule, await rotationIds(row.id));
      } catch (message) {
        return res.status(400).json({ error: message });
      }
    }
    const { onCalendar, moving } = await ruleChangeImpact(db, parsePlatform(row),
      await proposedRules(row.id, { ruleId: rule?.id ?? null, updates, remove: Boolean(body.remove) }));
    res.json({ onCalendar, moving: moving.length, until: moving.at(-1)?.date ?? null, posts: moving });
  });

  /**
   * GET /api/platforms/:id/suggest-color: the color to preselect for a Specific Date post on a
   * platform that uses colors: the opposite of the previous post's color before
   * that time, so the colors keep alternating. Any signed-in user.
   *
   * Usage:
   *   GET /api/platforms/2/suggest-color?at=2026-11-26T10:00
   *   GET /api/platforms/2/suggest-color?at=2026-11-26T10:00&exceptPostId=12   (editing post 12)
   *
   * Returns:
   *   200 { color ('Blue' | 'Purple' | null), previous ({ kind, date, time, color } or null) };
   *   404 unknown platform; 400 for a bad at.
   */
  router.get('/:id/suggest-color', async (req, res) => {
    const row = await byId(req.params.id);
    if (!usable(row)) return res.status(404).json({ error: 'Platform not found' });
    if (!parseLocalDateTime(req.query.at, config.timezone)) {
      return res.status(400).json({ error: 'at must be a local date and time, "YYYY-MM-DDTHH:MM"' });
    }
    const exceptPostId = Number(req.query.exceptPostId) || null;
    res.json(await suggestColor(db, parsePlatform(row), req.query.at, { exceptPostId }));
  });

  /**
   * GET /api/platforms/:id/missed: the queued posts whose date passed while the platform was
   * paused, for the resume choices. Any signed-in user.
   *
   * Usage:
   *   GET /api/platforms/2/missed
   *
   * Returns:
   *   200 [missedPosts row] ([] when the platform is not paused); 404 unknown platform.
   */
  router.get('/:id/missed', async (req, res) => {
    const row = await byId(req.params.id);
    if (!usable(row)) return res.status(404).json({ error: 'Platform not found' });
    res.json(row.paused ? await missedPosts(db, parsePlatform(row), clock.now()) : []);
  });

  /**
   * POST /api/platforms/:id/resume: resumes a paused platform and applies a choice per missed
   * post, in one request. Needs editPlatforms.
   *
   * Usage:
   *   POST /api/platforms/2/resume  { choices: [
   *     { postId: 12, action: "library" },
   *     { postId: 13, action: "date", fixedAt: "2026-11-30T10:00" },
   *     { postId: 14, action: "skip" } ] }
   *
   * Takes:
   *   body.choices - optional list; each postId must be one of GET /missed's posts:
   *     "library" - back to the library (a Specific Date post becomes a library post); not for a
   *                 post with canReturnToLibrary false (Holiday is date-only)
   *     "date"    - a new date and time (a future local "YYYY-MM-DDTHH:MM", New York time); a
   *                 library post becomes a Specific Date post
   *     "skip"    - marked failed with the reason "Skipped after pause" (it stays in the
   *                 Library's failed list, where it can be requeued)
   *   Posts without a choice get today's default: a library post goes back to the library and
   *   fills its next matching slot; a Specific Date post is marked failed ("pick a new date").
   *
   * Returns:
   *   200 with view(row); 404 unknown platform; 409 when it is not paused; 400 with a message for
   *   a bad choice (then nothing is changed).
   *
   * How it works:
   *   1. Checks every choice first.
   *   2. In one transaction: applies the choices, then sets paused = 0.
   *   3. syncPlatform puts everything back on the schedule and calendar (and applies the
   *      defaults to the posts without a choice).
   *   4. Writes one audit entry for the resume and one per choice.
   *
   * When editing:
   *   The choices must be saved before the sync runs unpaused, or sync would apply the
   *   defaults first. ROUTES has no entity/action for this route because the audit entries
   *   are written here. A new date is not checked against the 2-hour window or blackouts.
   */
  router.post('/:id/resume', async (req, res) => {
    const row = await byId(req.params.id);
    if (!usable(row)) return res.status(404).json({ error: 'Platform not found' });
    if (!row.paused) return res.status(409).json({ error: `${row.name} is not paused` });
    const choices = req.body?.choices ?? [];
    if (!Array.isArray(choices)) return res.status(400).json({ error: 'choices must be a list' });
    const missed = new Map((await missedPosts(db, parsePlatform(row), clock.now())).map((p) => [p.id, p]));
    const seen = new Set();
    for (const choice of choices) {
      const post = missed.get(choice?.postId);
      if (!post) return res.status(400).json({ error: `Post ${choice?.postId} is not one of ${row.name}'s missed posts` });
      if (seen.has(post.id)) return res.status(400).json({ error: `Post ${post.id} has more than one choice` });
      seen.add(post.id);
      if (!['library', 'date', 'skip'].includes(choice.action)) {
        return res.status(400).json({ error: 'action must be "library", "date" or "skip"' });
      }
      if (choice.action === 'library' && !post.canReturnToLibrary) {
        return res.status(400).json({ error: `Post ${post.id} (${post.postTypeName ?? 'no type'}) can only go out on a date; pick a new date or skip it` });
      }
      if (choice.action === 'date') {
        const at = parseLocalDateTime(choice.fixedAt, config.timezone);
        if (!at) return res.status(400).json({ error: 'fixedAt must be a local date and time, "YYYY-MM-DDTHH:MM"' });
        if (at <= clock.now()) return res.status(400).json({ error: `${choice.fixedAt.replace('T', ' ')} has already passed` });
      }
    }
    const said = [];
    await db.transaction(async (tx) => {
      const freeSlot = (postId) => tx.run('UPDATE slot SET postId = NULL, pinned = 0 WHERE postId = ?', [postId]);
      for (const choice of choices) {
        const post = missed.get(choice.postId);
        if (choice.action === 'library') {
          await freeSlot(post.id);
          await tx.run(`UPDATE post SET kind = 'library', fixedAt = NULL, scheduledAt = NULL, updatedAt = datetime('now') WHERE id = ?`, [post.id]);
          said.push([post, 'back to the library']);
        } else if (choice.action === 'date') {
          await freeSlot(post.id);
          await tx.run(`UPDATE post SET kind = 'fixed', fixedAt = ?, scheduledAt = NULL, updatedAt = datetime('now') WHERE id = ?`,
            [choice.fixedAt, post.id]);
          said.push([post, `moved to ${choice.fixedAt.replace('T', ' ')}`]);
        } else {
          // Skipped posts stay in their passed slot as history, like other failed posts
          await tx.run(`UPDATE post SET status = 'failed', lastError = 'Skipped after pause', scheduledAt = NULL,
                          updatedAt = datetime('now') WHERE id = ?`, [post.id]);
          said.push([post, 'skipped (marked failed: "Skipped after pause")']);
        }
      }
      // Last, after the choices: an unpaused sync would apply the defaults to them
      await tx.run('UPDATE platform SET paused = 0 WHERE id = ?', [row.id]);
    });
    await syncPlatform(db, row.id);
    const userId = req.user?.id ?? null;
    await writeAudit(db, { userId, action: 'platform.resume', entityType: 'platform', entityId: row.id,
      summary: `Resumed ${row.name}; ${missed.size} missed post${missed.size === 1 ? '' : 's'}, ${choices.length} with a choice` });
    for (const [post, what] of said) {
      await writeAudit(db, { userId, action: 'post.resumeChoice', entityType: 'post', entityId: post.id,
        summary: `Missed while ${row.name} was paused: ${what}` });
    }
    res.json(await view(await byId(row.id)));
  });
  return router;
}
