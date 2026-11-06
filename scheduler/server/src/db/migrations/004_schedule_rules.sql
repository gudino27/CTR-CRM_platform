-- Repeating schedules: each platform's slots come from its schedule rules, like
-- recurring Google Calendar events, instead of one set of posting days and times.
-- platform.postingDays and postingTimes stay in the table but are no longer read.

CREATE TABLE scheduleRule (
  id            INTEGER PRIMARY KEY,
  platformId    INTEGER NOT NULL REFERENCES platform(id) ON DELETE CASCADE,
  label         TEXT,                                       -- optional name, e.g. "Newsletter"
  byDay         TEXT NOT NULL,                              -- RRULE weekday codes, e.g. "TU,TH"
  intervalWeeks INTEGER NOT NULL DEFAULT 1 CHECK (intervalWeeks >= 1),  -- 2 = every other week
  time          TEXT NOT NULL,                              -- local "HH:MM" in TIMEZONE
  startDate     TEXT NOT NULL,                              -- local "YYYY-MM-DD"; the week count and type sequence start here
  endDate       TEXT,                                       -- last day it can post; NULL = until otherwise stated
  postTypeIds   TEXT NOT NULL DEFAULT '[]',                 -- JSON type sequence the rule cycles; empty = the rotation types
  sortOrder     INTEGER NOT NULL DEFAULT 0,                 -- first rule wins when two post at the same date and time
  active        INTEGER NOT NULL DEFAULT 1,
  createdAt     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX scheduleRulePlatform ON scheduleRule (platformId, sortOrder);

-- The rule that made each slot
ALTER TABLE slot ADD COLUMN ruleId INTEGER REFERENCES scheduleRule(id) ON DELETE SET NULL;

-- One weekly rule per posting time, starting where the old rotation counted from,
-- so the calendar looks the same right after migrating
INSERT INTO scheduleRule (platformId, byDay, time, startDate, sortOrder)
SELECT platform.id,
       (SELECT group_concat(code, ',') FROM (
          SELECT substr(d.value, 1, 2) AS code FROM json_each(platform.postingDays) AS d
          ORDER BY instr('MONTUEWEDTHUFRISATSUN', d.value))),
       t.value, '2026-01-01', t.key
FROM platform, json_each(platform.postingTimes) AS t
WHERE json_array_length(platform.postingDays) > 0
ORDER BY platform.id, t.key;
