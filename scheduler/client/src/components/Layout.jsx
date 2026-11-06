/**
 * The frame around every signed-in page: the test mode banner, the top bar (logo, page
 * links, notification bell, who is signed in, Sign out) and the page itself.
 */
import { Link, NavLink, Outlet } from 'react-router';
import logo from '../assets/ctr-logo.png';
import TestModeBanner from './TestModeBanner.jsx';
// Notification area: renders nothing without viewNotifications
import NotificationBell from './NotificationBell.jsx';
import { ROLE_LABELS, useCurrentUser } from '../currentUser.js';

/**
 * The page links in the top bar, in the order shown: [path, label, who sees it].
 * "Who sees it" is a test given { user, permissions }; without one, everyone signed in sees
 * the link (those pages are read-only for people who may not change them).
 *
 * When editing:
 *   Keep each test the same as the page's Allowed check in App.jsx, so nobody gets a link to
 *   a page that says "Not available". Hiding a link does not protect anything; the server
 *   checks permissions on every call.
 */
const links = [
  ['/compose', 'Compose', ({ permissions }) => permissions.createPosts],
  ['/library', 'Library'],
  ['/calendar', 'Calendar'],
  ['/inventory', 'Inventory'],
  ['/media', 'Media'],
  ['/platforms', 'Platforms'],
  ['/users', 'Users', ({ permissions }) => permissions.manageUsers],
  ['/permissions', 'Permissions', ({ user }) => user.role === 'superAdmin'],
  ['/activity', 'Activity', ({ permissions }) => permissions.viewActivity],
  // Archive for old published posts
  ['/archive', 'Archive', ({ permissions }) => permissions.archivePosts],
];

/**
 * The shared frame for the signed-in pages.
 *
 * Usage:
 *   Rendered by App.jsx as the parent route: <Route element={<Layout />}> ...pages... </Route>
 *
 * Returns:
 *   TestModeBanner, the header (logo linking to "/", the links this user may see, the bell,
 *   the user's name with a "Temporary" badge for the setup account, the role, Sign out), and
 *   <main> holding the current page (react-router's Outlet).
 *
 * When editing:
 *   The logo is assets/ctr-logo.png; its width and height attributes are the file's own size
 *   (the CSS scales it). The role words come from ROLE_LABELS in currentUser.js.
 */
export default function Layout() {
  const current = useCurrentUser();
  const { user, signOut } = current;
  return (
    <>
      <TestModeBanner />
      <header className="topbar">
        <Link to="/" className="brand">
          <img className="brand-logo" src={logo} alt="Conversations to Remember" width="520" height="191" />
          <span className="brand-name">Social Scheduler</span>
        </Link>
        <nav>
          {links.filter(([, , show]) => !show || show(current)).map(([to, label]) => (
            <NavLink key={to} to={to}>{label}</NavLink>
          ))}
        </nav>
        {user && (
          <div className="current-user">
            <NotificationBell />
            <span>
              <strong>{user.name}{user.isSetup && <span className="setup-badge">Temporary</span>}</strong>
              <span className="current-user-role">{ROLE_LABELS[user.role]}</span>
            </span>
            <button type="button" className="secondary-button" onClick={signOut}>Sign out</button>
          </div>
        )}
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
