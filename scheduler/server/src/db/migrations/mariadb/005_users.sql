-- MariaDB twin of ../005_users.sql (conventions in 001_init.sql).
-- Team members, what each role may do, and who changed what.
-- Users are deactivated, never deleted, so the history keeps their name.
CREATE TABLE appUser (
  id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  -- Case-insensitive like SQLite's COLLATE NOCASE
  email       VARCHAR(255) COLLATE utf8mb4_unicode_nopad_ci NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  role        VARCHAR(16) NOT NULL CHECK (role IN ('superAdmin', 'admin', 'manager', 'employee')),
  active      INT NOT NULL DEFAULT 1,
  createdAt   VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  updatedAt   VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Super admins edit this table on the Permissions page. superAdmin is never stored:
-- it always has every permission.
CREATE TABLE rolePermission (
  role        VARCHAR(16) NOT NULL CHECK (role IN ('admin', 'manager', 'employee')),
  permission  VARCHAR(64) NOT NULL,
  allowed     INT NOT NULL DEFAULT 0,
  PRIMARY KEY (role, permission)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

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
  id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  userId      INT,
  action      VARCHAR(64) NOT NULL,              -- e.g. "post.update"
  entityType  VARCHAR(64),                       -- "post", "slot", "platform", ...
  entityId    INT,
  summary     TEXT NOT NULL DEFAULT '',
  createdAt   VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  FOREIGN KEY (userId) REFERENCES appUser(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
CREATE INDEX auditLogEntity ON auditLog (entityType, entityId);
CREATE INDEX auditLogCreated ON auditLog (createdAt);

-- Who wrote and last changed each post (updatedAt already exists)
ALTER TABLE post ADD COLUMN createdBy INT, ADD FOREIGN KEY (createdBy) REFERENCES appUser(id);
ALTER TABLE post ADD COLUMN updatedBy INT, ADD FOREIGN KEY (updatedBy) REFERENCES appUser(id);
