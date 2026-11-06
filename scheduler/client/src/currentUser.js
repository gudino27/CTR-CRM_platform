/**
 * The signed-in user and what their role may do, shared by the nav and pages. Also watches
 * the session: how long until it times out, and when the server says it ended; and keeps
 * unsaved work across a timeout.
 *
 * What lives here:
 *   CurrentUserContext, useCurrentUser, ROLE_LABELS          who is signed in
 *   sessionState, onSessionEvent, setSessionTimes,
 *   installSessionWatch                                       the session watch
 *   saveDraft, takeDraft, rememberReturnTo, takeReturnTo      unsaved work across a timeout
 *
 * Session watch: the server ends a session after SESSION_IDLE_MINUTES without a request and
 * SESSION_MAX_HOURS after signing in (server/src/services/auth.js; both set in .env). Every
 * API answer carries the time left in X-Session-Idle-Seconds and X-Session-Seconds; a 401
 * means the session is over. Watching fetch here covers api.js and the few pages that call
 * fetch directly.
 *
 * Unsaved work is kept in sessionStorage until the person signs back in.
 */
import { createContext, useContext } from 'react';

/**
 * The signed-in user, provided by App.jsx around every page.
 *
 * Usage:
 *   <CurrentUserContext.Provider value={{ user, permissions, signOut, refresh }}>   (App.jsx)
 *
 * When editing:
 *   The default value is what a component sees outside the provider (nobody signed in).
 */
export const CurrentUserContext = createContext({ user: null, permissions: {}, signOut: () => {} });

/**
 * The signed-in user and what their role may do.
 *
 * Usage:
 *   const { user, permissions } = useCurrentUser();
 *   if (permissions.createPosts) ...
 *
 * Returns:
 *   { user, permissions, signOut, refresh }. user is the GET /api/auth/me user (name, role,
 *   isSetup, ...); permissions is { createPosts: true, ... }; signOut() signs out; refresh()
 *   reloads the user and permissions.
 *
 * When editing:
 *   Hiding a button with permissions is for convenience only; the server checks every call.
 */
export const useCurrentUser = () => useContext(CurrentUserContext);

/**
 * The words shown for each role (nav, Users page, sign-in list).
 *
 * Usage:
 *   ROLE_LABELS[user.role]   // "Super admin"
 *
 * When editing:
 *   The keys are the role values the server stores; change only the words. "employee" reads
 *   "Team member" (the stored key stays employee). The server has the same words in
 *   ROLE_LABELS (server/src/services/permissions.js, the Permissions page's headings), keep both the same.
 */
export const ROLE_LABELS = { superAdmin: 'Super admin', admin: 'Admin', manager: 'Manager', employee: 'Team member' };

/**
 * This tab's session timing, shared by the watch and App.jsx.
 *
 * Returns:
 *   { ended, idleDeadline, endDeadline }:
 *   ended        - true once a timeout signed this tab out, so pages can keep unsaved work (see saveDraft)
 *   idleDeadline - ms timestamp when the idle timeout falls, or null before the first answer
 *   endDeadline  - ms timestamp when the session's absolute limit falls, or null
 *
 * When editing:
 *   App.jsx sets ended and clears it after signing in again; Compose reads it to decide
 *   whether to keep its draft.
 */
export const sessionState = { ended: false, idleDeadline: null, endDeadline: null };
const listeners = new Set();
const notify = (event) => listeners.forEach((listener) => listener(event));

/**
 * Subscribes to session events.
 *
 * Usage:
 *   useEffect(() => onSessionEvent((event) => { ... }), []);   (App.jsx)
 *
 * Takes:
 *   listener - called with { type: 'times' } after each answer that carried the time left,
 *              or { type: 'ended', reason } on a 401 (reason from the server: 'idle',
 *              'absolute', 'signedOut', or undefined)
 *
 * Returns:
 *   A function that unsubscribes.
 */
