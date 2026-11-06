/**
 * Sign-in, users, the permission table and the activity log, all mounted at /api.
 * Who may call each route is set in ROUTES in services/permissions.js and checked by
 * services/access.js before the handler runs; the audit log entries for user changes are
 * written there too.
 *
 * What lives here:
 *   canManageRole  which roles a signed-in user may add, change or delete
 *   usersRouter    the routes
 */
import { Router } from 'express';
import { clearSessionCookie, identify, revokeSession, sessionTimes, signInOptions, startSession, userView } from '../services/auth.js';
import { permissionTable, permissionsFor, riskyGrants, ROLE_LABELS, ROLES, roleRank, savePermissions } from '../services/permissions.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Whether `actor` may manage a user with `role`.
 *
 * Usage:
 *   if (!canManageRole(req.user, body.role)) return res.status(403)...
 *
 * Takes:
 *   actor - the signed-in user ({ role })
 *   role  - the role of the user being added or changed (or the role they would get)
 *
 * Returns:
 *   true when allowed. Super admins manage everyone, other super admins included; everyone
 *   else manages roles at or below their own and never super admins.
 *
 * When editing:
 *   Who may manage users at all is the manageUsers permission, checked by services/access.js.
 *   GET /users also sends this as canManage, which the Users page uses to show the buttons.
 */
export function canManageRole(actor, role) {
  if (actor.role === 'superAdmin') return true;
  return role !== 'superAdmin' && roleRank(role) <= roleRank(actor.role);
}

/**
 * The users router, mounted at /api.
 *
 * Usage:
 *   app.use('/api', usersRouter(db));   (app.js)
 *
 * Takes:
 *   db - the open database
 *
 * Returns:
 *   An Express router with the routes below.
 */
