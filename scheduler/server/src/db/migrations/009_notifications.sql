-- Notification area: things people should see without going
-- looking, shown under the bell in the header (services/notifications.js).
--   kind: "calendarClash"    a move made in Google Calendar landed on a blackout day or
--                            within 2 hours of another Specific Date post
--         "calendarTextEdit" someone changed an app event's text in Google Calendar; it
--                            waits for "Use Google's caption" or "Keep the app's caption"
--         "postFailed"       a post failed to send, or calendar sync needs a new date for it
--         "daySkipped"       a deleted calendar event made the app skip that day
--   postId, platformId: what it is about (NULL once that post or platform is deleted)
--   data: JSON text with the details the page shows (e.g. both captions side by side)
--   readAt: when someone marked it read (shared by everyone, kept simple)
--   resolvedAt: when it was dealt with (a caption choice made, a failed post requeued)
CREATE TABLE notification (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL,
  postId      INTEGER REFERENCES post(id) ON DELETE SET NULL,
  platformId  INTEGER REFERENCES platform(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  data        TEXT,
  createdAt   TEXT NOT NULL DEFAULT (datetime('now')),
  readAt      TEXT,
  resolvedAt  TEXT
);
CREATE INDEX notificationPost ON notification (postId, kind);
CREATE INDEX notificationRead ON notification (readAt);

-- Who sees notifications (least access: employees do not by default; super admins always do
-- and can grant it on the Permissions page)
INSERT INTO rolePermission (role, permission, allowed) VALUES
  ('admin', 'viewNotifications', 1), ('manager', 'viewNotifications', 1), ('employee', 'viewNotifications', 0);
