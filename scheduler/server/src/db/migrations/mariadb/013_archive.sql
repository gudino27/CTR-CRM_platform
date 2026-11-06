-- MariaDB twin of ../013_archive.sql.
-- Archive for old published posts (services/archive.js).
--   archivedAt: when the post was archived (app clock, ISO); NULL = not archived.
--     Archived posts keep their row, caption, dates and small image copy, are left out of
--     the Library's lists, and are shown on the Archive page, where they can be unarchived
--     or deleted for good.
ALTER TABLE post ADD COLUMN archivedAt VARCHAR(32);
CREATE INDEX postArchived ON post (status, archivedAt);

-- Who may archive (least access: admins only by default; super admins always can, and can
-- grant it on the Permissions page). Deleting archived posts for good also needs deletePosts.
INSERT INTO rolePermission (role, permission, allowed) VALUES
  ('admin', 'archivePosts', 1), ('manager', 'archivePosts', 0), ('employee', 'archivePosts', 0);
