-- MariaDB twin of ../004_schedule_rules.sql (conventions in 001_init.sql).
-- Repeating schedules: each platform's slots come from its schedule rules, like
-- recurring Google Calendar events, instead of one set of posting days and times.
-- platform.postingDays and postingTimes stay in the table but are no longer read.

CREATE TABLE scheduleRule (
  id            INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  platformId    INT NOT NULL,
  label         TEXT,                                       -- optional name, e.g. "Newsletter"
  byDay         VARCHAR(64) NOT NULL,                       -- RRULE weekday codes, e.g. "TU,TH"
  intervalWeeks INT NOT NULL DEFAULT 1 CHECK (intervalWeeks >= 1),  -- 2 = every other week
  time          VARCHAR(32) NOT NULL,                       -- local "HH:MM" in TIMEZONE
  startDate     VARCHAR(32) NOT NULL,                       -- local "YYYY-MM-DD"; the week count and type sequence start here
  endDate       VARCHAR(32),                                -- last day it can post; NULL = until otherwise stated
  postTypeIds   TEXT NOT NULL DEFAULT '[]',                 -- JSON type sequence the rule cycles; empty = the rotation types
  sortOrder     INT NOT NULL DEFAULT 0,                     -- first rule wins when two post at the same date and time
  active        INT NOT NULL DEFAULT 1,
  createdAt     VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  FOREIGN KEY (platformId) REFERENCES platform(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
CREATE INDEX scheduleRulePlatform ON scheduleRule (platformId, sortOrder);

-- The rule that made each slot
ALTER TABLE slot ADD COLUMN ruleId INT, ADD FOREIGN KEY (ruleId) REFERENCES scheduleRule(id) ON DELETE SET NULL;

-- The SQLite migration also turns existing posting days and times into weekly rules.
-- A MariaDB database always starts empty at this point (platforms are added by seed.js,
-- which gives each one its first rules, or copied over by db:copy-sqlite-to-mariadb with
-- their rules), so there is nothing to convert here.
