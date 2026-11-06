/**
 * One middleware in front of every /api route: who is asking (auth.js), may they
 * (permissions.js ROUTES), and after a change succeeds, the audit log entry and the post's
 * createdBy/updatedBy. Route files stay unaware of all three.
 *
 * What lives here: accessControl (the middleware), writeAudit (also used directly by services
 * and routers that write their own entries), and the change tracking behind it (trackChange,
 * summarize, changedFields, rowOf).
 */
import { config } from '../config.js';
import { clearSessionCookie, readSession, renewSession, sameSecret } from './auth.js';
import { can, PERMISSIONS, ROLE_LABELS, permissionsFor, routeFor } from './permissions.js';

const LABEL = Object.fromEntries(PERMISSIONS.map((p) => [p.key, p.label.toLowerCase()]));
LABEL.superAdmin = 'do this (super admins only)';

// Rows to look at before a change, to say what changed and name what was deleted
const TABLES = { post: 'post', media: 'media', user: 'appUser', slot: 'slot', platform: 'platform',
  postType: 'postType', scheduleRule: 'scheduleRule' };
// Plain names for post fields in summaries
const FIELD_NAMES = { caption: 'caption', hashtags: 'hashtags', mediaId: 'image', altText: 'alt text', kind: 'kind',
  postTypeId: 'post type', color: 'color', fixedAt: 'date', platformId: 'platform', postId: 'post', pinned: 'pin', locked: 'lock' };
const IGNORED = new Set(['force']);

// Why a sent cookie no longer signs anyone in (the page shows its own wording)
const SIGNED_OUT = {
  idle: 'You were signed out after a period of inactivity',
  absolute: 'Your session reached its time limit; sign in again',
  signedOut: 'This session was signed out',
};

// The start of a caption for a summary: spaces squeezed, at most 50 characters plus "..."
const snippet = (text) => {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > 50 ? `${clean.slice(0, 50)}...` : clean;
};

/**
 * The stored row of an audited entity, to compare against and to name in summaries.
 *
 * Takes:
 *   entity - a key of TABLES ('post', 'media', 'user', ...)
 *   id     - the row id
 *
 * Returns:
 *   The row, or null for an unknown entity, no id, no row, or a table no migration has
 *   created yet.
 */
async function rowOf(db, entity, id) {
  if (!TABLES[entity] || !id) return null;
  try {
    return (await db.get(`SELECT * FROM ${TABLES[entity]} WHERE id = ?`, [id])) ?? null;
  } catch {
    return null; // a table no migration has created yet
  }
}

/**
 * The request body fields that differ from the stored row (all of them when there is no row).
 *
 * Takes:
 *   body   - req.body (a raw upload Buffer or a non-object gives [])
 *   before - the stored row, or null
 *
 * Returns:
 *   A list of field names. "force" is never listed. A boolean is compared as 1/0 against a
 *   number column, and an object or array as its JSON text.
 */
function changedFields(body, before) {
  if (!body || Buffer.isBuffer(body) || typeof body !== 'object') return [];
  return Object.keys(body ?? {}).filter((key) => {
    if (IGNORED.has(key)) return false;
    if (!before || !(key in before)) return true;
    let value = body[key];
    if (typeof value === 'boolean' && typeof before[key] === 'number') value = value ? 1 : 0;
    if (value !== null && typeof value === 'object') return JSON.stringify(value) !== before[key];
    return value !== before[key];
  });
}

const fieldList = (fields) => fields.map((f) => FIELD_NAMES[f] ?? f).join(', ');

/**
 * The audit log's one-line summary of a change, in plain words.
 *
 * Takes:
 *   req    - the request (body and query are read)
 *   route  - the ROUTES entry ({ action })
 *   before - the row before the change (for post-type and rule creation, the platform; for
 *            permissions, every role's flags)
 *   after  - the response body (or the post row, re-read)
 *   fields - changedFields() output
 *
 * Returns:
 *   A sentence such as 'Changed caption, image on "Join us..."'; the action name itself for
 *   actions without a wording.
 *
 * When editing:
 *   These sentences are what the Activity page shows. A new audited action gets its wording
 *   here (and its entity/action in ROUTES). Platform names are looked up first, because the
 *   switch below cannot wait for the database.
 */
