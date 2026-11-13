/**
 * The sign-in screen: "Sign in with Google" with the organization's Google Workspace
 * accounts, the setup code while the setup account exists, and in test mode a "Sign in as"
 * list.
 *
 * What lives here:
 *   SignIn            the screen App.jsx shows instead of the app when nobody is signed in
 *   GoogleButton      Google's own sign-in button
 *   loadGoogleScript  loads Google Identity Services once per page
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { ROLE_LABELS } from '../currentUser.js';
import { googleButtonOptions, googleSignInScriptUrl } from '../settings.js';
import logo from '../assets/ctr-logo.png';

let googleScript = null; // the loading promise, shared by every GoogleButton on the page

/**
 * Loads the Google Identity Services script (googleSignInScriptUrl in settings.js) once.
 *
 * Usage:
 *   const google = await loadGoogleScript();
 *
 * Returns:
 *   A promise of window.google. It rejects when the script cannot load (offline, or blocked by
 *   a browser extension); the next call tries again.
 */
function loadGoogleScript() {
  googleScript ??= new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google);
    const script = document.createElement('script');
    script.src = googleSignInScriptUrl;
    script.async = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => {
      googleScript = null;
      script.remove();
      reject(new Error('Could not load Google sign-in. Check the connection and reload the page.'));
    };
    document.head.appendChild(script);
  });
  return googleScript;
}

/**
 * Google's "Sign in with Google" button. Google draws it (in its own frame); clicking it opens
 * Google's account chooser in a pop-up, and Google then hands back an ID token.
 *
 * Usage:
 *   Rendered by SignIn: <GoogleButton clientId={...} domain="example.org" onCredential={...} onError={setMessage} />
 *
 * Takes:
 *   clientId     - the OAuth Web client ID from GET /api/auth/options
 *   domain       - the Workspace domain, or null; passed to Google as a hint so the chooser
 *                  shows that domain's accounts. The server does the real check.
 *   onCredential - called with the ID token (a string)
 *   onError      - called with a message when the script cannot load
 *
 * Returns:
 *   An empty element Google fills with its button.
 *
 * When editing:
 *   The look comes from googleButtonOptions in settings.js. Google sign-in does not work inside
 *   an iframe, and the page's address must be an Authorized JavaScript origin of the client ID
 *   (see the README's "Google sign-in setup").
 */
function GoogleButton({ clientId, domain, onCredential, onError }) {
  const element = useRef(null);
  const latest = useRef({ onCredential, onError });
  useEffect(() => {
    latest.current = { onCredential, onError };
  });

  useEffect(() => {
    let cancelled = false;
    loadGoogleScript().then((google) => {
      if (cancelled || !element.current) return;
      google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => latest.current.onCredential(response.credential),
        ux_mode: 'popup',
        ...(domain ? { hd: domain } : {}),
      });
      element.current.replaceChildren();
      google.accounts.id.renderButton(element.current, googleButtonOptions);
    }).catch((error) => {
      if (!cancelled) latest.current.onError(error.message);
    });
    return () => { cancelled = true; };
  }, [clientId, domain]);

  return <div ref={element} className="sign-in-google" />;
}

/**
 * The sign-in screen. Shows whichever methods the server offers (GET /api/auth/options):
 * the "Sign in with Google" button when Google sign-in is set up (in test mode too); outside
 * test mode, while the setup account exists, a form for the one-time setup code the server
 * prints in its log at startup; in test mode a "Sign in as" list of the active users (no
 * password); otherwise the server's message.
 *
 * Usage:
 *   Rendered by App.jsx: <SignIn onSignedIn={setUser} message={signedOutReason} />
 *
 * Takes:
 *   onSignedIn - called with the signed-in user from api.signIn; App.jsx then takes the
 *                person back to the page they were on
 *   message    - optional notice saying why the person is here (e.g. signed out after
 *                inactivity); default ""
 *
 * Returns:
 *   The sign-in page: logo, heading, the notice, the method's controls, and any error.
 *
 * How it works:
 *   1. Loads the sign-in options once on mount.
 *   2. Google: options.method "google" (clientId and domain on options) or, in test mode,
 *      options.google. Google's button hands back an ID token; it is posted as
 *      { googleCredential }.
 *   3. options.method "temporary": one button per user; picking one posts { userId }.
 *   4. options.method "setupCode", or "google" with options.setupCode true: a code field;
 *      submitting posts { setupCode }.
 *   5. Any other method: shows options.message.
 *   6. While a request runs, buttons are disabled (Google's own button is ignored instead); an
 *      error re-enables them and shows the server's message (not on the user list, wrong
 *      code, too many tries).
 *
 * When editing:
 *   The options' shapes come from signInOptions() in server/src/services/auth.js, and every
 *   check (the Google token, the Workspace domain, the user list, the code's one use and
 *   expiry, the rate limits) is on the server. The hours shown come from options.codeHours
 *   (setupCodeHours in server/src/settings.js).
 */