export function usersRouter(db) {
  const router = Router();
  const userById = (id) => db.get('SELECT * FROM appUser WHERE id = ?', [id]);
  const activeSuperAdmins = async () => (await db.get("SELECT COUNT(*) AS n FROM appUser WHERE role = 'superAdmin' AND active = 1")).n;
  const otherActiveSuperAdmins = async (id) =>
    (await db.get("SELECT COUNT(*) AS n FROM appUser WHERE role = 'superAdmin' AND active = 1 AND isSetup = 0 AND id != ?", [id])).n;

  // ---- Sign-in (TEMPORARY method plus the setup code; see services/auth.js) ----

  /**
   * GET /api/auth/options: what the sign-in screen offers. No sign-in needed.
   *
   * Usage:
   *   GET /api/auth/options
   *
   * Returns:
   *   200 with signInOptions(db) (services/auth.js).
   */
  router.get('/auth/options', async (req, res) => res.json(await signInOptions(db)));

  /**
   * GET /api/auth/me: who is signed in. No sign-in needed.
   *
   * Usage:
   *   GET /api/auth/me
   *
   * Returns:
   *   200 { user: null } when nobody is signed in, otherwise
   *   200 { user (userView), permissions ({ key: bool }), session (sessionTimes) }
   */
  router.get('/auth/me', async (req, res) => {
    if (!req.user) return res.json({ user: null });
    res.json({ user: userView(req.user), permissions: await permissionsFor(db, req.user.role), session: sessionTimes(req.session) });
  });

  /**
   * GET /api/auth/session: how long the session has left, without renewing it. No sign-in needed.
   *
   * Usage:
   *   GET /api/auth/session
   *
   * Returns:
   *   200 { active: true, ...sessionTimes } or 200 { active: false }
   *
   * When editing:
   *   The page checks this before warning or signing someone out, since another tab may have
   *   kept the session alive. It must not count as activity (renew: false in ROUTES).
   */
  router.get('/auth/session', (req, res) => {
    res.json(req.user ? { active: true, ...sessionTimes(req.session) } : { active: false });
  });

  /**
   * POST /api/auth/sign-in: signs someone in and starts a session cookie. No sign-in needed.
   *
   * Usage:
   *   POST /api/auth/sign-in  { setupCode: "ABCD..." }   or, in test mode only, { userId: 3 }
   *
   * Takes:
   *   body - checked by identify (services/auth.js), which also applies the setup code's
   *          wrong-code limit per IP address
   *
   * Returns:
   *   200 { user, permissions, session }; the status and error identify throws otherwise
   *   (400 no such active user, 501 no sign-in method on this server, or a wrong, expired or
   *   rate-limited setup code).
   *
   * When editing:
   *   Always start a new session id and revoke the one this browser had (if any), so an old
   *   cookie cannot be reused.
   */
  router.post('/auth/sign-in', async (req, res) => {
    let user;
    try {
      user = await identify(db, req.body, req.ip);
    } catch (err) {
      if (!err?.status) throw err;
      return res.status(err.status).json({ error: err.error });
    }
    // Always a new session id; the one this browser had (if any) ends
    await revokeSession(db, req.session);
    const session = startSession(res, user.id);
    res.json({ user: userView(user), permissions: await permissionsFor(db, user.role), session: sessionTimes(session) });
  });

  /**
   * POST /api/auth/sign-out: ends the session. No sign-in needed.
   *
   * Usage:
   *   POST /api/auth/sign-out
   *
   * Returns:
   *   204, with the session cookie cleared.
   *
   * How it works:
   *   Revokes the session on the server too, so a copy of the cookie no longer works.
   */
  router.post('/auth/sign-out', async (req, res) => {
    await revokeSession(db, req.session);
    clearSessionCookie(res);
    res.status(204).end();
  });

  // ---- Users ----

  /**
   * GET /api/users: everyone, for the Users page. Needs manageUsers.
   *
   * Usage:
   *   GET /api/users
   *
   * Returns:
   *   200 [{ ...userView, canManage }], active first, then by role (super admin first), then name.
   */
  router.get('/users', async (req, res) => {
    const rows = await db.all(`SELECT * FROM appUser ORDER BY active DESC,
      CASE role WHEN 'superAdmin' THEN 0 WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, name`);
    res.json(rows.map((row) => ({ ...userView(row), canManage: canManageRole(req.user, row.role) })));
  });

  /**
   * Checks name, email, role and active in body, for a new user (current null: name, email and
   * role required) or a change to `current`.
   *
   * Usage:
   *   const updates = await userUpdates(body, user);   // [['email', 'a@b.org'], ...]
   *
   * Returns:
   *   The [column, value] pairs to write, only those that change. Throws a message (a 400), or
   *   { status: 409, error } when the email already has an account.
   *
   * How it works:
   *   name is trimmed, 1 to 80 characters; email is trimmed and lower-cased and must be unused;
   *   role must be one of ROLES; active must be true or false.
   */
  const userUpdates = async (body, current) => {
    const updates = [];
    if ('name' in body || !current) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 80) throw 'name must be 1 to 80 characters';
      updates.push(['name', name]);
    }
    if ('email' in body || !current) {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!EMAIL.test(email)) throw 'email must be an email address';
      const taken = await db.get('SELECT 1 FROM appUser WHERE email = ? AND id != ?', [email, current?.id ?? 0]);
      if (taken) throw { status: 409, error: `${email} already has an account` };
      updates.push(['email', email]);
    }
    if ('role' in body || !current) {
      if (!ROLES.includes(body.role)) throw `role must be one of ${ROLES.join(', ')}`;
      updates.push(['role', body.role]);
    }
    if ('active' in body) {
      if (typeof body.active !== 'boolean') throw 'active must be true or false';
      updates.push(['active', body.active ? 1 : 0]);
    }
    return updates.filter(([col, value]) => !current || current[col] !== value);
  };
  // A thrown message is a 400; a thrown { status, error } keeps its status
  const fail = (res, err) => (typeof err === 'string' ? res.status(400).json({ error: err }) : res.status(err.status).json({ error: err.error }));

  /**
   * POST /api/users: adds a user (active unless the body says otherwise). Needs manageUsers.
   *
   * Usage:
   *   POST /api/users  { name: "Ana Ruiz", email: "ana@example.org", role: "employee" }
   *
   * Returns:
   *   201 with the new user (userView); 400 for a bad field; 409 when the email is taken;
   *   403 when the signed-in user may not add that role (canManageRole).
   */
  router.post('/users', async (req, res) => {
    const body = { active: true, ...req.body };
    let updates;
    try {
      updates = await userUpdates(body, null);
    } catch (err) {
      return fail(res, err);
    }
    if (!canManageRole(req.user, body.role)) {
      return res.status(403).json({ error: `${ROLE_LABELS[req.user.role]}s cannot add a ${ROLE_LABELS[body.role]}` });
    }
    const { lastInsertRowid } = await db.run(`INSERT INTO appUser (${updates.map(([col]) => col).join(', ')})
                                              VALUES (${updates.map(() => '?').join(', ')})`, updates.map(([, v]) => v));
    res.status(201).json(userView(await userById(lastInsertRowid)));
  });

  /**
   * PATCH /api/users/:id: edits a user or (de)activates them. Needs manageUsers.
   *
   * Usage:
   *   PATCH /api/users/4  { role: "manager" }   or   { active: false }
   *
   * Takes:
   *   body - any of name, email, role, active
   *
   * Returns:
   *   200 with the user (userView); 404 unknown user; 400 bad field, or a name/email/role change
   *   on the setup account (it is temporary); 409 email taken, or the last active super admin
   *   would lose that; 403 when the signed-in user may not manage this user or give that role.
   *
   * When editing:
   *   Users are never deleted, so the activity log keeps their name; deactivate instead.
   *   The role check runs twice: on the user as they are and as they would be.
   */
  router.patch('/users/:id', async (req, res) => {
    const user = await userById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const body = req.body ?? {};
    if (!canManageRole(req.user, user.role)) {
      return res.status(403).json({ error: `${ROLE_LABELS[req.user.role]}s cannot change a ${ROLE_LABELS[user.role]}` });
    }
    if (user.isSetup && ['name', 'email', 'role'].some((key) => key in body)) {
      return res.status(400).json({ error: 'The setup account is temporary and cannot be changed; add a real super admin, then delete it' });
    }
    let updates;
    try {
      updates = await userUpdates(body, user);
    } catch (err) {
      return fail(res, err);
    }
    const after = { ...user, ...Object.fromEntries(updates) };
    if (!canManageRole(req.user, after.role)) {
      return res.status(403).json({ error: `${ROLE_LABELS[req.user.role]}s cannot make someone a ${ROLE_LABELS[after.role]}` });
    }
    // Never leave the app without an active super admin
    const losesSuperAdmin = user.role === 'superAdmin' && user.active && (after.role !== 'superAdmin' || !after.active);
    if (losesSuperAdmin && (await activeSuperAdmins()) <= 1) {
      return res.status(409).json({ error: 'This is the last active super admin; make someone else a super admin first' });
    }
    if (updates.length > 0) {
      await db.run(`UPDATE appUser SET ${updates.map(([col]) => `${col} = ?`).join(', ')}, updatedAt = datetime('now') WHERE id = ?`,
        [...updates.map(([, v]) => v), user.id]);
    }
    res.json(userView(await userById(user.id)));
  });

  /**
   * DELETE /api/users/:id: deletes the temporary setup account. Needs manageUsers, and in
   * practice a super admin (only they can manage a super admin, which the setup account is).
   *
   * Usage:
   *   DELETE /api/users/1
   *
   * Returns:
   *   204 (and the cookie cleared when it was the caller's own account); 404 unknown user;
   *   409 for anyone but the setup account (deactivate them instead), or when no other active
   *   super admin exists yet; 403 when the caller may not manage it.
   *
   * How it works:
   *   In one transaction: its activity log entries and its posts' createdBy/updatedBy lose the
   *   link (the entries stay, without a name), then the row is deleted.
   *
   * When editing:
   *   Only the setup account is ever deleted for real; everyone else is deactivated, so the
   *   activity log keeps their name.
   */
  router.delete('/users/:id', async (req, res) => {
    const user = await userById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    // Only the setup account may be deleted
    if (!user.isSetup) {
      return res.status(409).json({ error: 'Only the setup account can be deleted; deactivate this user instead, so the activity log keeps their name' });
    }
    if (!canManageRole(req.user, user.role)) {
      return res.status(403).json({ error: `${ROLE_LABELS[req.user.role]}s cannot delete the setup account` });
    }
    if ((await otherActiveSuperAdmins(user.id)) === 0) {
      return res.status(409).json({ error: 'Add another active super admin before deleting the setup account' });
    }
    await db.transaction(async (tx) => {
      await tx.run('UPDATE auditLog SET userId = NULL WHERE userId = ?', [user.id]);
      await tx.run('UPDATE post SET createdBy = NULL WHERE createdBy = ?', [user.id]);
      await tx.run('UPDATE post SET updatedBy = NULL WHERE updatedBy = ?', [user.id]);
      await tx.run('DELETE FROM appUser WHERE id = ?', [user.id]);
    });
    if (user.id === req.user.id) clearSessionCookie(res);
    res.status(204).end();
  });

  // ---- Permissions (editing is super admin only) ----

  /**
   * GET /api/permissions: the whole permission table. Any signed-in user.
   *
   * Usage:
   *   GET /api/permissions
   *
   * Returns:
   *   200 { roles, permissions, table: { role: { permission: bool } } } (permissionTable).
   */
  router.get('/permissions', async (req, res) => res.json(await permissionTable(db)));

  /**
   * PUT /api/permissions: saves the permission table. Super admins only.
   *
   * Usage:
   *   PUT /api/permissions  { table: { manager: { deletePosts: true } }, confirmRisky: true }
   *
   * Takes:
   *   body.table        - { role: { permission: true/false } }; roles and permissions left out
   *                       stay as they are
   *   body.confirmRisky - must be true when the save newly turns on a delete permission
   *
   * Returns:
   *   200 with the new permissionTable; 409 { error, needsConfirm: [riskyGrants] } when a delete
   *   permission would be turned on without confirmRisky; 400 with savePermissions' message for
   *   an unknown role or permission or a bad value.
   *
   * When editing:
   *   The Permissions page shows a warning and a typed confirm before sending confirmRisky.
   *   savePermissions writes all or nothing.
   */
  router.put('/permissions', async (req, res) => {
    // Giving a role a delete permission must be confirmed on purpose (409 until confirmRisky: true)
    const granted = await riskyGrants(db, req.body?.table);
    if (granted.length && req.body?.confirmRisky !== true) {
      return res.status(409).json({ error: 'Turning on delete permissions needs confirming', needsConfirm: granted });
    }
    try {
      await savePermissions(db, req.body?.table);
    } catch (message) {
      if (typeof message !== 'string') throw message;
      return res.status(400).json({ error: message });
    }
    res.json(await permissionTable(db));
  });

  // ---- Activity log ----

  /**
   * GET /api/activity: the activity log, newest first. Needs viewActivity.
   *
   * Usage:
   *   GET /api/activity?entityType=post&entityId=12   one post's history
   *   GET /api/activity?userId=3                      one person's changes
   *   GET /api/activity?before=500&limit=100          the page before entry 500
   *
   * Takes:
   *   entityType, entityId, userId, before - optional filters
   *   limit - default 100, 1 to 500
   *
   * Returns:
   *   200 [{ ...auditLog row, userName, userEmail }] (name and email null for a deleted user).
   */
  router.get('/activity', async (req, res) => {
    const { entityType, entityId, userId, before } = req.query;
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const where = [];
    const params = [];
    for (const [condition, value] of [['auditLog.entityType = ?', entityType], ['auditLog.entityId = ?', entityId],
      ['auditLog.userId = ?', userId], ['auditLog.id < ?', before]]) {
      if (!value) continue;
      where.push(condition);
      params.push(value);
    }
    const rows = await db.all(`SELECT auditLog.*, appUser.name AS userName, appUser.email AS userEmail
                               FROM auditLog LEFT JOIN appUser ON appUser.id = auditLog.userId
                               ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                               ORDER BY auditLog.id DESC LIMIT ?`, [...params, limit]);
    res.json(rows);
  });

  return router;
}
