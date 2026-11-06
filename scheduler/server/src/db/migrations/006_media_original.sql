-- Uploads are converted to JPEG (see services/imageConvert.js). The row's
-- mimeType/width/height/sizeBytes/sha256 describe the stored JPEG; these
-- columns keep what was uploaded, so the Compose preview can compare them
-- and a second upload of the same original finds the existing row.
ALTER TABLE media ADD COLUMN originalMimeType TEXT;
ALTER TABLE media ADD COLUMN originalWidth INTEGER;
ALTER TABLE media ADD COLUMN originalHeight INTEGER;
ALTER TABLE media ADD COLUMN originalSizeBytes INTEGER;
ALTER TABLE media ADD COLUMN originalSha256 TEXT;
CREATE INDEX mediaOriginalSha ON media (originalSha256);

-- Earlier uploads were stored as they came in, so the original is the stored file
UPDATE media SET originalMimeType = mimeType, originalWidth = width, originalHeight = height,
  originalSizeBytes = sizeBytes, originalSha256 = sha256;
