/**
 * TEMPORARY sign-in screen, until a real sign-in method is chosen
 * (Google sign-in is recommended).
 *
 * What lives here:
 *   SignIn  the screen App.jsx shows instead of the app when nobody is signed in
 */
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ROLE_LABELS } from '../currentUser.js';
import logo from '../assets/ctr-logo.png';

/**
 * The sign-in screen. Shows whichever method the server offers (GET /api/auth/options):
 * in test mode a "Sign in as" list of the active users (no password); outside test mode,
 * while the setup account exists, a form for the one-time setup code the server prints in
 * its log at startup; otherwise the server's message.
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
 *   2. options.method "temporary": one button per user; picking one posts { userId }.
 *   3. options.method "setupCode": a code field; submitting posts { setupCode }.
 *   4. Any other method: shows options.message.
 *   5. While a request runs, buttons are disabled; an error re-enables them and shows the
 *      server's message (wrong code, too many tries).
 *
 * When editing:
 *   To replace the temporary sign-in: change identify() and signInOptions() in
 *   server/src/services/auth.js, then render the real method here when options.method is
 *   no longer "temporary". The code's checks (one use, expiry, rate limit) are all on the
 *   server; the hours shown come from options.codeHours (setupCodeHours in server/src/settings.js).
 */
export default function SignIn({ onSignedIn, message: notice = '' }) {
  const [options, setOptions] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.signInOptions().then(setOptions).catch((error) => setMessage(error.message));
  }, []);

  const [setupCode, setSetupCode] = useState('');

  async function signIn(body) {
    setBusy(true);
    setMessage('');
    try {
      onSignedIn(await api.signIn(body));
    } catch (error) {
      setMessage(error.message);
      setBusy(false);
    }
  }
  const signInAs = (userId) => signIn({ userId });

  function signInWithCode(event) {
    event.preventDefault();
    signIn({ setupCode });
  }

  return (
    <main className="sign-in">
      <img className="sign-in-logo" src={logo} alt="Conversations to Remember" width="520" height="191" />
      <h1>Sign in to Social Scheduler</h1>
      {notice && <p className="sign-in-notice" role="status">{notice}</p>}
      {options?.method === 'temporary' && (
        <>
          <p className="sign-in-temporary">
            <strong>Temporary sign-in for testing.</strong> Pick who you are; there is no password yet.
            The real sign-in will replace this screen.
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
      {options?.method === 'setupCode' && (
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
      {options && !['temporary', 'setupCode'].includes(options.method) && <p>{options.message}</p>}
      {message && <p className="error-text" role="alert">{message}</p>}
    </main>
  );
}
