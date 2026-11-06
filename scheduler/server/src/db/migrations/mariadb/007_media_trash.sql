-- MariaDB twin of ../007_media_trash.sql.
-- Rotation, soft delete and the low-resolution history copy for media
-- (see routes/media.js and services/mediaTrash.js).
--   exifOrientation: the upload's EXIF orientation tag (1-8, NULL when it had none);
--     a JPEG with a tag other than 1 was re-saved upright on upload
--   rotation: degrees (0, 90, 180, 270) the image was turned by hand since upload
--   deletedAt: ISO time (app clock) it went to "Recently deleted"; NULL = in the library
--   trashPath: the server's copy of the file while it is in Recently deleted
--   archivedAt: when it was purged but kept as a low-resolution copy, because posts
--     that already went out used it; localPath then points at that small JPEG
ALTER TABLE media ADD COLUMN exifOrientation INT;
ALTER TABLE media ADD COLUMN rotation INT NOT NULL DEFAULT 0;
ALTER TABLE media ADD COLUMN deletedAt VARCHAR(32);
ALTER TABLE media ADD COLUMN trashPath TEXT;
ALTER TABLE media ADD COLUMN archivedAt VARCHAR(32);
CREATE INDEX mediaDeletedAt ON media (deletedAt);
