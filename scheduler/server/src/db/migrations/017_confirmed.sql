-- Publish confirmations from n8n (services/dispatch.js, the status callback in routes/posts.js).
--   confirmedAt: when the post was confirmed as published (app clock, ISO). With
--     N8N_CONFIRMS_POSTS=true, a send that n8n accepts marks the post 'posted' with confirmedAt
--     NULL, and the status callback with status "posted" (or "Mark as published" on the
--     Library page) sets it. A posted post still NULL after confirmWaitMinutes (settings.js)
--     gets a "notConfirmed" notification. With N8N_CONFIRMS_POSTS off, it is set at send time.
--   Posts already published before this column existed count as confirmed, so none of them
--   show up as "Not confirmed".
ALTER TABLE post ADD COLUMN confirmedAt TEXT;
UPDATE post SET confirmedAt = COALESCE(sentAt, scheduledAt, updatedAt) WHERE status = 'posted';
