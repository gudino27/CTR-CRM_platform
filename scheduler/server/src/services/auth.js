/**
 * Who is making a request. A signed session cookie carries the user's id and a session id;
 * the user row is read again on every request, so deactivating someone or changing their
 * role takes effect right away.
 *
 * People sign in with Google, using the organization's Google Workspace accounts
 * (GOOGLE_SIGNIN_CLIENT_ID, GOOGLE_WORKSPACE_DOMAIN; see the README's "Google sign-in setup").
 * The sign-in page gets a Google ID token from Google Identity Services and sends it here; the
 * token is verified and its email must belong to an active user on the Users page. Nobody is
 * ever added by signing in. The setup account has no Google identity and uses the setup code.
 * Test mode also offers a "Sign in as" list with no password. Everything that decides *who
 * someone is* lives in identify() and signInOptions() below; the session cookie, timeouts,
 * roles and permissions do not depend on how someone signed in.
 *
 * Session timeouts follow the OWASP Session Management Cheat Sheet
 * (https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html):
 *   * "Session Expiration": both an idle timeout (SESSION_IDLE_MINUTES, default 30) and an
 *     absolute timeout (SESSION_MAX_HOURS, default 8), enforced on the server, not only by
 *     the cookie's lifetime or the browser.
 *   * The idle timer slides: every request renews it and the cookie is re-issued.
 *   * "Renew the Session ID After Any Privilege Level Change": signing in always starts a
 *     new session id (and ends the one the browser had).
 *   * "Manual Session Expiration": signing out invalidates the session on the server
 *     (revokedSession), so a copied cookie stops working too.
 *   * Cookie attributes: HttpOnly, SameSite=Lax, Secure when the app is served over https.
 * The session clock is real time (Date.now()), not the test-mode app clock.
 *
 * The cookie signing secret is SESSION_SECRET when set; otherwise one is made on the first
 * start and kept in appSetting, so a restart does not sign everyone out (loadSessionSecret).
 *
 * What lives here: session cookies (sessionToken, readSessionToken, startSession,
 * renewSession, clearSessionCookie, revokeSession, readSession, currentUser, sessionTimes),
 * the setup code (makeSetupCode, printSetupCode, startAuth), Google sign-in (googleSignIn,
 * setGoogleVerifier), what the sign-in screen offers and who someone is (signInOptions,
 * identify), ensureUsers, userView and sameSecret.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config.js';
// The setup code's lifetime, tries, length and letters live in settings.js
import {
  googleSignInTries, googleSignInWindowMs,
  setupCodeHours, setupCodeLength, setupCodeLetters, setupCodeTries, setupCodeWindowMs,
} from '../settings.js';

const COOKIE = 'ctrSession';
// The setup account: made at startup when there is no active super admin (see ensureUsers)
export const SETUP_ACCOUNT = { name: 'Setup account (temporary)', email: 'setup@setup.invalid' };

// Test-mode demo sign-ins, one per role (DEMO_USERS=true). The .invalid domain can never be a real address.
export const DEMO_USERS = [
  { name: 'Demo Super Admin', email: 'superadmin@demo.invalid', role: 'superAdmin' },
  { name: 'Demo Admin', email: 'admin@demo.invalid', role: 'admin' },
  { name: 'Demo Manager', email: 'manager@demo.invalid', role: 'manager' },
  { name: 'Demo Team Member', email: 'employee@demo.invalid', role: 'employee' },
];

// Until loadSessionSecret has run (scripts and tests that never start the app), a random one
let secret = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
const SESSION_SECRET_SETTING = 'sessionSecret';

/**
 * Picks the secret that signs session cookies: SESSION_SECRET from the environment wins;
 * otherwise the one stored in appSetting, made (once) the first time. The secret is never logged.
 *
 * Usage:
 *   await loadSessionSecret(db);   // startAuth, at startup
 *
 * Returns:
 *   Nothing; sets the module's secret.
 *
 * How it works:
 *   Reads appSetting sessionSecret. When missing, removes an empty row, inserts a new random
 *   one with ON CONFLICT DO NOTHING (if another start stored one first, that one is used),
 *   and reads it back. Says so once in the log (not in tests).
 *
 * When editing:
 *   Changing the secret signs everyone out. Never log it.
 */
