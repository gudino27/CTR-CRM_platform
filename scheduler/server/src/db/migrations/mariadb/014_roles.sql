-- MariaDB twin of ../014_roles.sql.
-- Roles (services/permissions.js).
-- Who may edit a post once it is scheduled (queued and placed: in a slot, or a Specific Date
-- post). Others ask a super admin, since all content is preapproved before it gets
-- added. Admins and managers yes, team members (role key employee) no; super admins always can.
-- Editing a scheduled post needs editPosts AND this (routes/posts.js).
INSERT INTO rolePermission (role, permission, allowed) VALUES
  ('admin', 'editScheduledPosts', 1), ('manager', 'editScheduledPosts', 1), ('employee', 'editScheduledPosts', 0);

-- The "employee" role now reads "Team member" (the stored role key stays employee).
-- The demo sign-in is renamed to match, only if nobody has renamed it already.
UPDATE appUser SET name = 'Demo Team Member' WHERE email = 'employee@demo.invalid' AND name = 'Demo Employee';
