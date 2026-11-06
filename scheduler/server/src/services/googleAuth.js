/**
 * The one Google OAuth client shared by Calendar and Drive.
 */
import { auth } from '@googleapis/calendar';
import { config } from '../config.js';

/**
 * Builds the OAuth2 client from the Workspace credentials, so Calendar and Drive calls are
 * made as the account that owns the refresh token.
 *
 * Usage:
 *   const oauth = googleOAuthClient();   // or googleOAuthClient(testGoogleConfig)
 *
 * Takes:
 *   google - { clientId, clientSecret, refreshToken }; defaults to config.google
 *            (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN in .env)
 *
 * Returns:
 *   An auth.OAuth2 client with the refresh token set, or null when any of the three is missing.
 *
 * How it works:
 *   Returns null early if a credential is blank; otherwise creates the client and sets the
 *   refresh token (Google fetches access tokens from it as needed).
 *
 * When editing:
 *   The refresh token must carry both scopes: https://www.googleapis.com/auth/calendar and
 *   https://www.googleapis.com/auth/drive.file. Callers (googleCalendar.js, googleDrive.js)
 *   treat null as "Google is not set up" and skip or fall back, so keep returning null
 *   rather than throwing.
 */
export function googleOAuthClient(google = config.google) {
  const { clientId, clientSecret, refreshToken } = google;
  if (!clientId || !clientSecret || !refreshToken) return null;
  const oauth = new auth.OAuth2(clientId, clientSecret);
  oauth.setCredentials({ refresh_token: refreshToken });
  return oauth;
}
