-- Post types outside the monthly rotation (Holiday) are offered for Specific Date
-- posts only, never assigned to blueprint slots
ALTER TABLE postType ADD COLUMN inRotation INTEGER NOT NULL DEFAULT 1;
