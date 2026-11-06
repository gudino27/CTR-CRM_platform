-- MariaDB twin of ../003_holiday_type.sql.
-- Post types outside the monthly rotation (Holiday) are offered for Specific Date
-- posts only, never assigned to blueprint slots
ALTER TABLE postType ADD COLUMN inRotation INT NOT NULL DEFAULT 1;
