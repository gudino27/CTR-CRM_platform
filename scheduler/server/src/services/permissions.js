/**
 * Roles, the permissions super admins hand out to them, and which permission each API route
 * needs. app.js checks every request against ROUTES (through access.js), so route files never
 * check permissions themselves (a few exceptions check a second permission, noted in ROUTES:
 * notifications resolve, archive delete, editing a scheduled post, and an upload that would
 * bring an image back from Recently deleted, which only super admins may do).
 *
 * What lives here: ROLES, ROLE_LABELS, PERMISSIONS, ROUTES, and the helpers routeFor, can,
 * permissionsFor, permissionTable, riskyGrants, savePermissions and roleRank.
 *
 * When editing:
 *   A new permission key needs default rows for admin, manager and employee in a migration
 *   (both db/migrations/ and db/migrations/mariadb/); a role without a row is denied.
 *   Every new mutating /api route needs an entry in ROUTES, or only super admins may call it.
 */

export const ROLES = ['superAdmin', 'admin', 'manager', 'employee'];
// The role key 'employee' is stored in the database; people read it as "Team member"
export const ROLE_LABELS = { superAdmin: 'Super admin', admin: 'Admin', manager: 'Manager', employee: 'Team member' };

export const PERMISSIONS = [
  { key: 'createPosts', label: 'Create posts' },
  { key: 'editPosts', label: 'Edit posts (and requeue failed ones)' },
  { key: 'deletePosts', label: 'Delete posts', risky: true },
  { key: 'editSlots', label: 'Edit calendar slots (type, color, pin, lock)' },
  { key: 'editSchedules', label: 'Edit schedules (repeating posting rules)' },
  { key: 'editPlatforms', label: 'Edit platform settings' },
  { key: 'managePostTypes', label: 'Add and rename post types' },
  { key: 'uploadMedia', label: 'Upload images' },
  { key: 'deleteMedia', label: 'Delete images', risky: true },
  { key: 'manageUsers', label: 'Add, edit and deactivate users' },
  { key: 'viewActivity', label: 'See the activity log' },
  // Notification area; defaults in migration 009 (admin and manager yes, employee no)
  { key: 'viewNotifications', label: 'See notifications' },
  // Archive page; defaults in migration 013 (admin yes, manager and employee no)
  { key: 'archivePosts', label: 'Archive old posts' },
  // Scheduled posts; defaults in migration 014 (admin and manager yes, employee no).
  // Checked by routes/posts.js on top of editPosts, see isScheduled there.
  { key: 'editScheduledPosts', label: "Edit posts once they're scheduled" },
];
const PERMISSION_KEYS = new Set(PERMISSIONS.map((p) => p.key));

/**
 * A role's rank for "who may manage whom": higher manages lower; a role can only manage
 * roles at or below its own.
 *
 * Usage:
 *   roleRank(role) <= roleRank(actor.role)   // routes/users.js
 *
 * Returns:
 *   superAdmin 4, admin 3, manager 2, employee 1. An unknown role gives 0, below everyone,
 *   so a typo can never outrank a real role.
 */
export const roleRank = (role) => (ROLES.includes(role) ? ROLES.length - ROLES.indexOf(role) : 0);

/**
 * Every permission's allowed flag for a role; super admins always have all of them.
 *
 * Usage:
 *   const perms = await permissionsFor(db, 'manager');   // { createPosts: true, ... }
 *
 * Returns:
 *   { [permission key]: boolean } for every key in PERMISSIONS. A key with no rolePermission
 *   row counts as false.
 */
export async function permissionsFor(db, role) {
  if (role === 'superAdmin') return Object.fromEntries(PERMISSIONS.map((p) => [p.key, true]));
  const rows = await db.all('SELECT permission, allowed FROM rolePermission WHERE role = ?', [role]);
  const allowed = new Map(rows.map((r) => [r.permission, Boolean(r.allowed)]));
  return Object.fromEntries(PERMISSIONS.map((p) => [p.key, allowed.get(p.key) ?? false]));
}

