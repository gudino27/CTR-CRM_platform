/**
 * Notifications page: what happened without anyone in the app, newest first. Moves in
 * Google Calendar that clash, event text edited there (with the caption choice), failed
 * posts, and days skipped because their calendar event was deleted.
 * Read state is shared by everyone. The route needs viewNotifications (App.jsx).
 *
 * What lives here:
 *   KIND_LABELS    notification.kind -> badge text
 *   announce       tells the header bell the new unread count
 *   withTags       caption plus hashtags, as the event shows them
 *   TextChoice     Google's text next to the app's, with the two choices
 *   Notifications  the page (route /notifications)
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api.js';
import { useCurrentUser } from '../currentUser.js';
import { formatStamp } from '../time.js';
import { NOTIFICATIONS_CHANGED } from '../components/NotificationBell.jsx';
import '../notifications.css';

// The kinds the server makes (server/src/services/notifications.js); unknown kinds show as stored
const KIND_LABELS = {
  calendarClash: 'Calendar move',
  calendarTextEdit: 'Calendar text edit',
  postFailed: 'Failed post',
  daySkipped: 'Skipped day',
};

/**
 * Tells the header bell (NotificationBell.jsx) the new unread count, so it updates
 * without waiting for its next poll.
 *
 * Usage:
 *   announce(result.unread)
 *
 * Takes:
 *   unread - the number of unread notifications
 *
 * Returns:
 *   Nothing; fires a NOTIFICATIONS_CHANGED window event with { detail: { unread } }.
 */
const announce = (unread) => window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED, { detail: { unread } }));

/**
 * Caption plus hashtags, as the calendar event shows them: a blank line between, and
 * either part left out when empty.
 *
 * Usage:
 *   withTags(data.appCaption, data.appHashtags)  // "Hello\n\n#ctr"
 *
 * Returns:
 *   A string ("" when both are empty).
 */
const withTags = (caption, hashtags) => [caption, hashtags].filter(Boolean).join('\n\n');

/**
 * Google's text next to the app's, and the two choices (for people who may edit posts),
 * for a calendarTextEdit notification.
 *
 * Usage:
 *   Rendered by Notifications: <TextChoice notification={n} canChoose={...} busy={...} onChoose={(choice) => ...} />
 *
 * Takes:
 *   notification - the row; its data holds googleSummary/appSummary, googleCaption/appCaption,
 *                  googleHashtags/appHashtags, and resolution once settled
 *   canChoose    - true when the viewer has editPosts
 *   onChoose     - called with "google" or "app"
 *   busy         - true while the choice is being sent (disables the buttons)
 *
 * Returns:
 *   Two side-by-side boxes ("In Google Calendar", "In the app"), with the titles only when
 *   the event's title was changed too, then one of:
 *   - settled (resolvedAt set): which choice was made, or that the event no longer differs
 *     from the app (or was deleted), when the server settled it on its own
 *   - canChoose: "Use Google's caption" (disabled when Google's caption is empty) and
 *     "Keep the app's caption"
 *   - otherwise: a note that someone who may edit posts chooses, and that until then the
 *     app leaves the event's text alone.
 *
 * When editing:
 *   The data fields and resolution values come from server/src/services/notifications.js;
 *   the choice is POST /api/notifications/:id/resolve, which also checks editPosts.
 */
function TextChoice({ notification, canChoose, onChoose, busy }) {
  const { data } = notification;
  const settled = Boolean(notification.resolvedAt);
  const titleChanged = data.googleSummary !== data.appSummary;
  return (
    <div className="notification-compare">
      <div className="notification-side">
        <h3>In Google Calendar</h3>
        {titleChanged && <p className="notification-side-title">Title: {data.googleSummary || '(empty)'}</p>}
        <pre>{withTags(data.googleCaption, data.googleHashtags) || '(no caption text)'}</pre>
      </div>
      <div className="notification-side">
        <h3>In the app</h3>
        {titleChanged && <p className="notification-side-title">Title: {data.appSummary}</p>}
        <pre>{withTags(data.appCaption, data.appHashtags)}</pre>
      </div>
      {settled ? (
        <p className="field-hint notification-settled">
          {data.resolution === 'google' ? "Settled: Google's caption is now the post's caption."
            : data.resolution === 'app' ? "Settled: the app's caption was kept and written back to the event."
              : 'Settled: the event no longer differs from the app (or it was deleted).'}
        </p>
      ) : canChoose ? (
        <div className="post-actions">
          <button type="button" disabled={busy || !data.googleCaption} onClick={() => onChoose('google')}>Use Google's caption</button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => onChoose('app')}>Keep the app's caption</button>
        </div>
      ) : (
        <p className="field-hint">Someone who may edit posts chooses which caption to keep. Until then the app leaves the event's text alone.</p>
      )}
    </div>
  );
}

