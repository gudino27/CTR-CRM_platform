// One-time Google sign-in that saves GOOGLE_REFRESH_TOKEN into scheduler/.env.
// Sign in with the team's Workspace account. The redirect below must be listed
// under the OAuth client's "Authorized redirect URIs" in Google Cloud Console.
import { auth } from '@googleapis/calendar';
import { exec } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const ENV_FILE = new URL('../.env', import.meta.url);
const REDIRECT = 'http://localhost:5678/rest/oauth2-credential/callback';
const SCOPES = ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/drive.file'];

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in scheduler/.env first.');
  process.exit(1);
}

const oauth = new auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT);
// prompt=consent makes Google return a refresh token even if this account signed in before
const consentUrl = oauth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  if (url.pathname !== new URL(REDIRECT).pathname) return res.writeHead(404).end();

  const code = url.searchParams.get('code');
  if (!code) {
    res.end(`Sign-in failed: ${url.searchParams.get('error') ?? 'no code returned'}`);
    return finish(1);
  }
  try {
    const { tokens } = await oauth.getToken(code);
    if (!tokens.refresh_token) throw new Error('Google did not return a refresh token');
    const granted = tokens.scope?.split(' ') ?? [];
    const missing = SCOPES.filter((s) => !granted.includes(s));

    const env = readFileSync(ENV_FILE, 'utf8');
    writeFileSync(ENV_FILE, env.replace(/^GOOGLE_REFRESH_TOKEN=.*$/m, `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`));

    res.end('Saved. You can close this tab.');
    console.log('Refresh token saved to scheduler/.env.');
    if (missing.length) console.warn(`Warning: these scopes were not granted: ${missing.join(', ')}`);
    finish(0);
  } catch (err) {
    res.end(`Could not get a token: ${err.message}`);
    console.error(err.message);
    finish(1);
  }
});

function finish(code) {
  server.close(() => process.exit(code));
}

server.listen(5678, 'localhost', () => {
  console.log(`Opening Google sign-in. If no browser opens, visit:\n${consentUrl}\n`);
  const opener = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(`${opener} "${consentUrl}"`);
});
