/**
 * Every call the client makes to the server's /api, in one object (`api`), so pages never
 * build URLs themselves. What lives here: 
 *    request (the shared fetch wrapper)
 *    query (builds"?a=1&b=2")
 *    api with one short function per route, grouped by feature below.
 *
 * When editing:
 *   This file is shared by several features: add new calls at the end in their own
 *   commented group rather than reordering. The session is an HttpOnly cookie that
 *   same-origin fetch sends on its own, the session watch in currentUser.js reads the
 *   time-left headers from every answer, including these.
 */

/**
 * Sends one JSON request to /api and returns the parsed answer, or throws on an error status.
 *
 * Usage:
 *   request(`/posts/${id}`, { method: 'PATCH', body: changes })
 *
 * Takes:
 *   path    - the route after /api, with its query string ("/slots?month=2026-11")
 *   options - fetch options; body is a plain object and is sent as JSON. Default GET, no body.
 *
 * Returns:
 *   The JSON body, or null for 204 No Content.
 *   Throws an Error whose message is the server's { error } text (or the status text), with
 *   error.status (the HTTP status) and error.body (the whole JSON answer, e.g. a 409's
 *   conflict and suggestedAt, or a media delete's usedBy).
 *
 * When editing:
 *   Pages show error.message to people as is, and read error.status / error.body for
 *   409s and 401s
 */
async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error = new Error(body.error ?? res.statusText);
    error.status = res.status;
    error.body = body;
    throw error;
  }
  return res.status === 204 ? null : res.json();
}

/**
 * Builds a query string from an object, leaving out empty values.
 *
 * Usage:
 *   query({ platformId: 3, month: '2026-11', kind: undefined })   // "?platformId=3&month=2026-11"
 *
 * Takes:
 *   params - { name: value }; undefined, null and "" are skipped, everything else is turned to text
 *
 * Returns:
 *   "?a=1&b=2", or "" when nothing is left.
 */
function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/**
 * One function per server route. Each returns a Promise of the route's JSON answer and
 * throws like request() does (error.message, error.status, error.body).
 *
 * Usage:
 *   const platforms = await api.platforms();
 *   await api.updatePost(post.id, { caption });
 *
 * Takes:
 *   Ids are numbers; "changes" are the fields to update (PATCH sends only those); filters are
 *   objects passed through query(), so empty values are left out.
 *
 * Returns:
 *   What the route sends, e.g. arrays of rows straight from the database (camelCase fields).
 *   Notes on the shapes are by each group below.
 *
 * When editing:
 *   The server checks permissions on every call (server/src/services/permissions.js); the
 *   client hides buttons too, but the server's answer is what counts.
 *   posts(filters) also takes a plain string as the status: posts("queued,failed") or
 *   posts({ status, platformId, kind, placed }); status defaults to "queued".
 *   requeuePost: failed fixed posts need { fixedAt }; library posts go back to the pool with no body.
 *   brief(days) defaults to 14 days; Inventory passes inventoryBriefDays from settings.js.
 *   uploadMedia sends the raw file as the body (not JSON); the server sniffs the type itself,
 *   so it does not use request() and its errors carry only the message.
 */