/**
 * The Notifications page: the list with "Mark read" per item and "Mark all read".
 *
 * Usage:
 *   Rendered by App.jsx for the /notifications route (needs viewNotifications): <Notifications />
 *
 * Returns:
 *   The page section: one card per notification (kind badge, "New" when unread, when,
 *   title, body, the caption choice for text edits, and links to the Library, Calendar
 *   or the post's history).
 *
 * How it works:
 *   1. Loads the time zone and the notifications on mount, and tells the bell the unread
 *      count.
 *   2. Mark read / resolve: the server returns the updated row plus the new unread count;
 *      the row is swapped in place and the bell is told.
 *   3. Mark all read: marks every unread row read locally with the current time (the
 *      server's exact time is not needed for display) and sets the bell to 0.
 *   4. Links: Library for failed, skipped and clash notices with a post; Calendar for
 *      skipped days; the post's history only for people with viewActivity.
 *
 * When editing:
 *   Read state is global (one readAt per notification, shared by everyone), not per
 *   user. The bell's poll interval is notificationPollMs in settings.js.
 */
export default function Notifications() {
  const { permissions } = useCurrentUser();
  const [notifications, setNotifications] = useState(null);
  const [timezone, setTimezone] = useState();
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    api.status().then((status) => setTimezone(status.timezone)).catch(() => {});
    api.notifications().then((result) => {
      setNotifications(result.notifications);
      announce(result.unread);
    }).catch((error) => setMessage(error.message));
  }, []);

  const replace = (row) => setNotifications((rows) => rows.map((n) => (n.id === row.id ? row : n)));

  async function markRead(id) {
    setMessage('');
    try {
      const { unread, ...row } = await api.readNotification(id);
      replace(row);
      announce(unread);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function markAllRead() {
    setMessage('');
    try {
      await api.readAllNotifications();
      const now = new Date().toISOString();
      setNotifications((rows) => rows.map((n) => (n.readAt ? n : { ...n, readAt: now })));
      announce(0);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function choose(id, choice) {
    setMessage('');
    setBusyId(id);
    try {
      const { unread, ...row } = await api.resolveNotification(id, choice);
      replace(row);
      announce(unread);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusyId(null);
    }
  }

  const unread = notifications?.filter((n) => !n.readAt).length ?? 0;
  return (
    <section>
      <h1>Notifications</h1>
      <p>Things the app did or noticed on its own, newest first. Marking one read marks it read for everyone.</p>
      {message && <p className="error-text" role="alert">{message}</p>}
      {notifications === null && !message && <p>Loading...</p>}
      {notifications?.length === 0 && <p>No notifications yet.</p>}
      {unread > 0 && (
        <div className="post-actions">
          <button type="button" className="secondary-button" onClick={markAllRead}>Mark all read</button>
        </div>
      )}
      {notifications?.length > 0 && (
        <ul className="notification-list">
          {notifications.map((n) => (
            <li key={n.id} className={`notification-item notification-${n.kind}${n.readAt ? '' : ' unread'}`}>
              <div className="notification-head">
                <span className="badge">{KIND_LABELS[n.kind] ?? n.kind}</span>
                {!n.readAt && <span className="notification-new">New</span>}
                <span className="notification-when">{formatStamp(n.createdAt, timezone)}</span>
              </div>
              <h2 className="notification-title">{n.title}</h2>
              <p className="notification-body">{n.body}</p>
              {n.kind === 'calendarTextEdit' && n.data && (
                <TextChoice notification={n} canChoose={Boolean(permissions.editPosts)} busy={busyId === n.id}
                  onChoose={(choice) => choose(n.id, choice)} />
              )}
              <div className="notification-links">
                {n.postId && (n.kind === 'postFailed' || n.kind === 'daySkipped' || n.kind === 'calendarClash') && <Link to="/library">Open the Library</Link>}
                {n.kind === 'daySkipped' && <Link to="/calendar">Open the Calendar</Link>}
                {n.postId && permissions.viewActivity && <Link to={`/activity?postId=${n.postId}`}>Post {n.postId} history</Link>}
                {!n.readAt && <button type="button" className="link-button" onClick={() => markRead(n.id)}>Mark read</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
