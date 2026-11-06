-- Sign-in sessions that end on the server, and the temporary setup account.
--   appUser.isSetup: 1 for the "Setup account" made at startup when there is no active
--     super admin. It exists so someone can sign in and add the real super admins; it can
--     then be deleted for real (see DELETE /api/users/:id).
--   revokedSession: sessions signed out on the server. The cookie names its session id;
--     once that id is here the cookie (and any copy of it) no longer signs anyone in.
--     expiresAt (ms since 1970) is when the session would have ended anyway; older rows
--     are cleared out.
ALTER TABLE appUser ADD COLUMN isSetup INTEGER NOT NULL DEFAULT 0;

CREATE TABLE revokedSession (
  id          TEXT PRIMARY KEY,
  expiresAt   INTEGER NOT NULL
);
CREATE INDEX revokedSessionExpires ON revokedSession (expiresAt);
