-- Library scheduling: the linear queue with Standard/High/Next
-- priority is replaced by library posts that fill a monthly blueprint of slots, and fixed posts on a date and time the user picked.

ALTER TABLE platform ADD COLUMN usesColors INTEGER NOT NULL DEFAULT 0;  -- slots alternate Blue/Purple

CREATE TABLE postType (
  id          INTEGER PRIMARY KEY,
  platformId  INTEGER NOT NULL REFERENCES platform(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sortOrder   INTEGER NOT NULL DEFAULT 0,                     
  UNIQUE (platformId, name)
);

-- One row per posting slot, generated a month at a time from the platform's cadence
CREATE TABLE slot (
  id          INTEGER PRIMARY KEY,
  platformId  INTEGER NOT NULL REFERENCES platform(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,                                  
  time        TEXT NOT NULL,                                
  scheduledAt TEXT NOT NULL,                                  
  color       TEXT CHECK (color IN ('Blue', 'Purple')),      
  postTypeId  INTEGER REFERENCES postType(id) ON DELETE SET NULL,
  postId      INTEGER UNIQUE REFERENCES post(id) ON DELETE SET NULL, 
  locked      INTEGER NOT NULL DEFAULT 0,                    
  pinned      INTEGER NOT NULL DEFAULT 0,                 
  UNIQUE (platformId, date, time)
);
CREATE INDEX slotTime ON slot (platformId, scheduledAt);

ALTER TABLE post ADD COLUMN kind TEXT NOT NULL DEFAULT 'library' CHECK (kind IN ('library', 'fixed'));
ALTER TABLE post ADD COLUMN postTypeId INTEGER REFERENCES postType(id);
ALTER TABLE post ADD COLUMN color TEXT CHECK (color IN ('Blue', 'Purple'));
ALTER TABLE post ADD COLUMN fixedAt TEXT;                     

-- Override-date posts become fixed posts at the platform's earliest posting time.
-- The rest stay library posts, seed.js gives them the platform's first post type.
UPDATE post SET kind = 'fixed',
  fixedAt = overrideDate || 'T' || COALESCE(
    (SELECT json_extract(platform.postingTimes, '$[0]') FROM platform WHERE platform.id = post.platformId), '12:00')
WHERE overrideDate IS NOT NULL;
UPDATE post SET status = 'queued' WHERE status = 'library';

DROP INDEX postQueue;
ALTER TABLE post DROP COLUMN priority;
ALTER TABLE post DROP COLUMN overrideDate;
ALTER TABLE post DROP COLUMN queuePosition;
