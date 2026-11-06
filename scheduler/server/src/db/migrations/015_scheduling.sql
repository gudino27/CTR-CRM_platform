-- Scheduling choices (services/sync.js writeBlueprint).
--   kept: 1 for a future slot that held a post when someone changed the schedule rules and
--     chose "Keep posts already on the calendar where they are". Regenerating leaves a kept
--     slot (and its post) where it is until it passes; a kept slot that loses its post is
--     regenerated like any other. Its Blue/Purple color also counts in the alternation
--     (projection.js monthBlueprint), so new slots around it keep alternating.
ALTER TABLE slot ADD COLUMN kept INTEGER NOT NULL DEFAULT 0;
