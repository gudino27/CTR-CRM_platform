/**
 * The app shell: checks who is signed in, shows the sign-in screen or the pages, lists every
 * page's address, and runs the session timeout warning. What lives here: App (the root),
 * Allowed (a page some roles may not open), SessionWarning (the timeout bar) and
 * endedMessage (why a session ended).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { api } from './api.js';
import {
  CurrentUserContext, installSessionWatch, onSessionEvent, rememberReturnTo, sessionState, setSessionTimes, takeReturnTo,
} from './currentUser.js';
import Layout from './components/Layout.jsx';
import Composer from './pages/Composer.jsx';
import Library from './pages/Library.jsx';
import Calendar from './pages/Calendar.jsx';
import Inventory from './pages/Inventory.jsx';
import Platforms from './pages/Platforms.jsx';
import Media from './pages/Media.jsx';
import Users from './pages/Users.jsx';
import Permissions from './pages/Permissions.jsx';
import Activity from './pages/Activity.jsx';
// Notification area
import Notifications from './pages/Notifications.jsx';
// Archive for old published posts
import Archive from './pages/Archive.jsx';
import SignIn from './pages/SignIn.jsx';
// "Times are New York time" note for viewers elsewhere
import { TimeZoneNote } from './components/TimeZone.jsx';
// Warn this long before the idle timeout
import { sessionWarningSeconds } from './settings.js';

installSessionWatch();

/**
 * Wraps a page only some roles may open: shows it, or a short "Not available" note.
 *
 * Usage:
 *   <Allowed when={permissions.manageUsers}><Users /></Allowed>
 *
 * Takes:
 *   when     - true when the signed-in user may open the page
 *   children - the page
 *
 * Returns:
 *   The page, or a "Not available" section.
 *
 * When editing:
 *   This only hides the page; the server refuses the data anyway (server/src/services/permissions.js).
 */
function Allowed({ when, children }) {
  if (when) return children;
  return (
    <section>
      <h1>Not available</h1>
      <p>Your role cannot open this page. Ask a super admin if you need it.</p>
    </section>
  );
}

/**
 * The sentence shown on the sign-in screen after a session ended.
 *
 * Usage:
 *   setMessage(endedMessage('idle', times.current));
 *
 * Takes:
 *   reason - 'idle' (no requests for SESSION_IDLE_MINUTES), 'absolute' (SESSION_MAX_HOURS since
 *            signing in), 'signedOut' (signed out elsewhere), or anything else
 *   times  - { idleMinutes, maxHours } from GET /api/auth/me's session, or null
 *
 * Returns:
 *   The message text.
 *
 * When editing:
 *   30 and 8 are only fallbacks for when the server's times are not known yet; the real
 *   values come from .env through the server.
 */
function endedMessage(reason, times) {
  if (reason === 'idle') return `You were signed out after ${times?.idleMinutes ?? 30} minutes of inactivity. Sign in again to continue where you were.`;
  if (reason === 'absolute') return `You were signed out because sessions last at most ${times?.maxHours ?? 8} hours. Sign in again to continue where you were.`;
  if (reason === 'signedOut') return 'You were signed out. Sign in again to continue.';
  return 'Your session ended. Sign in again to continue where you were.';
}

/** Seconds as "m:ss" ("1:05"). */
const clockText = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * The bar shown in the last minutes before a timeout 
 * (sessionWarningSeconds in settings.js,2 minutes by default), with the time left.
 *
 * Usage:
 *   {warning && <SessionWarning {...warning} onStay={staySignedIn} />}
 *
 * Takes:
 *   secondsLeft - whole seconds until the session ends
 *   idle        - true for the idle timeout (offers "Stay signed in"); false for the absolute
 *                 limit, which no click can extend
 *   onStay      - called by "Stay signed in"
 */
function SessionWarning({ secondsLeft, idle, onStay }) {
  return (
    <div className="session-warning" role="alert">
      <span>
        {idle
          ? 'You will be signed out soon because of inactivity.'
          : 'Your session reaches its time limit soon; save your work, then sign in again.'}{' '}
        <span aria-hidden="true">({clockText(secondsLeft)} left)</span>
      </span>
      {idle && <button type="button" onClick={onStay}>Stay signed in</button>}
    </div>
  );
}

/**
 * The root component: the sign-in screen or the signed-in app with its pages.
 *
 * Usage:
 *   Rendered by main.jsx inside BrowserRouter: <App />
 *
 * Returns:
 *   "Loading..." while checking the session; SignIn when nobody is signed in, otherwise the
 *   pages inside Layout, wrapped in CurrentUserContext ({ user, permissions, signOut, refresh }),
 *   plus the session warning and the time zone note.
 *
 * How it works:
 *   1. On load, GET /api/auth/me: { user, permissions, session } (user null = signed out).
 *      session holds { idleMinutes, maxHours }, kept for the "signed out after" message.
 *   2. A 401 from any call (the session watch in currentUser.js) ends the session. The
 *      current address is remembered, sessionState.ended is set so pages being closed keep
 *      unsaved work (Compose keeps its draft), and the sign-in screen shows why.
 *   3. Once a second it compares the idle and absolute deadlines with now. More than
 *      sessionWarningSeconds left: no warning. Entering the warning window or reaching zero:
 *      it first asks GET /api/auth/session, since another tab may have kept the session
 *      alive, if it is really over it signs out, otherwise it shows the warning with the
 *      fresh time. Offline: it keeps counting, and the next answer from the server settles it.
 *   4. "Stay signed in" just reloads the user: any request renews the idle timer, and this
 *      one also refreshes the user's permissions.
 *   5. After signing in again it goes back to the remembered address.
 *   Someone who cannot write posts (no createPosts) starts on the Library instead of Compose.
 *
 * When editing:
 *   A new page needs a Route here and a link in components/Layout.jsx; wrap it in Allowed
 *   when only some roles may open it (the server must refuse its data too). The /queue and
 *   /schedule redirects keep old links working. The warning lead time is
 *   sessionWarningSeconds in settings.js, the timeouts themselves are SESSION_IDLE_MINUTES
 *   and SESSION_MAX_HOURS in .env.
 */
