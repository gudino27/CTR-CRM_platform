/**
 * Activity page: recent changes from the audit log, who did what and when.
 * ?postId=12 shows one post's history.
 *
 * What lives here:
 *   formatWhen      an audit row's createdAt shown in the app zone
 *   ENTITY_LABELS   readable names for the audit log's entityType values
 *   Activity        the page (route /activity)
 *
 * Entries per page is activityPageSize in settings.js.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api.js';
import { formatStamp } from '../time.js';
import { activityPageSize } from '../settings.js';

/**
 * Shows when an audit entry was written.
 *
 * Usage:
 *   formatWhen(entry.createdAt, timezone)
 *
 * Takes:
 *   createdAt - from SQLite's datetime('now'): "YYYY-MM-DD HH:MM:SS" in UTC (real time,
 *               not the test clock)
 *   timeZone  - the app zone from /api/status
 *
 * Returns:
 *   A string in the app zone, with the viewer's own time added when they are elsewhere
 *   (formatStamp in time.js).
 */
const formatWhen = (createdAt, timeZone) => formatStamp(createdAt, timeZone);

// auditLog.entityType -> label in the "Item" column; unknown types show as stored
const ENTITY_LABELS = { post: 'Post', slot: 'Slot', platform: 'Platform', postType: 'Post type', scheduleRule: 'Schedule rule',
  media: 'Image', user: 'User', permissions: 'Permissions' };

/**
 * The Activity page: a table of audit log entries, newest first, either for everyone or
 * for one post (?postId=), with "Load older" paging.
 *
 * Usage:
 *   Rendered by App.jsx for the /activity route: <Activity />; other pages link to
 *   /activity?postId=12 for one post's history.
 *
 * Returns:
 *   The page section: a "Post number" filter form, then the table (When, Who, What, Item).
 *
 * How it works:
 *   1. Reads postId from the URL; the filter form and the "Post N" buttons only change
 *      the URL, and the list reloads from that.
 *   2. Loads activityPageSize entries (GET /api/activity). A full page means there may be
 *      more, so "Load older" shows; it asks for entries before the last id shown.
 *   3. Rows without a user are named by their action: post.status is n8n's status
 *      callback, post.calendar* is an edit read back from Google Calendar, anything else
 *      is the setup account after it was deleted.
 *
 * When editing:
 *   The action names (post.status, post.calendar...) are written by the server
 *   (auditLog rows in server/src/routes and services); if a new kind of change has no
 *   user, add its label here.
 */
export default function Activity() {
  const [params, setParams] = useSearchParams();
  const postId = params.get('postId') ?? '';
  const [entries, setEntries] = useState([]);
  const [more, setMore] = useState(false);
  const [timezone, setTimezone] = useState();
  const [postInput, setPostInput] = useState(postId);
  const [message, setMessage] = useState('');

  const filters = postId ? { entityType: 'post', entityId: postId } : {};

  useEffect(() => {
    api.status().then((status) => setTimezone(status.timezone)).catch(() => {});
  }, []);

  useEffect(() => {
    setMessage('');
    setPostInput(postId);
    api.activity({ ...filters, limit: activityPageSize }).then((rows) => {
      setEntries(rows);
      setMore(rows.length === activityPageSize);
    }).catch((error) => setMessage(error.message));
  }, [postId]);

  async function loadOlder() {
    try {
      const rows = await api.activity({ ...filters, limit: activityPageSize, before: entries.at(-1).id });
      setEntries([...entries, ...rows]);
      setMore(rows.length === activityPageSize);
    } catch (error) {
      setMessage(error.message);
    }
  }

  function showPost(event) {
    event.preventDefault();
    const id = postInput.trim();
    setParams(id ? { postId: id } : {});
  }

  return (
    <section>
      <h1>Activity</h1>
      <p>{postId ? `Everything that happened to post ${postId}, newest first.` : 'Recent changes by everyone, newest first.'}</p>

      <form className="activity-filter" onSubmit={showPost}>
        <label htmlFor="activity-post">Post number</label>
        <input id="activity-post" inputMode="numeric" pattern="[0-9]*" value={postInput}
          onChange={(event) => setPostInput(event.target.value)} placeholder="All posts" />
        <button type="submit">Show</button>
        {postId && <button type="button" className="secondary-button" onClick={() => setParams({})}>Show everything</button>}
      </form>

      {message && <p className="error-text" role="alert">{message}</p>}
      {entries.length === 0 && !message && <p>Nothing has been changed yet.</p>}

      {entries.length > 0 && (
        <div className="table-wrap">
          <table className="inventory-table activity-table">
            <thead>
              <tr><th>When</th><th>Who</th><th>What</th><th>Item</th></tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatWhen(entry.createdAt, timezone)}</td>
                  {/* No user: n8n, Google Calendar, or the deleted setup account */}
                  <td>{entry.userName ?? (entry.action === 'post.status' ? 'n8n'
                    : entry.action.startsWith('post.calendar') ? 'Google Calendar' : 'Setup account (deleted)')}</td>
                  <td>{entry.summary}</td>
                  <td>
                    {entry.entityType === 'post' && !postId ? (
                      <button type="button" className="link-button" onClick={() => setParams({ postId: String(entry.entityId) })}>
                        Post {entry.entityId}
                      </button>
                    ) : (
                      `${ENTITY_LABELS[entry.entityType] ?? entry.entityType ?? ''} ${entry.entityId ?? ''}`.trim()
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more && <div className="post-actions"><button type="button" className="secondary-button" onClick={loadOlder}>Load older</button></div>}
    </section>
  );
}