async function summarize(db, req, route, before, after, fields) {
  const body = req.body ?? {};
  // Looked up before the (synchronous) switch below
  const names = new Map();
  for (const id of [after?.platformId, before?.platformId, before?.id]) {
    if (id && !names.has(id)) names.set(id, (await db.get('SELECT name FROM platform WHERE id = ?', [id]))?.name);
  }
  const platformName = (id) => names.get(id) ?? 'platform';
  switch (route.action) {
    case 'post.create': return `Created ${platformName(after?.platformId)} post "${snippet(after?.caption)}"`;
    case 'post.update': return `Changed ${fieldList(fields)} on "${snippet(after?.caption ?? before?.caption)}"`;
    case 'post.requeue': return `Requeued failed post "${snippet(before?.caption)}"`;
    case 'post.delete': return `Deleted ${platformName(before?.platformId)} post "${snippet(before?.caption)}"`;
    case 'post.status': return `n8n reported ${body.status}${body.error ? `: ${body.error}` : ''}`;
    case 'slot.update': return `Changed ${fieldList(fields)} on the ${platformName(before?.platformId)} slot of ${before?.date ?? ''}`.trim();
    case 'platform.update': return `Changed ${platformName(before?.id)} settings: ${fieldList(fields)}`;
    case 'postType.create': return `Added post type "${body.name}" to ${platformName(before?.id)}`;
    case 'postType.update': return `Changed post type "${before?.name}": ${fieldList(fields)}`;
    case 'scheduleRule.create': return `Added a schedule rule to ${platformName(before?.id)}`;
    case 'scheduleRule.update': return `Changed a ${platformName(before?.platformId)} schedule rule: ${fieldList(fields)}`;
    case 'scheduleRule.delete': return `Deleted a ${platformName(before?.platformId)} schedule rule`;
    case 'media.upload': return `Uploaded image "${after?.name ?? req.query.name ?? ''}"`;
    case 'media.delete': return `Moved image "${before?.name ?? ''}" to Recently deleted`;
    case 'media.rotate': return `Rotated image "${before?.name ?? ''}"${body.degrees ? ` by ${body.degrees} degrees` : ''}`;
    case 'media.restore': return `Restored image "${before?.name ?? ''}" from Recently deleted`;
    case 'user.delete': return `Deleted ${before?.isSetup ? 'the setup account' : before?.name ?? 'a user'}`;
    case 'user.create': return `Added ${after?.name} (${ROLE_LABELS[after?.role] ?? after?.role})`;
    case 'user.update': {
      const parts = fields.map((f) => {
        if (f === 'role') return `role ${ROLE_LABELS[before?.role]} to ${ROLE_LABELS[after?.role]}`;
        if (f === 'active') return after?.active ? 'reactivated' : 'deactivated';
        return f;
      });
      return `Changed ${before?.name}: ${parts.join(', ')}`;
    }
    case 'permissions.update': {
      const changes = [];
      for (const [role, perms] of Object.entries(body.table ?? {})) {
        for (const [key, allowed] of Object.entries(perms ?? {})) {
          if (before?.[role]?.[key] !== allowed) changes.push(`${ROLE_LABELS[role]} ${allowed ? 'can' : 'cannot'} ${LABEL[key]}`);
        }
      }
      return `Changed permissions: ${changes.join('; ')}`;
    }
    default: return route.action;
  }
}

/**
 * Adds one audit log entry.
 *
 * Usage:
 *   await writeAudit(tx, { action: 'post.calendarMove', entityType: 'post', entityId: post.id, summary });
 *
 * Takes:
 *   db         - the database or a transaction (pass the transaction to log inside it)
 *   userId     - who did it, or null (the app itself, n8n, Google Calendar)
 *   action     - 'entity.verb', e.g. 'post.update'
 *   entityType - 'post', 'media', ... or null
 *   entityId   - the row id, or null
 *   summary    - the plain sentence the Activity page shows
 *
 * Returns:
 *   Nothing; throws on a database error.
 */
export async function writeAudit(db, { userId = null, action, entityType = null, entityId = null, summary = '' }) {
  await db.run('INSERT INTO auditLog (userId, action, entityType, entityId, summary) VALUES (?, ?, ?, ?, ?)',
    [userId, action, entityType, entityId, summary]);
}

/**
 * Runs once the route answered with a success: log entry plus createdBy/updatedBy on posts.
 * The response is held back until both are written, so whoever got it can already see them.
 *
 * Takes:
 *   route - the ROUTES entry with entity, action, id and params
 *
 * How it works:
 *   1. Before the route runs: reads the row as it is now. The id is the path group named by
 *      route.id (default 1; null = taken from the response). Platform-level actions (adding a
 *      post type or a rule) look at the platform (first id); others at their own row; a
 *      permissions save reads every role's flags.
 *   2. Wraps res.json and res.end. On the first one with a status below 400 it:
 *      - skips the entry for an edit that changed nothing (not worth a log entry);
 *      - on posts, sets createdBy/updatedBy (create) or updatedBy and updatedAt (other
 *        changes, not delete), and puts them in the response body too;
 *      - writes the entry with summarize(); a user who deleted their own account (the setup
 *        account) no longer exists to point at, so it is logged with no user;
 *      - for a slot change that pins a post, also writes post.pin, so pinning shows up in
 *        that post's history.
 *   3. Then sends the response. json() fills in createdBy/updatedBy before the body is sent;
 *      end() covers 204s and other bodies.
 *
 * When editing:
 *   An audit failure is logged and never fails the request. The `done` flag stops a json()
 *   that calls end() from writing twice.
 */