export default function App() {
  // undefined = still checking
  const [session, setSession] = useState();
  const [message, setMessage] = useState('');
  const [warning, setWarning] = useState(null); // { secondsLeft, idle } in the last two minutes
  const location = useLocation();
  const navigate = useNavigate();
  const signedIn = Boolean(session?.user);
  const times = useRef(null); // { idleMinutes, maxHours } from the server
  const checking = useRef(false);
  const warned = useRef(false); // the warning is showing (checked with the server once)

  const refresh = useCallback(() => {
    api.me().then((result) => {
      if (result.session) times.current = result.session;
      setSession(result);
    }).catch((error) => {
      setMessage(error.message);
      setSession({ user: null });
    });
  }, []);
  useEffect(refresh, [refresh]);

  const endSession = useCallback((reason) => {
    if (sessionState.ended) return;
    sessionState.ended = true;
    rememberReturnTo(`${window.location.pathname}${window.location.search}`);
    warned.current = false;
    setWarning(null);
    setMessage(endedMessage(reason, times.current));
    setSession({ user: null });
  }, []);

  useEffect(() => onSessionEvent((event) => {
    if (event.type === 'ended' && signedIn) endSession(event.reason);
  }), [signedIn, endSession]);

  // The once-a-second check (step 3 above)
  useEffect(() => {
    if (!signedIn) return undefined;
    const timer = setInterval(async () => {
      const { idleDeadline, endDeadline } = sessionState;
      if (!idleDeadline || checking.current) return;
      const now = Date.now();
      const idleLeft = Math.ceil((idleDeadline - now) / 1000);
      const endLeft = endDeadline ? Math.ceil((endDeadline - now) / 1000) : Infinity;
      const left = Math.min(idleLeft, endLeft);
      if (left > sessionWarningSeconds) {
        if (warned.current) setWarning(null);
        warned.current = false;
        return;
      }
      // Ask the server before acting: another tab may have kept the session alive
      if (left <= 0 || !warned.current) {
        checking.current = true;
        try {
          const state = await api.session();
          if (!state.active) {
            endSession(idleLeft <= endLeft ? 'idle' : 'absolute');
            return;
          }
          setSessionTimes(state);
          const fresh = Math.min(state.idleSecondsLeft, state.secondsLeft);
          if (fresh > sessionWarningSeconds) {
            warned.current = false;
            setWarning(null);
            return;
          }
        } catch {
          // offline: keep counting
        } finally {
          checking.current = false;
        }
      }
      warned.current = true;
      setWarning({ secondsLeft: Math.max(0, left), idle: idleLeft <= endLeft });
    }, 1000);
    return () => clearInterval(timer);
  }, [signedIn, endSession]);

  const staySignedIn = useCallback(() => {
    warned.current = false;
    setWarning(null);
    refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await api.signOut().catch(() => {});
    setMessage('');
    warned.current = false;
    setWarning(null);
    setSession({ user: null });
  }, []);

  const signedInAgain = useCallback((result) => {
    sessionState.ended = false;
    if (result.session) times.current = result.session;
    setMessage('');
    setSession(result);
    const back = takeReturnTo();
    if (back && back !== `${location.pathname}${location.search}`) navigate(back, { replace: true });
  }, [location, navigate]);

  if (session === undefined) return <main><p>Loading...</p></main>;
  if (!session.user) return <SignIn onSignedIn={signedInAgain} message={message} />;

  const permissions = session.permissions ?? {};
  const isSuperAdmin = session.user.role === 'superAdmin';
  const home = permissions.createPosts ? '/compose' : '/library';
  return (
    <CurrentUserContext.Provider value={{ user: session.user, permissions, signOut, refresh }}>
      {warning && <SessionWarning {...warning} onStay={staySignedIn} />}
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to={home} replace />} />
          <Route path="compose" element={<Composer />} />
          <Route path="library" element={<Library />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="media" element={<Media />} />
          <Route path="platforms" element={<Platforms />} />
          <Route path="users" element={<Allowed when={permissions.manageUsers}><Users /></Allowed>} />
          <Route path="permissions" element={<Allowed when={isSuperAdmin}><Permissions /></Allowed>} />
          <Route path="activity" element={<Allowed when={permissions.viewActivity}><Activity /></Allowed>} />
          {/* Notification area */}
          <Route path="notifications" element={<Allowed when={permissions.viewNotifications}><Notifications /></Allowed>} />
          {/* Archive for old published posts */}
          <Route path="archive" element={<Allowed when={permissions.archivePosts}><Archive /></Allowed>} />
          {/* Old links */}
          <Route path="queue" element={<Navigate to="/library" replace />} />
          <Route path="schedule" element={<Navigate to="/calendar" replace />} />
        </Route>
      </Routes>
      <TimeZoneNote />
    </CurrentUserContext.Provider>
  );
}
