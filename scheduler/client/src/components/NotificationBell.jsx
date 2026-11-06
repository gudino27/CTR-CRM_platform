/**
 * The bell in the header: links to the Notifications page with the unread count.
 * What lives here: NotificationBell and NOTIFICATIONS_CHANGED (the event that updates it).
 */
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { api } from '../api.js';
import { useCurrentUser } from '../currentUser.js';
import { notificationPollMs } from '../settings.js';
import '../notifications.css';

/**
 * The name of the window event the Notifications page fires after marking read or settling
 * one, so the bell's count follows at once instead of at the next check.
 *
 * Usage:
 *   window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED, { detail: { unread } }))   (pages/Notifications.jsx)
 *
 * Takes:
 *   detail.unread - the new unread count; leave it out and the bell asks the server instead
 */
export const NOTIFICATIONS_CHANGED = 'ctr-notifications-changed';

/** The bell drawing (decorative; the link carries the label). */
function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z" />
    </svg>
  );
}

/**
 * The bell link to the Notifications page, with the number of unread notifications.
 *
 * Usage:
 *   Rendered by Layout.jsx in the header: <NotificationBell />
 *
 * Returns:
 *   A link with the bell and the count ("99+" above 99), or nothing for people without the
 *   viewNotifications permission (for them it also asks the server nothing).
 *
 * How it works:
 *   Asks GET /api/notifications/count on mount, every notificationPollMs (settings.js), and
 *   on every page change (a new page is a good moment to check again); a NOTIFICATIONS_CHANGED
 *   event sets the count at once. The count does not renew the session, so the polling
 *   never keeps an idle person signed in.
 */
export default function NotificationBell() {
  const { permissions } = useCurrentUser();
  const allowed = Boolean(permissions?.viewNotifications);
  const [unread, setUnread] = useState(0);
  const location = useLocation();

  useEffect(() => {
    if (!allowed) return undefined;
    let stopped = false;
    const load = () => api.notificationCount().then((r) => { if (!stopped) setUnread(r.unread); }).catch(() => {});
    load();
    const timer = setInterval(load, notificationPollMs);
    const changed = (event) => (typeof event.detail?.unread === 'number' ? setUnread(event.detail.unread) : load());
    window.addEventListener(NOTIFICATIONS_CHANGED, changed);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener(NOTIFICATIONS_CHANGED, changed);
    };
  }, [allowed, location.pathname]);

  if (!allowed) return null;
  const label = unread ? `Notifications, ${unread} unread` : 'Notifications';
  return (
    <Link to="/notifications" className={`notification-bell${unread ? ' has-unread' : ''}`} aria-label={label} title={label}>
      <BellIcon />
      {unread > 0 && <span className="notification-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
    </Link>
  );
}