export const api = {
  status: () => request('/status'),
  platforms: () => request('/platforms'),
  updatePlatform: (id, changes) => request(`/platforms/${id}`, { method: 'PATCH', body: changes }),
  addPostType: (platformId, type) => request(`/platforms/${platformId}/post-types`, { method: 'POST', body: type }),
  updatePostType: (platformId, typeId, changes) =>
    request(`/platforms/${platformId}/post-types/${typeId}`, { method: 'PATCH', body: changes }),
  posts: (filters = {}) => {
    const { status = 'queued', platformId, kind, placed } = typeof filters === 'string' ? { status: filters } : filters;
    return request(`/posts${query({ status, platformId, kind, placed })}`);
  },
  createPost: (post) => request('/posts', { method: 'POST', body: post }),
  updatePost: (id, changes) => request(`/posts/${id}`, { method: 'PATCH', body: changes }),
  deletePost: (id) => request(`/posts/${id}`, { method: 'DELETE' }),
  requeuePost: (id, body) => request(`/posts/${id}/requeue`, { method: 'POST', body }),
  slots: (platformId, month) => request(`/slots${query({ platformId, month })}`),
  updateSlot: (id, changes) => request(`/slots/${id}`, { method: 'PATCH', body: changes }),
  inventory: (months) => request(`/inventory${query({ months })}`),
  brief: (days = 14) => request(`/brief${query({ days })}`),
  uploadMedia: async (file) => {
    const res = await fetch(`/api/media?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
    return res.json();
  },
};

// Media library: one image with its conversion details, and delete.
// A 409 from deleteMedia carries error.body.usedBy, the posts that still need the image.
api.media = (id) => request(`/media/${id}`);
api.deleteMedia = (id) => request(`/media/${id}`, { method: 'DELETE' });

// Schedule rules: add, change and delete return the whole platform with its rules
api.rules = (platformId) => request(`/platforms/${platformId}/rules`);
api.addRule = (platformId, rule) => request(`/platforms/${platformId}/rules`, { method: 'POST', body: rule });
api.updateRule = (platformId, ruleId, changes) =>
  request(`/platforms/${platformId}/rules/${ruleId}`, { method: 'PATCH', body: changes });
api.deleteRule = (platformId, ruleId) => request(`/platforms/${platformId}/rules/${ruleId}`, { method: 'DELETE' });

// ---- Users, permissions and activity ----
// The session is an HttpOnly cookie, which same-origin fetch sends on its own.
api.me = () => request('/auth/me');
api.signInOptions = () => request('/auth/options');
// TEMPORARY test-mode sign-in: { userId }. The real sign-in will send its own proof (e.g. a Google ID token).
api.signIn = (body) => request('/auth/sign-in', { method: 'POST', body });
api.signOut = () => request('/auth/sign-out', { method: 'POST' });
api.users = () => request('/users');
api.addUser = (user) => request('/users', { method: 'POST', body: user });
api.updateUser = (id, changes) => request(`/users/${id}`, { method: 'PATCH', body: changes });
api.permissions = () => request('/permissions');
api.savePermissions = (table, confirmRisky = false) => request('/permissions', { method: 'PUT', body: { table, confirmRisky } });
// { entityType, entityId, userId, before, limit }
api.activity = (filters = {}) => request(`/activity${query(filters)}`);

// ---- Media rotation and Recently deleted ----
// degrees: 90 (right), 180, or 270 (left); returns the media row with its new size.
api.rotateMedia = (id, degrees) => request(`/media/${id}/rotate`, { method: 'POST', body: { degrees } });
api.restoreMedia = (id) => request(`/media/${id}/restore`, { method: 'POST' });

// Session: time left in the session without renewing it, and deleting the setup account
api.session = () => request('/auth/session');
api.deleteUser = (id) => request(`/users/${id}`, { method: 'DELETE' });

// ---- Blackout dates ----
// { platformId (null = all platforms), startDate, endDate, reason }; add and change return the
// blackout with keptSlots, the locked or pinned slots left on its days
api.blackouts = (platformId) => request(`/blackouts${query({ platformId })}`);
api.addBlackout = (blackout) => request('/blackouts', { method: 'POST', body: blackout });
api.updateBlackout = (id, changes) => request(`/blackouts/${id}`, { method: 'PATCH', body: changes });
api.deleteBlackout = (id) => request(`/blackouts/${id}`, { method: 'DELETE' });

// ---- Notification area ----
// All need the viewNotifications permission. list: { notifications (newest first), unread };
// the count does not renew the session. resolveNotification(id, "google" | "app") settles a
// caption edited in Google Calendar (also needs editPosts).
api.notifications = (limit) => request(`/notifications${query({ limit })}`);
api.notificationCount = () => request('/notifications/count');
api.readNotification = (id) => request(`/notifications/${id}/read`, { method: 'POST' });
api.readAllNotifications = () => request('/notifications/read-all', { method: 'POST' });
api.resolveNotification = (id, choice) => request(`/notifications/${id}/resolve`, { method: 'POST', body: { choice } });

// ---- Archive for old published posts ----
// archive({ view: "published" | "archived", platformId, olderThan (months, 0 = any age), search, limit, offset })
// returns { posts, total, storageBytes, counts: { published, archived }, cutoff, trashDays }.
// All need archivePosts; deleteArchived also needs deletePosts and the typed words ("delete 12 posts").
api.archive = (filters = {}) => request(`/archive${query(filters)}`);
api.archivePosts = (postIds) => request('/archive/archive', { method: 'POST', body: { postIds } });
api.unarchivePosts = (postIds) => request('/archive/unarchive', { method: 'POST', body: { postIds } });
api.deleteArchived = (postIds, confirm) => request('/archive/delete', { method: 'POST', body: { postIds, confirm } });

// ---- Slot post type for later slots too ----
// scope "later" (this and later slots with the same old type) or "rotation" (the rule's order
// carries on from the new type). The preview changes nothing and returns { changes, until,
// keptSlots, postsReturning, slots }; the change (editSlots) returns the same plus the slot.
api.slotTypeChangePreview = (id, scope, postTypeId) => request(`/slots/${id}/type-change${query({ scope, postTypeId })}`);
api.changeSlotType = (id, scope, postTypeId) => request(`/slots/${id}/type-change`, { method: 'POST', body: { scope, postTypeId } });

// ---- Scheduling choices ----
// suggestColor(platformId, "YYYY-MM-DDTHH:MM", exceptPostId?) -> { color, previous }: the color that
// keeps Blue/Purple alternating for a Specific Date post (null on platforms without colors).
// ruleImpact(platformId, { ruleId?, rule?, remove? }) -> { onCalendar, moving, until, posts } before
// a rule change; saving with keepPosts: true (deleteRule(..., true)) keeps those posts where they are.
// missedPosts(platformId) lists what passed while paused; resumePlatform applies one choice per post:
// [{ postId, action: "library" | "date" | "skip", fixedAt? }].
api.suggestColor = (platformId, at, exceptPostId) =>
  request(`/platforms/${platformId}/suggest-color${query({ at, exceptPostId })}`);
api.ruleImpact = (platformId, change) => request(`/platforms/${platformId}/rules/impact`, { method: 'POST', body: change });
api.deleteRuleKeepingPosts = (platformId, ruleId) =>
  request(`/platforms/${platformId}/rules/${ruleId}?keepPosts=true`, { method: 'DELETE' });
api.missedPosts = (platformId) => request(`/platforms/${platformId}/missed`);
api.resumePlatform = (platformId, choices) => request(`/platforms/${platformId}/resume`, { method: 'POST', body: { choices } });