/**
 * Whether a user may do something.
 *
 * Usage:
 *   if (!(await can(db, req.user, 'editPosts'))) return res.status(403)...
 *
 * Takes:
 *   user       - the signed-in user ({ active, role }), or null
 *   permission - a key from PERMISSIONS, or "superAdmin", which means only super admins
 *
 * Returns:
 *   false for no user or an inactive one; true for any super admin; otherwise the role's
 *   rolePermission row (no row = false).
 *
 * When editing:
 *   This is the one permission check every route relies on; keep the inactive check first.
 */
export async function can(db, user, permission) {
  if (!user?.active) return false;
  if (user.role === 'superAdmin') return true;
  if (permission === 'superAdmin') return false;
  return Boolean((await db.get('SELECT allowed FROM rolePermission WHERE role = ? AND permission = ?', [user.role, permission]))?.allowed);
}

/**
 * The whole table for the Permissions page.
 *
 * Usage:
 *   res.json(await permissionTable(db));   // GET /api/permissions
 *
 * Returns:
 *   { roles: [{ key, label, editable }] (super admin not editable), permissions: PERMISSIONS,
 *     table: { role: { permission: bool } } }
 */
export async function permissionTable(db) {
  const table = {};
  for (const role of ROLES) table[role] = await permissionsFor(db, role);
  return {
    roles: ROLES.map((key) => ({ key, label: ROLE_LABELS[key], editable: key !== 'superAdmin' })),
    permissions: PERMISSIONS,
    table,
  };
}

/**
 * The delete permissions a save would newly turn on, so the page can ask first.
 *
 * Usage:
 *   const granted = await riskyGrants(db, req.body.table); // [{ role, permission, label }]
 *
 * Takes:
 *   table - the same { role: { permission: bool } } that savePermissions takes
 *
 * Returns:
 *   One entry per role and risky permission (risky: true in PERMISSIONS) that is off now and would be on.
 *   Turning one off, or saving one that is already on, is not listed.
 *
 * When editing:
 *   PUT /api/permissions refuses these without { confirmRisky: true } (routes/users.js), and the
 *   Permissions page shows a warning and a typed confirm before sending it.
 */
export async function riskyGrants(db, table) {
  const granted = [];
  for (const [role, perms] of Object.entries(table ?? {})) {
    if (!ROLES.includes(role) || role === 'superAdmin' || !perms || typeof perms !== 'object') continue;
    const now = await permissionsFor(db, role);
    for (const permission of PERMISSIONS.filter((p) => p.risky)) {
      if (perms[permission.key] === true && !now[permission.key]) {
        granted.push({ role, roleLabel: ROLE_LABELS[role], permission: permission.key, label: permission.label });
      }
    }
  }
  return granted;
}

/**
 * Saves the Permissions page's table.
 *
 * Usage:
 *   await savePermissions(db, req.body.table);   // PUT /api/permissions
 *
 * Takes:
 *   table - { role: { permission: bool } }; only the roles and keys given are changed
 *
 * Returns:
 *   How many flags were written. Throws a plain message (a string) for a bad shape, an
 *   unknown role or permission, a non-boolean value, or any superAdmin entry (super admins
 *   always have every permission); nothing is saved then.
 *
 * How it works:
 *   Checks everything first, then upserts each flag in one transaction: all or nothing, so a
 *   failed save never leaves half a table.
 *
 * When editing:
 *   The upsert's "ON CONFLICT ... DO UPDATE" is rewritten for MariaDB by db/client.js.
 */
export async function savePermissions(db, table) {
  if (!table || typeof table !== 'object') throw 'table must be { role: { permission: true/false } }';
  const changes = [];
  for (const [role, perms] of Object.entries(table)) {
    if (role === 'superAdmin') throw 'Super admins always have every permission';
    if (!ROLES.includes(role)) throw `Unknown role "${role}"`;
    if (!perms || typeof perms !== 'object') throw `${role} must be { permission: true/false }`;
    for (const [permission, allowed] of Object.entries(perms)) {
      if (!PERMISSION_KEYS.has(permission)) throw `Unknown permission "${permission}"`;
      if (typeof allowed !== 'boolean') throw `${role}.${permission} must be true or false`;
      changes.push([role, permission, allowed ? 1 : 0]);
    }
  }
  const upsert = `INSERT INTO rolePermission (role, permission, allowed) VALUES (?, ?, ?)
                  ON CONFLICT (role, permission) DO UPDATE SET allowed = excluded.allowed`;
  // All or nothing, so a failed save never leaves half a table
  await db.transaction(async (tx) => {
    for (const change of changes) await tx.run(upsert, change);
  });
  return changes.length;
}