export async function loadSessionSecret(db) {
  if (process.env.SESSION_SECRET) {
    secret = process.env.SESSION_SECRET;
    return;
  }
  const read = async () => (await db.get('SELECT value FROM appSetting WHERE "key" = ?', [SESSION_SECRET_SETTING]))?.value;
  let stored = await read();
  if (!stored) {
    // DO NOTHING: another start may have stored one first
    await db.run('DELETE FROM appSetting WHERE "key" = ? AND (value IS NULL OR value = \'\')', [SESSION_SECRET_SETTING]);
    await db.run('INSERT INTO appSetting ("key", value) VALUES (?, ?) ON CONFLICT ("key") DO NOTHING',
      [SESSION_SECRET_SETTING, randomBytes(32).toString('hex')]);
    stored = await read();
    if (!process.env.NODE_TEST_CONTEXT) {
      console.log('SESSION_SECRET is not set: made one and stored it in the database, so sessions survive a restart.');
    }
  }
  secret = stored;
}

const sign = (text) => createHmac('sha256', secret).update(text).digest('base64url');
const idleMs = () => config.session.idleMinutes * 60_000;
const maxMs = () => config.session.maxHours * 3_600_000;

/**
 * Compares a secret someone sent with the expected one in constant time.
 *
 * Usage:
 *   sameSecret(req.get('x-callback-secret'), config.n8nCallbackSecret)
 *
 * Returns:
 *   true only when both are equal and the expected one is not empty.
 *
 * When editing:
 *   Keep timingSafeEqual: a plain === would let someone guess a secret by timing.
 */
export function sameSecret(given, expected) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(String(expected ?? ''));
  return b.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Makes a signed session token: "userId.sessionId.signedInMs.lastSeenMs.signature".
 *
 * Usage:
 *   sessionToken(user.id)                              // a new session
 *   sessionToken(userId, { sessionId, issued, seen })  // re-issue one with a fresh lastSeen
 *
 * Returns:
 *   The token text; the signature is an HMAC-SHA256 of the rest with the session secret.
 */
export function sessionToken(userId, { sessionId = randomBytes(18).toString('base64url'), issued = Date.now(), seen = Date.now() } = {}) {
  const body = `${userId}.${sessionId}.${issued}.${seen}`;
  return `${body}.${sign(body)}`;
}

/**
 * What a token says, checked.
 *
 * Usage:
 *   const session = readSessionToken(token);
 *
 * Returns:
 *   { userId, sessionId, issued, seen }, or { expired: 'idle' | 'absolute' } for a genuine
 *   token that timed out, or null for anything else (missing, tampered, old format, or from
 *   the future).
 *
 * How it works:
 *   Checks the signature in constant time, then the numbers. A token seen more than a minute
 *   in the future is not ours (a minute of slack for clock changes). The absolute limit is
 *   checked before the idle one.
 *
 * When editing:
 *   This does not check revoked sessions or the user row; readSession does.
 */
export function readSessionToken(token, now = Date.now()) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 5) return null;
  const [userId, sessionId, issued, seen, signature] = parts;
  const want = Buffer.from(sign(`${userId}.${sessionId}.${issued}.${seen}`));
  const got = Buffer.from(signature);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const session = { userId: Number(userId), sessionId, issued: Number(issued), seen: Number(seen) };
  if (!Number.isInteger(session.userId) || !Number.isFinite(session.issued) || !Number.isFinite(session.seen)) return null;
  // A minute of slack for clock changes; a token from the future is not ours
  if (session.seen > now + 60_000 || session.issued > session.seen) return null;
  if (now - session.issued >= maxMs()) return { expired: 'absolute' };
  if (now - session.seen >= idleMs()) return { expired: 'idle' };
  return session;
}

