CREATE TABLE platform (
  id                INTEGER PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,          -- used as the Calendar event summary
  enabled           INTEGER NOT NULL DEFAULT 1,
  is_test           INTEGER NOT NULL DEFAULT 0,    -- Test platform, only active in test mode
  posting_days      TEXT NOT NULL DEFAULT '[]',    -- JSON, e.g. ["MON","WED","FRI"]
  posting_times     TEXT NOT NULL DEFAULT '[]',    -- JSON, local "HH:MM" in TIMEZONE
  calendar_color_id TEXT,                          -- Google Calendar event colorId "1".."11"
  char_limit        INTEGER,
  paused            INTEGER NOT NULL DEFAULT 0,
  sort_order        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE media (
  id            INTEGER PRIMARY KEY,
  storage       TEXT NOT NULL DEFAULT 'local',     -- 'drive' | 'local'
  drive_file_id TEXT,
  link          TEXT,
  local_path    TEXT,
  name          TEXT NOT NULL,
  mime_type     TEXT,
  width         INTEGER,
  height        INTEGER,
  sha256        TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE post (
  id                INTEGER PRIMARY KEY,
  platform_id       INTEGER NOT NULL REFERENCES platform(id),
  caption           TEXT NOT NULL,
  hashtags          TEXT NOT NULL DEFAULT '',
  media_id          INTEGER REFERENCES media(id),
  priority          INTEGER NOT NULL DEFAULT 0,    -- 0 normal, 1 high (moves ahead in queue)
  queue_position    REAL NOT NULL,                 -- order within platform; REAL allows inserts between
  override_at       TEXT,                          -- optional ISO datetime; normally NULL
  status            TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','library','posted')),
  calendar_event_id TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX post_queue ON post (platform_id, status, priority DESC, queue_position);

CREATE TABLE blackout (
  id          INTEGER PRIMARY KEY,
  platform_id INTEGER REFERENCES platform(id),     -- NULL = all platforms
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  reason      TEXT
);

CREATE TABLE app_setting (
  key   TEXT PRIMARY KEY,
  value TEXT
);
