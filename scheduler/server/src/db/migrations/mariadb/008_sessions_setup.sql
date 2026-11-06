-- MariaDB twin of ../008_sessions_setup.sql (conventions in 001_init.sql).
-- Sign-in sessions that end on the server, and the temporary setup account.
ALTER TABLE appUser ADD COLUMN isSetup INT NOT NULL DEFAULT 0;

CREATE TABLE revokedSession (
  id          VARCHAR(64) NOT NULL PRIMARY KEY,
  expiresAt   BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
CREATE INDEX revokedSessionExpires ON revokedSession (expiresAt);
