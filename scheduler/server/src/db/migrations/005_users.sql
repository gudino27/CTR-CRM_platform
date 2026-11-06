-- Team members, what each role may do, and who changed what.
-- Users are deactivated, never deleted, so the history keeps their name.
CREATE TABLE appUser (
  id          INTEGER PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('superAdmin', 'admin', 'manager', 'employee')),
  active      INTEGER NOT NULL DEFAULT 1,
  createdAt   TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Super admins edit this table on the Permissions page. superAdmin is never stored:
-- it always has every permission.
CREATE TABLE rolePermission (
  role        TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'employee')),
  permission  TEXT NOT NULL,
  allowed     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (role, permission)
);

-- Conservative starting point; roles can be changed on the Permissions page
INSERT INTO rolePermission (role, permission, allowed) VALUES
  ('admin', 'createPosts', 1), ('admin', 'editPosts', 1), ('admin', 'deletePosts', 1),
  ('admin', 'editSlots', 1), ('admin', 'editSchedules', 1), ('admin', 'editPlatforms', 1),
  ('admin', 'managePostTypes', 1), ('admin', 'uploadMedia', 1), ('admin', 'deleteMedia', 1),
  ('admin', 'manageUsers', 1), ('admin', 'viewActivity', 1),
  ('manager', 'createPosts', 1), ('manager', 'editPosts', 1), ('manager', 'deletePosts', 0),
  ('manager', 'editSlots', 1), ('manager', 'editSchedules', 1), ('manager', 'editPlatforms', 0),
  ('manager', 'managePostTypes', 1), ('manager', 'uploadMedia', 1), ('manager', 'deleteMedia', 0),
  ('manager', 'manageUsers', 0), ('manager', 'viewActivity', 1),
  ('employee', 'createPosts', 1), ('employee', 'editPosts', 1), ('employee', 'deletePosts', 0),
  ('employee', 'editSlots', 0), ('employee', 'editSchedules', 0), ('employee', 'editPlatforms', 0),
  ('employee', 'managePostTypes', 0), ('employee', 'uploadMedia', 1), ('employee', 'deleteMedia', 0),
  ('employee', 'manageUsers', 0), ('employee', 'viewActivity', 0);

-- One row per successful change. userId is NULL for n8n's status callback.
CREATE TABLE auditLog (
  id          INTEGER PRIMARY KEY,
  userId      INTEGER REFERENCES appUser(id),
  action      TEXT NOT NULL,                     -- e.g. "post.update"
  entityType  TEXT,                              -- "post", "slot", "platform", ...
  entityId    INTEGER,
  summary     TEXT NOT NULL DEFAULT '',
  createdAt   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX auditLogEntity ON auditLog (entityType, entityId);
CREATE INDEX auditLogCreated ON auditLog (createdAt);

-- Who wrote and last changed each post (updatedAt already exists)
ALTER TABLE post ADD COLUMN createdBy INTEGER REFERENCES appUser(id);
ALTER TABLE post ADD COLUMN updatedBy INTEGER REFERENCES appUser(id);
