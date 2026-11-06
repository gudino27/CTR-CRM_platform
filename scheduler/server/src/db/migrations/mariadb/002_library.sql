-- MariaDB twin of ../002_library.sql (conventions in 001_init.sql).
-- Library scheduling: the linear queue with Standard/High/Next
-- priority is replaced by library posts that fill a monthly blueprint of slots, and fixed posts on a date and time the user picked.

ALTER TABLE platform ADD COLUMN usesColors INT NOT NULL DEFAULT 0;  -- slots alternate Blue/Purple

CREATE TABLE postType (
  id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  platformId  INT NOT NULL,
  name        VARCHAR(255) NOT NULL,
  sortOrder   INT NOT NULL DEFAULT 0,
  UNIQUE (platformId, name),
  FOREIGN KEY (platformId) REFERENCES platform(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- One row per posting slot, generated a month at a time from the platform's cadence
CREATE TABLE slot (
  id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  platformId  INT NOT NULL,
  date        VARCHAR(32) NOT NULL,
  time        VARCHAR(32) NOT NULL,
  scheduledAt VARCHAR(32) NOT NULL,
  color       VARCHAR(16) CHECK (color IN ('Blue', 'Purple')),
  postTypeId  INT,
  postId      INT UNIQUE,
  locked      INT NOT NULL DEFAULT 0,
  pinned      INT NOT NULL DEFAULT 0,
  UNIQUE (platformId, date, time),
  FOREIGN KEY (platformId) REFERENCES platform(id) ON DELETE CASCADE,
  FOREIGN KEY (postTypeId) REFERENCES postType(id) ON DELETE SET NULL,
  FOREIGN KEY (postId) REFERENCES post(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
CREATE INDEX slotTime ON slot (platformId, scheduledAt);

ALTER TABLE post ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'library' CHECK (kind IN ('library', 'fixed'));
ALTER TABLE post ADD COLUMN postTypeId INT, ADD FOREIGN KEY (postTypeId) REFERENCES postType(id);
ALTER TABLE post ADD COLUMN color VARCHAR(16) CHECK (color IN ('Blue', 'Purple'));
ALTER TABLE post ADD COLUMN fixedAt VARCHAR(32);

-- Override-date posts become fixed posts at the platform's earliest posting time.
-- The rest stay library posts, seed.js gives them the platform's first post type.
UPDATE post SET kind = 'fixed',
  fixedAt = CONCAT(overrideDate, 'T', COALESCE(
    (SELECT JSON_VALUE(platform.postingTimes, '$[0]') FROM platform WHERE platform.id = post.platformId), '12:00'))
WHERE overrideDate IS NOT NULL;
UPDATE post SET status = 'queued' WHERE status = 'library';

-- InnoDB needs an index on a foreign key column; postQueue was the one for platformId
CREATE INDEX postPlatform ON post (platformId);
DROP INDEX postQueue ON post;
ALTER TABLE post DROP COLUMN priority;
ALTER TABLE post DROP COLUMN overrideDate;
ALTER TABLE post DROP COLUMN queuePosition;
