-- MariaDB twin of ../012_rule_type_changes.sql (conventions in 001_init.sql).
-- Changing a slot's post type for later slots too. The Calendar's
-- slot panel offers three choices; the last two are kept here so they last across months and
-- regenerating (services/projection.js applies them when it makes slots):
--   kind "later":    from `date` on, slots of the rule whose type is fromTypeId get toTypeId
--                    instead ("This and later slots"); other types are untouched
--   kind "rotation": from `date` on, the rule's type sequence restarts at toTypeId, as if the
--                    rotation began on that day ("Shift the rotation"); fromTypeId is NULL
-- "Only this slot" changes just that slot row and is not kept here.
-- A rule's changes apply in date order (then id); a new "rotation" change replaces the
-- rule's changes on and after its date.
CREATE TABLE ruleTypeChange (
  id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ruleId      INT NOT NULL,
  date        VARCHAR(32) NOT NULL,              -- local "YYYY-MM-DD" of the slot it was made on
  kind        VARCHAR(16) NOT NULL CHECK (kind IN ('later', 'rotation')),
  fromTypeId  INT,                               -- "later" only: the type being replaced
  toTypeId    INT NOT NULL,
  createdAt   VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  FOREIGN KEY (ruleId) REFERENCES scheduleRule(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
CREATE INDEX ruleTypeChangeRule ON ruleTypeChange (ruleId, date);
