CREATE TABLE platform (
  id                INTEGER PRIMARY KEY,
  key               TEXT NOT NULL UNIQUE,          -- sent as "platform" in the publish webhook; n8n branches on it
  name              TEXT NOT NULL UNIQUE,          -- used as the Calendar event summary
  enabled           INTEGER NOT NULL DEFAULT 1,
  isTest            INTEGER NOT NULL DEFAULT 0,    -- Test platform, only active in test mode; always sent to the test endpoint
  postingDays       TEXT NOT NULL DEFAULT '[]',    -- JSON, e.g. ["MON","WED","FRI"]
  postingTimes      TEXT NOT NULL DEFAULT '[]',    -- JSON, local "HH:MM" in TIMEZONE
  calendarColorId   TEXT,                          -- Google Calendar event colorId "1".."11"
  charLimit         INTEGER,
  webhookUrl        TEXT,                          -- optional per-platform publish URL; ignored in test mode
  paused            INTEGER NOT NULL DEFAULT 0,
  sortOrder         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE media (
  id            INTEGER PRIMARY KEY,
  storage       TEXT NOT NULL DEFAULT 'local',     -- 'drive' | 'local'
  driveFileId   TEXT,
  link          TEXT,
  localPath     TEXT,
  name          TEXT NOT NULL,
  mimeType      TEXT,
  width         INTEGER,
  height        INTEGER,
  sizeBytes     INTEGER,
  sha256        TEXT UNIQUE,
  createdAt     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE post (
  id                INTEGER PRIMARY KEY,
  platformId        INTEGER NOT NULL REFERENCES platform(id),
  caption           TEXT NOT NULL,
  hashtags          TEXT NOT NULL DEFAULT '',
  mediaId           INTEGER REFERENCES media(id),
  altText           TEXT NOT NULL DEFAULT '',
  priority          INTEGER NOT NULL DEFAULT 0,    -- 0 standard, 1 high (front of queue), 2 next (next day, pinned via overrideDate)
  queuePosition     REAL NOT NULL,                 -- order within platform; REAL allows inserts between
  overrideDate      TEXT,                          -- optional local "YYYY-MM-DD"; the time always comes from the platform
  scheduledAt       TEXT,                          -- projected slot, UTC ISO; NULL when no slot is available
  status            TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','library','sending','posted','failed')),
  sentAt            TEXT,
  lastError         TEXT,
  platformPostId    TEXT,                          -- reported back by n8n through the status callback
  calendarEventId   TEXT,
  calendarEventHash TEXT,                          -- hash of the last event body sent, to skip no-op patches
  calendarEventEtag TEXT,                          -- sent as If-Match so hand edits in Calendar aren't overwritten
  createdAt         TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX postQueue ON post (platformId, status, priority DESC, queuePosition);
CREATE INDEX postDue ON post (status, scheduledAt);

-- Send history: one row per publish attempt
CREATE TABLE dispatch (
  id          INTEGER PRIMARY KEY,
  postId      INTEGER NOT NULL REFERENCES post(id) ON DELETE CASCADE,
  url         TEXT,
  payload     TEXT NOT NULL,                       -- JSON body that was (or in dry run, would have been) sent
  dryRun      INTEGER NOT NULL DEFAULT 0,
  httpStatus  INTEGER,
  error       TEXT,
  createdAt   TEXT NOT NULL
);

-- What the built-in test endpoint received, so the team and client can inspect payloads
CREATE TABLE testWebhookReceipt (
  id          INTEGER PRIMARY KEY,
  payload     TEXT NOT NULL,
  problems    TEXT NOT NULL DEFAULT '[]',          -- JSON list of shape problems; empty = matches the contract
  receivedAt  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE blackout (
  id          INTEGER PRIMARY KEY,
  platformId  INTEGER REFERENCES platform(id),     -- NULL = all platforms
  startDate   TEXT NOT NULL,
  endDate     TEXT NOT NULL,
  reason      TEXT
);

CREATE TABLE appSetting (
  key   TEXT PRIMARY KEY,
  value TEXT
);