async function trackChange(db, req, res, route) {
  const pathId = route.id === null ? null : Number(route.params[(route.id ?? 1) - 1]);
  // Platform-level actions look at the platform (first id)
  const beforeEntity = ['postType.create', 'scheduleRule.create'].includes(route.action) ? 'platform' : route.entity;
  let before;
  if (route.entity === 'permissions') {
    before = {};
    for (const role of ['admin', 'manager', 'employee']) before[role] = await permissionsFor(db, role);
  } else {
    before = await rowOf(db, beforeEntity, beforeEntity === 'platform' ? Number(route.params[0]) : pathId);
  }
  const userId = req.user?.id ?? null;

  let done = false;
  const record = async (body) => {
    if (done || res.statusCode >= 400) return;
    done = true;
    try {
      const entityId = pathId ?? body?.id ?? null;
      const after = route.entity === 'post' && body?.id === undefined ? await rowOf(db, 'post', entityId) : body;
      const fields = changedFields(req.body, before);
      // An edit that changed nothing: no entry
      if (route.action.endsWith('.update') && route.entity !== 'permissions' && fields.length === 0) return;

      if (route.entity === 'post' && userId) {
        if (route.action === 'post.create') {
          await db.run('UPDATE post SET createdBy = ?, updatedBy = ? WHERE id = ?', [userId, userId, entityId]);
          if (body) Object.assign(body, { createdBy: userId, updatedBy: userId });
        } else if (route.action !== 'post.delete') {
          await db.run("UPDATE post SET updatedBy = ?, updatedAt = datetime('now') WHERE id = ?", [userId, entityId]);
          if (body && typeof body === 'object') body.updatedBy = userId;
        }
      }
      // An account that deleted itself no longer exists to point at
      const actorId = route.action === 'user.delete' && entityId === userId ? null : userId;
      await writeAudit(db, { userId: actorId, action: route.action, entityType: route.entity, entityId,
        summary: await summarize(db, req, route, before, after, fields) });
      if (route.action === 'slot.update' && Number.isInteger(req.body?.postId)) {
        await writeAudit(db, { userId, action: 'post.pin', entityType: 'post', entityId: req.body.postId,
          summary: `Pinned to the slot of ${before?.date ?? ''}`.trim() });
      }
    } catch (err) {
      console.error('Audit log failed:', err);
    }
  };
  const json = res.json.bind(res);
  const end = res.end.bind(res);
  res.json = (body) => {
    record(body).then(() => json(body));
    return res;
  };
  res.end = (...args) => {
    if (done) return end(...args);
    record(null).then(() => end(...args));
    return res;
  };
}

/**
 * The middleware: sign-in check, permission check and change tracking for /api requests.
 *
 * Usage:
 *   app.use(accessControl(db));   // app.js, before every router
 *
 * Returns:
 *   An Express middleware. It answers by itself with:
 *   401 { error, reason? } - not signed in, or the session ended (reason idle, absolute or
 *                            signedOut, with the matching sentence)
 *   401 { error }          - n8n's status callback without the right X-Callback-Secret
 *   403 { error, permission } - signed in but the role lacks the route's permission
 *   Otherwise it sets req.user and req.session and calls next().
 *
 * How it works:
 *   1. Leaves non-/api paths alone.
 *   2. Reads the session cookie (auth.js) and finds the route's ROUTES entry; an unlisted
 *      mutating route is logged as a warning (only super admins may call it).
 *   3. A cookie that no longer counts is removed; a live one is renewed (the idle timer
 *      slides), except on routes marked renew: false.
 *   4. n8n's status callback: with N8N_CALLBACK_SECRET set, a caller without a session must send it.
 *   5. Open routes take callers with no session (n8n, the dispatcher); a signed-in person
 *      still needs the permission. Every other route needs a session and the permission.
 *   6. For routes with an audit action, starts change tracking (trackChange).
 *
 * When editing:
 *   This is the app's access check; any change here changes who may do what everywhere.
 */
export function accessControl(db) {
  return async (req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    const { user, session, reason } = await readSession(db, req);
    req.user = user;
    req.session = session ?? null;
    const route = routeFor(req.method, req.path);
    if (route.unlisted) console.warn(`${req.method} ${req.path} has no permission entry; only super admins may call it`);
    // A cookie that no longer counts is removed; a live one is renewed (the idle timer slides)
    if (reason) clearSessionCookie(res);
    if (session && route.renew !== false) req.session = renewSession(res, session);

    // n8n's status callback: with N8N_CALLBACK_SECRET set, a caller without a session must send it
    if (route.callbackSecret && config.n8nCallbackSecret && !req.user
        && !sameSecret(req.get('x-callback-secret'), config.n8nCallbackSecret)) {
      return res.status(401).json({ error: 'Missing or wrong X-Callback-Secret header' });
    }

    // Open routes take callers with no session (n8n, the dispatcher); a signed-in person still needs the permission
    const needsCheck = route.open ? Boolean(req.user && route.permission) : true;
    if (needsCheck) {
      if (!req.user) return res.status(401).json({ error: SIGNED_OUT[reason] ?? 'Sign in required', ...(reason ? { reason } : {}) });
      if (route.permission && !(await can(db, req.user, route.permission))) {
        return res.status(403).json({
          error: `${ROLE_LABELS[req.user.role]}s cannot ${LABEL[route.permission] ?? route.permission}`,
          permission: route.permission,
        });
      }
    }
    if (route.action) await trackChange(db, req, res, route);
    next();
  };
}