/*
 * What each /api route needs. Matched in order on method + path; the first hit wins.
 *   permission: a key above, "superAdmin", or null (any signed-in user).
 *   open: true  = no sign-in needed (health, sign-in itself, machine callers).
 *   entity/action: how the change is written to the audit log; `id` is the path
 *   group holding the entity's id (default 1), or taken from the response when absent.
 * GETs not listed need any signed-in user. Mutating routes not listed are super admin
 * only, so a new route is locked down until someone adds it here.
 */
const n = '(\\d+)';
const route = (method, pattern, permission, audit = {}) =>
  ({ method, pattern: new RegExp(`^/api${pattern}/?$`), permission, ...audit });

export const ROUTES = [
  // No sign-in: health checks, the sign-in screen, and machine callers
  route('GET', '/health', null, { open: true }),
  route('GET', '/auth/me', null, { open: true }),
  route('GET', '/auth/options', null, { open: true }),
  // How long the session has left; asking does not count as activity (renew: false)
  route('GET', '/auth/session', null, { open: true, renew: false }),
  route('POST', '/auth/sign-in', null, { open: true, renew: false }),
  route('POST', '/auth/sign-out', null, { open: true, renew: false }),
  // n8n reports back without a session; a signed-in person needs editPosts (see app.js)
  // With N8N_CALLBACK_SECRET set, a caller without a session must send it (callbackSecret, see access.js)
  route('POST', `/posts/${n}/status`, 'editPosts', { open: true, callbackSecret: true, entity: 'post', action: 'post.status' }),
  // The dispatcher posts to the built-in test endpoint from inside the server
  route('POST', '/test-webhook', null, { open: true }),

  route('POST', '/posts', 'createPosts', { entity: 'post', action: 'post.create', id: null }),
  // A scheduled post also needs editScheduledPosts, which routes/posts.js checks itself
  route('PATCH', `/posts/${n}`, 'editPosts', { entity: 'post', action: 'post.update' }),
  route('POST', `/posts/${n}/requeue`, 'editPosts', { entity: 'post', action: 'post.requeue' }),
  route('DELETE', `/posts/${n}`, 'deletePosts', { entity: 'post', action: 'post.delete' }),

  route('PATCH', `/slots/${n}`, 'editSlots', { entity: 'slot', action: 'slot.update' }),
  // A slot's new post type for its later slots too; the router writes its own audit entry
  route('POST', `/slots/${n}/type-change`, 'editSlots'),

  route('PATCH', `/platforms/${n}`, 'editPlatforms', { entity: 'platform', action: 'platform.update' }),
  route('POST', `/platforms/${n}/post-types`, 'managePostTypes', { entity: 'platform', action: 'postType.create' }),
  route('PATCH', `/platforms/${n}/post-types/${n}`, 'managePostTypes', { entity: 'postType', action: 'postType.update', id: 2 }),
  route('POST', `/platforms/${n}/rules`, 'editSchedules', { entity: 'platform', action: 'scheduleRule.create' }),
  route('PATCH', `/platforms/${n}/rules/${n}`, 'editSchedules', { entity: 'scheduleRule', action: 'scheduleRule.update', id: 2 }),
  route('DELETE', `/platforms/${n}/rules/${n}`, 'editSchedules', { entity: 'scheduleRule', action: 'scheduleRule.delete', id: 2 }),
  // Rule changes and resume (routes/platforms.js): previewing a rule change saves nothing; the
  // resume with a choice per missed post writes its own audit entries
  route('POST', `/platforms/${n}/rules/impact`, 'editSchedules'),
  route('POST', `/platforms/${n}/resume`, 'editPlatforms'),

  // Re-uploading an image that is in Recently deleted brings it back for super admins only (routes/media.js)
  route('POST', '/media', 'uploadMedia', { entity: 'media', action: 'media.upload', id: null }),
  route('DELETE', `/media/${n}`, 'deleteMedia', { entity: 'media', action: 'media.delete' }),
  // Turning an image changes it like a new upload; bringing one back from Recently deleted undoes a delete
  route('POST', `/media/${n}/rotate`, 'uploadMedia', { entity: 'media', action: 'media.rotate' }),
  route('POST', `/media/${n}/restore`, 'deleteMedia', { entity: 'media', action: 'media.restore' }),

  route('GET', '/users', 'manageUsers'),
  route('POST', '/users', 'manageUsers', { entity: 'user', action: 'user.create', id: null }),
  route('PATCH', `/users/${n}`, 'manageUsers', { entity: 'user', action: 'user.update' }),
  // Only the setup account is ever deleted, and only by a super admin (routes/users.js)
  route('DELETE', `/users/${n}`, 'manageUsers', { entity: 'user', action: 'user.delete' }),
  route('GET', '/permissions', null),
  route('PUT', '/permissions', 'superAdmin', { entity: 'permissions', action: 'permissions.update' }),
  route('GET', '/activity', 'viewActivity'),

  // Test mode clock and a manual resync: anyone signed in, not written to the log
  route('POST', '/clock', null),
  route('POST', '/sync', null),

  // Blackout dates: they reshape the schedule like rules do. The router writes
  // its own audit entries (it knows the platform and dates), so no entity/action here.
  route('POST', '/blackouts', 'editSchedules'),
  route('PATCH', `/blackouts/${n}`, 'editSchedules'),
  route('DELETE', `/blackouts/${n}`, 'editSchedules'),

  // Notification area: seeing and marking read needs viewNotifications (read state
  // is shared); the bell's count does not renew the session, so a page left open still times out.
  // The caption choice needs viewNotifications here AND editPosts, which routes/notifications.js
  // checks itself (a route has one permission here); the router writes its own audit entry on the post.
  route('GET', '/notifications', 'viewNotifications'),
  route('GET', '/notifications/count', 'viewNotifications', { renew: false }),
  route('POST', `/notifications/${n}/read`, 'viewNotifications'),
  route('POST', '/notifications/read-all', 'viewNotifications'),
  route('POST', `/notifications/${n}/resolve`, 'viewNotifications'),

  // Archive for old published posts: the page and archiving need archivePosts.
  // Deleting archived posts for good needs deletePosts here AND archivePosts, which
  // routes/archive.js checks itself. The service writes one audit entry per bulk action.
  route('GET', '/archive', 'archivePosts'),
  route('POST', '/archive/archive', 'archivePosts'),
  route('POST', '/archive/unarchive', 'archivePosts'),
  route('POST', '/archive/delete', 'deletePosts'),
];

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * The ROUTES entry for a request.
 *
 * Usage:
 *   const route = routeFor(req.method, req.path);   // services/access.js
 *
 * Takes:
 *   requestMethod - the HTTP method (HEAD is treated as GET)
 *   path          - the request path, e.g. '/api/posts/12'
 *
 * Returns:
 *   The first matching entry plus params (the path's id groups as strings), or a fallback
 *   { method, permission, params: [], unlisted }: any signed-in user for reads, super admin
 *   for changes (unlisted: true, which access.js logs as a warning).
 *
 * When editing:
 *   The super-admin fallback for unlisted changes is what keeps a new route locked down;
 *   keep it.
 */
export function routeFor(requestMethod, path) {
  const method = requestMethod === 'HEAD' ? 'GET' : requestMethod;
  const hit = ROUTES.find((r) => r.method === method && r.pattern.test(path));
  if (hit) return { ...hit, params: path.match(hit.pattern).slice(1) };
  return { method, permission: MUTATING.has(method) ? 'superAdmin' : null, params: [], unlisted: MUTATING.has(method) };
}
