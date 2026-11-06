-- Earlier versions of an image, kept for posts that already went out (see the rotate route
-- in routes/media.js). Rotating replaces the image in place, so posts still waiting to go
-- out (and their calendar events) get the rotated picture with the same link. Posts that
-- were already published are moved to a server-side copy of the image as it was, stored
-- like the other "Kept for history" rows (deletedAt and archivedAt set, no hashes).
--   archiveNote: why a history row was kept, shown on the Media page
--     (e.g. "Version before rotation on Nov 3, 2026"); NULL for the low-resolution
--     copies made when a deleted image is purged
--   versionOfId: the image this row is an earlier version of; NULL once that image
--     is purged for good
ALTER TABLE media ADD COLUMN archiveNote TEXT;
ALTER TABLE media ADD COLUMN versionOfId INTEGER;
CREATE INDEX mediaVersionOf ON media (versionOfId);