export default function SignIn({ onSignedIn, message: notice = '' }) {
  const [options, setOptions] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  // Google's button cannot be disabled, so a second click while signing in is ignored here
  const signingIn = useRef(false);

  useEffect(() => {
    api.signInOptions().then(setOptions).catch((error) => setMessage(error.message));
  }, []);

  const [setupCode, setSetupCode] = useState('');

  async function signIn(body) {
    if (signingIn.current) return;
    signingIn.current = true;
    setBusy(true);
    setMessage('');
    try {
      onSignedIn(await api.signIn(body));
    } catch (error) {
      setMessage(error.message);
      setBusy(false);
      signingIn.current = false;
    }
  }
  const signInAs = (userId) => signIn({ userId });
  const google = options?.method === 'google' ? options : options?.google;
  const showSetupCode = options?.method === 'setupCode' || (options?.method === 'google' && options.setupCode);

  function signInWithCode(event) {
    event.preventDefault();
    signIn({ setupCode });
  }

  return (
    <main className="sign-in">
      <img className="sign-in-logo" src={logo} alt="Conversations to Remember" width="520" height="191" />
      <h1>Sign in to Social Scheduler</h1>
      {notice && <p className="sign-in-notice" role="status">{notice}</p>}
      {google && (
        <section className="sign-in-google-section">
          <p>
            Sign in with your {google.domain ? <strong>{google.domain}</strong> : 'organization\'s'} Google Workspace
            account. You need to be on the Users page first; ask a super admin to add you.
          </p>
          <GoogleButton clientId={google.clientId} domain={google.domain}
            onCredential={(googleCredential) => signIn({ googleCredential })} onError={setMessage} />
        </section>
      )}
      {options?.method === 'temporary' && (
        <>
          <p className="sign-in-temporary">
            <strong>Temporary sign-in for testing.</strong> Pick who you are; there is no password yet.
            Outside test mode people sign in with Google instead.
          </p>
          <ul className="sign-in-list">
            {options.users.map((user) => (
              <li key={user.id}>
                <button type="button" onClick={() => signInAs(user.id)} disabled={busy}>
                  Sign in as {user.name}
                </button>
                <span className="field-hint">
                  {user.isSetup
                    ? 'Temporary super admin for first setup: add the real super admins, then delete it on the Users page'
                    : `${ROLE_LABELS[user.role]} · ${user.email}`}
                </span>
              </li>
            ))}
          </ul>
          {options.users.length === 0 && <p>No active users. Restart the server: it makes a setup account when there is no active super admin.</p>}
        </>
      )}
      {showSetupCode && (
        <form className="user-form sign-in-code" onSubmit={signInWithCode}>
          <p>
            <strong>Sign in with setup code.</strong> The server prints a one-time code in its log when it starts
            (for example in <code>docker compose logs</code>). It signs in as the temporary setup account, works once
            and expires after {options.codeHours} hours.
          </p>
          <label>
            Setup code
            <input value={setupCode} onChange={(e) => setSetupCode(e.target.value)} autoComplete="one-time-code"
              autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX-XXXX" required />
          </label>
          <button type="submit" disabled={busy || !setupCode.trim()}>Sign in with setup code</button>
        </form>
      )}
      {options && !['temporary', 'setupCode', 'google'].includes(options.method) && <p>{options.message}</p>}
      {message && <p className="error-text" role="alert">{message}</p>}
    </main>
  );
}