// One cookie's value from the request's Cookie header, or null
function cookieValue(req, name) {
  for (const part of (req.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

const secure = () => (config.appUrl.startsWith('https://') ? '; Secure' : '');

/**
 * How long a session has left, for the page's countdown.
 *
 * Usage:
 *   res.json(req.user ? { active: true, ...sessionTimes(req.session) } : { active: false });   // GET /api/auth/session
 *
 * Returns:
 *   { idleMinutes, maxHours (the settings), idleSecondsLeft, secondsLeft (never below 0) }
 */
export function sessionTimes(session, now = Date.now()) {
  return {
    idleMinutes: config.session.idleMinutes,
    maxHours: config.session.maxHours,
    idleSecondsLeft: Math.max(0, Math.floor((session.seen + idleMs() - now) / 1000)),
    secondsLeft: Math.max(0, Math.floor((session.issued + maxMs() - now) / 1000)),
  };
}

/**
 * Sets the cookie for a session with lastSeen = now (the sliding idle timer), and tells the
 * page how long it has left in X-Session-Idle-Seconds and X-Session-Seconds.
 *
 * Returns:
 *   The session with its new lastSeen.
 *
 * When editing:
 *   The cookie's Max-Age is whichever timeout comes first, so the browser drops the cookie
 *   when the session would end anyway. The server still checks both timeouts itself.
 */
function writeSession(res, session, now = Date.now()) {
  const renewed = { ...session, seen: now };
  const times = sessionTimes(renewed, now);
  // Whichever timeout comes first
  const maxAge = Math.min(times.idleSecondsLeft, times.secondsLeft);
  res.append('Set-Cookie', `${COOKIE}=${sessionToken(session.userId, renewed)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure()}`);
  res.set('X-Session-Idle-Seconds', String(times.idleSecondsLeft));
  res.set('X-Session-Seconds', String(times.secondsLeft));
  return renewed;
}

/**
 * Starts a new session (always a new session id) for a user who just signed in.
 *
 * Usage:
 *   const session = startSession(res, user.id);   // POST /api/auth/sign-in
 *
 * Returns:
 *   The new session { userId, sessionId, issued, seen }; the cookie is set on res.
 */
export function startSession(res, userId) {
  const now = Date.now();
  return writeSession(res, { userId, sessionId: randomBytes(18).toString('base64url'), issued: now, seen: now }, now);
}

/**
 * Activity: restarts the idle timer of the request's session (access.js, on every request
 * except routes marked renew: false).
 *
 * Returns:
 *   The session with its new lastSeen; the cookie is re-issued on res.
 */
export const renewSession = (res, session) => writeSession(res, session);

/**
 * Tells the browser to drop the session cookie (sign-out, or a cookie that no longer counts).
 *
 * Usage:
 *   clearSessionCookie(res);
 */
export function clearSessionCookie(res) {
  res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure()}`);
}

/**
 * Signs a session out on the server, so the cookie and any copy of it stop working.
 *
 * Usage:
 *   await revokeSession(db, req.session);   // sign-out, and sign-in (ends the old session)
 *
 * Takes:
 *   session - { sessionId, issued }, or null (does nothing)
 *
 * How it works:
 *   Adds the session id to revokedSession until the session would have timed out anyway, and
 *   removes rows for sessions that have timed out by now (no longer needed).
 */
export async function revokeSession(db, session) {
  if (!session?.sessionId) return;
  const now = Date.now();
  await db.run('INSERT INTO revokedSession (id, expiresAt) VALUES (?, ?) ON CONFLICT (id) DO NOTHING',
    [session.sessionId, session.issued + maxMs()]);
  await db.run('DELETE FROM revokedSession WHERE expiresAt < ?', [now]);
}

/**
 * The request's session.
 *
 * Usage:
 *   const { user, session, reason } = await readSession(db, req);   // services/access.js
 *
 * Returns:
 *   { user, session } when signed in; otherwise { user: null, reason } where reason is 'idle',
 *   'absolute' or 'signedOut' when a cookie was sent but no longer counts (undefined when there
 *   was no usable cookie at all, or the user is gone or deactivated).
 *
 * How it works:
 *   Reads and checks the cookie's token, checks revokedSession, then reads the active user
 *   row fresh, so a role change or deactivation counts at once.
 */
export async function readSession(db, req) {
  const token = cookieValue(req, COOKIE);
  if (!token) return { user: null };
  const session = readSessionToken(token);
  if (!session) return { user: null };
  if (session.expired) return { user: null, reason: session.expired };
  if (await db.get('SELECT 1 FROM revokedSession WHERE id = ?', [session.sessionId])) return { user: null, reason: 'signedOut' };
  const user = await db.get('SELECT * FROM appUser WHERE id = ? AND active = 1', [session.userId]);
  return user ? { user, session } : { user: null };
}

/**
 * The signed-in, active user for a request, or null.
 *
 * Usage:
 *   const user = await currentUser(db, req);
 */
export async function currentUser(db, req) {
  return (await readSession(db, req)).user;
}

/**
 * A user row as the API returns it: active and isSetup as booleans.
 *
 * Usage:
 *   res.json({ user: userView(user), ... });   // routes/users.js
 *
 * Returns:
 *   The row with those two flags as booleans, or the row itself when it is empty.
 */
export const userView = (row) => row && ({ ...row, active: Boolean(row.active), isSetup: Boolean(row.isSetup) });

// ---- Setup code: how the setup account signs in outside test mode ----
//
// While the setup account exists and is active, each start makes one code (makeSetupCode) and
// prints it in the server log (printSetupCode), so it shows in `docker compose logs`. Only its
// hash is kept, in memory. It works once and for setupCodeHours; after that (or once the setup
// account is deleted or deactivated) there is no working code until the next start. Wrong codes
// are limited per address (req.ip; the app does not trust X-Forwarded-For, so behind a proxy or
// tunnel everyone shares one limit, which is stricter, not looser). Test mode has no code: its
// "Sign in as" list already offers the setup account.

let setupCode = null; // { hash, expiresAt } of the current code, or null
const failedTries = new Map(); // address -> times (ms) of wrong codes in the last window

const normalizeCode = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const codeHash = (code) => createHash('sha256').update(normalizeCode(code)).digest('hex');
const activeSetupAccount = (db) => db.get('SELECT * FROM appUser WHERE isSetup = 1 AND active = 1');

/**
 * Makes this start's setup code and returns it ("ABCD-EFGH-JKMN"), or null when there is no
 * active setup account or in test mode. Any earlier code stops working.
 *
 * Usage:
 *   const code = await makeSetupCode(db);   // startAuth
 *
 * Takes:
 *   now - the time in ms (Date.now() by default)
 *
 * How it works:
 *   Forgets the old code and every wrong-try count, picks setupCodeLength letters from
 *   setupCodeLetters (settings.js) with a secure random number, groups them in fours, and
 *   keeps only the hash and the expiry (setupCodeHours from now).
 *
 * When editing:
 *   The grouping assumes setupCodeLength is a multiple of 4. The code itself is never stored.
 */
export async function makeSetupCode(db, now = Date.now()) {
  setupCode = null;
  failedTries.clear();
  if (config.testMode || !(await activeSetupAccount(db))) return null;
  const letters = Array.from({ length: setupCodeLength }, () => setupCodeLetters[randomInt(setupCodeLetters.length)]).join('');
  const code = letters.match(/.{4}/g).join('-');
  setupCode = { hash: codeHash(code), expiresAt: now + setupCodeHours * 3_600_000 };
  return code;
}

/**
 * Prints the setup code as a boxed block in the server log, so it shows in
 * `docker compose logs`.
 *
 * Usage:
 *   printSetupCode('ABCD-EFGH-JKMN');
 */
export function printSetupCode(code) {
  const lines = [
    `SETUP CODE: ${code}`,
    '',
    `Sign in as "${SETUP_ACCOUNT.name}" with this code on the sign-in screen.`,
    `It works once and expires in ${setupCodeHours} hours. Restart the server for a new one.`,
    'Then add the real super admins on the Users page and delete the setup account.',
  ];
  const width = Math.max(...lines.map((line) => line.length));
  const border = `+${'-'.repeat(width + 4)}+`;
  console.log(['', border, ...lines.map((line) => `|  ${line.padEnd(width)}  |`), border, ''].join('\n'));
}

/**
 * Signs in with the setup code.
 *
 * Takes:
 *   given   - the code typed in (any case, dashes and spaces ignored)
 *   address - the caller's address (req.ip), for the wrong-code limit
 *   now     - the time in ms
 *
 * Returns:
 *   The active setup account for a correct, unused, unexpired code. Throws { status, error }
 *   otherwise: 429 after setupCodeTries wrong codes from that address within
 *   setupCodeWindowMs (settings.js), 401 for a wrong, expired or used code.
 *
 * How it works:
 *   Compares hashes in constant time. A right code is used up before anything else awaits,
 *   so it works only once even with two requests at the same moment. A wrong one is counted
 *   for the address; a success clears the address's count.
 *
 * When editing:
 *   The 429 message's minutes are built from setupCodeWindowMs.
 */
async function setupCodeSignIn(db, given, address = 'unknown', now = Date.now()) {
  const tries = (failedTries.get(address) ?? []).filter((t) => now - t < setupCodeWindowMs);
  if (tries.length >= setupCodeTries) {
    throw { status: 429, error: `Too many wrong setup codes from here. Try again in ${setupCodeWindowMs / 60_000} minutes.` };
  }
  // Compared as hashes in constant time; used up before anything else awaits, so it works only once
  const right = setupCode !== null && now < setupCode.expiresAt && sameSecret(codeHash(given), setupCode.hash);
  if (right) setupCode = null;
  const user = right ? await activeSetupAccount(db) : null;
  if (!user) {
    if (failedTries.size > 1000) failedTries.clear(); // keeps the table small; the window is short anyway
    failedTries.set(address, [...tries, now]);
    throw { status: 401, error: 'That setup code is not right, has expired or was already used. Restart the server for a new one.' };
  }
  failedTries.delete(address);
  return user;
}

/**
 * At startup, after ensureUsers: the session secret, then this start's setup code (printed).
 *
 * Usage:
 *   await startAuth(db);   // app.js
 *
 * When editing:
 *   Must run after ensureUsers, since the code is only made when an active setup account exists.
 */
export async function startAuth(db) {
  await loadSessionSecret(db);
  const code = await makeSetupCode(db);
  if (code && !process.env.NODE_TEST_CONTEXT) printSetupCode(code);
}

// ---- Google sign-in ----
//
// The sign-in page gets an ID token (a "credential") from Google Identity Services and posts it
// as { googleCredential }. Google signs the token; verifying it proves which Google account
// signed in. Failed sign-ins are limited per address like wrong setup codes.

const googleFailures = new Map(); // address -> times (ms) of failed Google sign-ins in the last window
let googleClient = null;

/**
 * The real token check: google-auth-library verifies the signature against Google's public
 * keys (fetched from Google and cached), the issuer, the expiry and the audience.
 *
 * Takes:
 *   idToken  - the credential from the sign-in page
 *   audience - GOOGLE_SIGNIN_CLIENT_ID
 *
 * Returns:
 *   The token's payload ({ email, email_verified, hd, name, ... }). Throws for a bad token.
 */
async function verifyWithGoogle(idToken, audience) {
  googleClient ??= new OAuth2Client();
  const ticket = await googleClient.verifyIdToken({ idToken, audience });
  return ticket.getPayload();
}

let verifyGoogleToken = verifyWithGoogle;

/**
 * Replaces the Google token check, so tests never call Google, and clears the failed-sign-in
 * counts.
 *
 * Usage:
 *   setGoogleVerifier(async (idToken, audience) => ({ email: 'a@example.org', email_verified: true }));
 *   setGoogleVerifier(null);   // back to the real check
 *
 * Takes:
 *   verify - async (idToken, audience) => payload, throwing for a bad token; null for the real one
 */
export function setGoogleVerifier(verify) {
  verifyGoogleToken = verify ?? verifyWithGoogle;
  googleFailures.clear();
}

/**
 * Signs in with a Google ID token.
 *
 * Usage:
 *   const user = await googleSignIn(db, req.body.googleCredential, req.ip);   // via identify
 *
 * Takes:
 *   credential - the ID token from Google Identity Services
 *   address    - the caller's address (req.ip), for the failed-sign-in limit
 *   now        - the time in ms
 *
 * Returns:
 *   The active user whose email the token carries. Throws { status, error }:
 *   501 when GOOGLE_SIGNIN_CLIENT_ID is not set; 429 after googleSignInTries failures from that
 *   address within googleSignInWindowMs (settings.js); 401 when Google does not confirm the
 *   token (bad, expired, or made for another client ID); 403 for an unverified email, an
 *   account outside GOOGLE_WORKSPACE_DOMAIN (when set), or an email that is not an active user.
 *
 * How it works:
 *   1. Checks the address's failure count, then verifies the token (signature, issuer, expiry,
 *      audience = GOOGLE_SIGNIN_CLIENT_ID).
 *   2. Requires email_verified, and the token's hd (its Workspace domain) to equal
 *      GOOGLE_WORKSPACE_DOMAIN when that is set.
 *   3. Looks the email up among active, non-setup users, ignoring case.
 *   4. Fills in the user's name from the token only when it is empty. Nothing else from the
 *      token is stored.
 *   Every failure from step 1's verify onwards is counted for the address; a success clears it.
 *
 * When editing:
 *   Never create a user here: only people added on the Users page may sign in. Keep the hd
 *   check: without it any Google account with a matching email address would pass. A
 *   deactivated user gets the same 403 as an unknown one.
 */
export async function googleSignIn(db, credential, address = 'unknown', now = Date.now()) {
  const { clientId, domain } = config.googleSignIn;
  if (!clientId) throw { status: 501, error: 'Google sign-in is not set up on this server' };
  const tries = (googleFailures.get(address) ?? []).filter((t) => now - t < googleSignInWindowMs);
  if (tries.length >= googleSignInTries) {
    throw { status: 429, error: `Too many failed Google sign-ins from here. Try again in ${googleSignInWindowMs / 60_000} minutes.` };
  }
  const fail = (status, error) => {
    if (googleFailures.size > 1000) googleFailures.clear(); // keeps the table small; the window is short anyway
    googleFailures.set(address, [...tries, now]);
    return { status, error };
  };
  let payload;
  try {
    payload = typeof credential === 'string' && credential ? await verifyGoogleToken(credential, clientId) : null;
  } catch {
    payload = null;
  }
  if (!payload?.email) throw fail(401, 'Google could not confirm this sign-in. Try again.');
  if (payload.email_verified !== true) throw fail(403, 'This Google account\'s email address is not verified.');
  // Without this check any Google account with a matching address would pass
  if (domain && String(payload.hd ?? '').toLowerCase() !== domain) {
    throw fail(403, `Sign in with your ${domain} Google Workspace account.`);
  }
  const user = await db.get('SELECT * FROM appUser WHERE LOWER(email) = ? AND active = 1 AND isSetup = 0',
    [String(payload.email).trim().toLowerCase()]);
  if (!user) throw fail(403, "This Google account is not on the scheduler's user list. Ask a super admin to add you.");
  googleFailures.delete(address);
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (name && !String(user.name ?? '').trim()) {
    await db.run("UPDATE appUser SET name = ?, updatedAt = datetime('now') WHERE id = ?", [name, user.id]);
    return { ...user, name };
  }
  return user;
}

// ---- What the sign-in screen offers, and who someone is ----

const temporarySignIn = () => config.testMode;
const googleOption = () => (config.googleSignIn.clientId
  ? { clientId: config.googleSignIn.clientId, domain: config.googleSignIn.domain }
  : null);

/**
 * What the sign-in screen shows.
 *
 * Usage:
 *   res.json(await signInOptions(db));   // GET /api/auth/options
 *
 * Returns:
 *   Outside test mode, one of:
 *     { method: 'google', message, clientId, domain, setupCode, codeHours } when
 *       GOOGLE_SIGNIN_CLIENT_ID is set. setupCode is true while an active setup account
 *       exists, so the setup code form shows under the Google button. domain is
 *       GOOGLE_WORKSPACE_DOMAIN or null.
 *     { method: 'setupCode', message, codeHours } without Google sign-in, while an active
 *       setup account exists.
 *     { method: 'none', message } otherwise.
 *   In test mode: { method: 'temporary', message, users: [{ id, name, email, role, isSetup }],
 *   google: { clientId, domain } or null }: every active user, highest role first, the setup
 *   account after the others of its role; google is set when GOOGLE_SIGNIN_CLIENT_ID is, so
 *   the Google button can be tried locally too.
 *
 * When editing:
 *   client/src/pages/SignIn.jsx reads these shapes. The client ID is public (it is in the
 *   page anyway); never send the OAuth client secret.
 */
export async function signInOptions(db) {
  if (!temporarySignIn()) {
    const google = googleOption();
    const setup = Boolean(await activeSetupAccount(db));
    if (google) {
      return { method: 'google', message: 'Sign in with your Google Workspace account.', ...google,
        setupCode: setup, codeHours: setupCodeHours };
    }
    if (setup) {
      return { method: 'setupCode', message: 'Sign in with the setup code printed in the server log at startup.', codeHours: setupCodeHours };
    }
    return { method: 'none', message: 'Sign-in has not been set up for this server yet.' };
  }
  const users = await db.all(`SELECT id, name, email, role, isSetup FROM appUser WHERE active = 1
    ORDER BY CASE role WHEN 'superAdmin' THEN 0 WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, isSetup, name`);
  return { method: 'temporary', message: 'Temporary test-mode sign-in: pick a user. No password.',
    users: users.map((u) => ({ ...u, isSetup: Boolean(u.isSetup) })), google: googleOption() };
}

/**
 * Turns what the sign-in screen sent into an active user row.
 *
 * Usage:
 *   const user = await identify(db, req.body, req.ip);   // POST /api/auth/sign-in
 *
 * Takes:
 *   body    - { googleCredential } signs in with Google (any mode; see googleSignIn).
 *             { setupCode } signs in as the setup account (any mode; see above).
 *             Test mode only: { userId } with no proof.
 *   address - the caller's IP, for the failed-sign-in limits
 *
 * Returns:
 *   The user row. Throws { status, error }: googleSignIn's 401/403/429/501, the setup code's
 *   401/429, 501 outside test mode for any other body, 400 for no such active user.
 *
 * When editing:
 *   The { userId } branch must stay test-mode only: it trusts the caller completely.
 */
export async function identify(db, body, address) {
  if (body && 'googleCredential' in body) return googleSignIn(db, body.googleCredential, address);
  if (body && 'setupCode' in body) return setupCodeSignIn(db, body.setupCode, address);
  // Trusts the caller completely: test mode only
  if (!temporarySignIn()) throw { status: 501, error: 'Sign-in has not been set up for this server yet' };
  const userId = Number(body?.userId);
  const user = Number.isInteger(userId) ? await db.get('SELECT * FROM appUser WHERE id = ? AND active = 1', [userId]) : null;
  if (!user) throw { status: 400, error: 'Pick an active user to sign in as' };
  return user;
}

// ---- Startup ----

/**
 * Brings the first super admins into being; never changes anyone who already exists, so
 * roles changed in the app stick across restarts.
 *
 * Usage:
 *   const { setupCreated } = await ensureUsers(db);   // app.js, at startup, before startAuth
 *
 * Takes:
 *   emails - comma-separated addresses; SUPER_ADMIN_EMAILS by default
 *
 * Returns:
 *   { setupCreated: true } when the setup account was made or reactivated, otherwise false.
 *
 * How it works:
 *   1. Each email in SUPER_ADMIN_EMAILS (comma-separated, lowercased) without an account gets
 *      an active super admin account named after the part before @. An existing account with
 *      that email is left as it is.
 *   2. Demos: in test mode with DEMO_USERS=true, one sign-in per role (DEMO_USERS above), so
 *      each role's view can be shown.
 *   3. If there is still no active super admin at all, the setup account is made (or
 *      reactivated as a super admin), so someone can sign in and add the real super admins.
 *      In test mode this is also the account the "Sign in as" list starts with.
 */
export async function ensureUsers(db, emails = process.env.SUPER_ADMIN_EMAILS ?? '') {
  for (const email of emails.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)) {
    await db.run("INSERT INTO appUser (email, name, role) VALUES (?, ?, 'superAdmin') ON CONFLICT (email) DO NOTHING",
      [email, email.split('@')[0]]);
  }
  // Demo accounts: test mode only, and only with DEMO_USERS=true
  if (config.testMode && process.env.DEMO_USERS === 'true') {
    for (const user of DEMO_USERS) {
      await db.run('INSERT INTO appUser (email, name, role) VALUES (?, ?, ?) ON CONFLICT (email) DO NOTHING',
        [user.email, user.name, user.role]);
    }
  }
  if (await db.get("SELECT 1 FROM appUser WHERE role = 'superAdmin' AND active = 1")) return { setupCreated: false };
  const existing = await db.get('SELECT id FROM appUser WHERE isSetup = 1');
  if (existing) {
    await db.run("UPDATE appUser SET role = 'superAdmin', active = 1, updatedAt = datetime('now') WHERE id = ?", [existing.id]);
  } else {
    await db.run("INSERT INTO appUser (email, name, role, isSetup) VALUES (?, ?, 'superAdmin', 1) ON CONFLICT (email) DO NOTHING",
      [SETUP_ACCOUNT.email, SETUP_ACCOUNT.name]);
  }
  return { setupCreated: true };
}