export function onSessionEvent(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Records the time left in the session and tells listeners ({ type: 'times' }).
 *
 * Usage:
 *   setSessionTimes(await api.session());   (App.jsx)
 *
 * Takes:
 *   { idleSecondsLeft, secondsLeft } - seconds until the idle timeout and the absolute limit,
 *   from an answer's headers or from GET /api/auth/session. A value that is not a finite
 *   number leaves that deadline as it was.
 */
export function setSessionTimes({ idleSecondsLeft, secondsLeft }) {
  const now = Date.now();
  if (Number.isFinite(idleSecondsLeft)) sessionState.idleDeadline = now + idleSecondsLeft * 1000;
  if (Number.isFinite(secondsLeft)) sessionState.endDeadline = now + secondsLeft * 1000;
  notify({ type: 'times' });
}

let installed = false;
/**
 * Wraps window.fetch so every /api answer updates the session times and a 401 ends the session.
 *
 * Usage:
 *   installSessionWatch();   (once, at the top of App.jsx)
 *
 * How it works:
 *   1. Runs once; later calls do nothing.
 *   2. Lets the real fetch run, then ignores answers from other sites or outside /api/.
 *   3. Reads X-Session-Idle-Seconds and X-Session-Seconds into setSessionTimes.
 *   4. On a 401 from anything but /api/auth/*, reads { reason } and sends { type: 'ended', reason }.
 *
 * Returns:
 *   Nothing. The wrapped fetch returns the original Response untouched (the body is read
 *   from a clone).
 *
 * When editing:
 *   The header names are set by the server (server/src/services/auth.js); keep both sides the same.
 */
export function installSessionWatch() {
  if (installed) return;
  installed = true;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await realFetch(input, init);
    const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return res;
    const idle = res.headers.get('X-Session-Idle-Seconds');
    if (idle !== null) setSessionTimes({ idleSecondsLeft: Number(idle), secondsLeft: Number(res.headers.get('X-Session-Seconds')) });
    // Sign-in calls answer 401s of their own, everything else means the session is gone
    if (res.status === 401 && !url.pathname.startsWith('/api/auth/')) {
      const body = await res.clone().json().catch(() => ({}));
      notify({ type: 'ended', reason: body.reason });
    }
    return res;
  };
}

const DRAFT_PREFIX = 'ctrDraft:';
const RETURN_KEY = 'ctrReturnTo';

/**
 * Keeps a page's unsaved work in this tab's sessionStorage, to bring back after signing in again.
 *
 * Usage:
 *   if (sessionState.ended) saveDraft('compose', draft);   (pages/Composer.jsx)
 *
 * Takes:
 *   name  - the page's key ('compose'); stored as "ctrDraft:<name>"
 *   value - anything JSON can hold
 *
 * Returns:
 *   Nothing. If storage is full or blocked the draft is lost, as it would have been before.
 */
export function saveDraft(name, value) {
  try {
    sessionStorage.setItem(DRAFT_PREFIX + name, JSON.stringify(value));
  } catch {
    // storage full or blocked: the draft is lost
  }
}

/**
 * Takes back a draft saved by saveDraft and removes it from storage, so it comes back once.
 *
 * Usage:
 *   const saved = takeDraft('compose');   (pages/Composer.jsx)
 *
 * Returns:
 *   The saved value, or null when there is none or storage cannot be read.
 */
export function takeDraft(name) {
  try {
    const text = sessionStorage.getItem(DRAFT_PREFIX + name);
    sessionStorage.removeItem(DRAFT_PREFIX + name);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/**
 * Remembers where the person was when the session ended, to go back there after signing in.
 *
 * Usage:
 *   rememberReturnTo(`${window.location.pathname}${window.location.search}`);   (App.jsx)
 *
 * Returns:
 *   Nothing. If storage is blocked it is not kept, and they land on the page the address bar
 *   still shows.
 */
export function rememberReturnTo(path) {
  try {
    sessionStorage.setItem(RETURN_KEY, path);
  } catch {
    // not kept
  }
}

/**
 * Takes back the path saved by rememberReturnTo and removes it.
 *
 * Usage:
 *   const back = takeReturnTo();   (App.jsx, after signing in again)
 *
 * Returns:
 *   The path, or null. Only a value starting with "/" (a path in this app) comes back.
 */
export function takeReturnTo() {
  try {
    const path = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    // Only a path in this app: "//site" and "/\site" would leave it
    return path?.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path : null;
  } catch {
    return null;
  }
}
