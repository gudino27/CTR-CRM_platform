-- MariaDB twin of ../001_init.sql: same tables, columns, defaults and constraints.
-- Conventions for every MariaDB migration:
--   * utf8mb4 with utf8mb4_nopad_bin, so text compares and sorts byte for byte like SQLite
--     (case-sensitive, trailing spaces count)
--   * TEXT for free text; VARCHAR where a column is a key or indexed (MariaDB indexes need a length)
--   * dates stay text in SQLite's formats; DATE_FORMAT(UTC_TIMESTAMP(), ...) is SQLite's datetime('now')
--   * foreign keys are table constraints (InnoDB ignores REFERENCES written on a column)
--   * "key" is quoted: the server runs with ANSI_QUOTES (see db/client.js)
CREATE TABLE platform (
  id                INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  "key"             VARCHAR(64) NOT NULL UNIQUE,   -- sent as "platform" in the publish webhook; n8n branches on it
  name              VARCHAR(255) NOT NULL UNIQUE,  -- used as the Calendar event summary
  enabled           INT NOT NULL DEFAULT 1,
  isTest            INT NOT NULL DEFAULT 0,        -- Test platform, only active in test mode; always sent to the test endpoint
  postingDays       TEXT NOT NULL DEFAULT '[]',    -- JSON, e.g. ["MON","WED","FRI"]
  postingTimes      TEXT NOT NULL DEFAULT '[]',    -- JSON, local "HH:MM" in TIMEZONE
  calendarColorId   VARCHAR(16),                   -- Google Calendar event colorId "1".."11"
  charLimit         INT,
  webhookUrl        TEXT,                          -- optional per-platform publish URL; ignored in test mode
  paused            INT NOT NULL DEFAULT 0,
  sortOrder         INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE media (
  id            INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  storage       VARCHAR(16) NOT NULL DEFAULT 'local',   -- 'drive' | 'local'
  driveFileId   VARCHAR(255),
  link          TEXT,
  localPath     TEXT,
  name          TEXT NOT NULL,
  mimeType      VARCHAR(255),
  width         INT,
  height        INT,
  sizeBytes     BIGINT,
  sha256        VARCHAR(64) UNIQUE,
  createdAt     VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE post (
  id                INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  platformId        INT NOT NULL,
  caption           TEXT NOT NULL,
  hashtags          TEXT NOT NULL DEFAULT '',
  mediaId           INT,
  altText           TEXT NOT NULL DEFAULT '',
  priority          INT NOT NULL DEFAULT 0,        -- 0 standard, 1 high (front of queue), 2 next (next day, pinned via overrideDate)
  queuePosition     DOUBLE NOT NULL,               -- order within platform; REAL allows inserts between
  overrideDate      VARCHAR(32),                   -- optional local "YYYY-MM-DD"; the time always comes from the platform
  scheduledAt       VARCHAR(32),                   -- projected slot, UTC ISO; NULL when no slot is available
  status            VARCHAR(16) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','library','sending','posted','failed')),
  sentAt            VARCHAR(32),
  lastError         TEXT,
  platformPostId    VARCHAR(255),                  -- reported back by n8n through the status callback
  calendarEventId   VARCHAR(1024),
  calendarEventHash VARCHAR(64),                   -- hash of the last event body sent, to skip no-op patches
  calendarEventEtag VARCHAR(255),                  -- sent as If-Match so hand edits in Calendar aren't overwritten
  createdAt         VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  updatedAt         VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  FOREIGN KEY (platformId) REFERENCES platform(id),
  FOREIGN KEY (mediaId) REFERENCES media(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
CREATE INDEX postQueue ON post (platformId, status, priority DESC, queuePosition);
CREATE INDEX postDue ON post (status, scheduledAt);

-- Send history: one row per publish attempt
CREATE TABLE dispatch (
  id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  postId      INT NOT NULL,
  url         TEXT,
  payload     MEDIUMTEXT NOT NULL,                 -- JSON body that was (or in dry run, would have been) sent
  dryRun      INT NOT NULL DEFAULT 0,
  httpStatus  INT,
  error       TEXT,
  createdAt   VARCHAR(32) NOT NULL,
  FOREIGN KEY (postId) REFERENCES post(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- What the built-in test endpoint received, so people can inspect payloads
CREATE TABLE testWebhookReceipt (
  id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  payload     MEDIUMTEXT NOT NULL,
  problems    TEXT NOT NULL DEFAULT '[]',          -- JSON list of shape problems; empty = matches the contract
  receivedAt  VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE blackout (
  id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  platformId  INT,                                 -- NULL = all platforms
  startDate   VARCHAR(32) NOT NULL,
  endDate     VARCHAR(32) NOT NULL,
  reason      TEXT,
  FOREIGN KEY (platformId) REFERENCES platform(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE appSetting (
  "key" VARCHAR(255) NOT NULL PRIMARY KEY,
  value TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
