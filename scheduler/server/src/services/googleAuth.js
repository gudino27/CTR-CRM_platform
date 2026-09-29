// One OAuth client for Calendar and Drive. The refresh token must carry both
// scopes: https://www.googleapis.com/auth/calendar and .../auth/drive.file
import { auth } from '@googleapis/calendar';
import { config } from '../config.js';

/** OAuth2 client from the Workspace credentials, or null when any are missing. */
export function googleOAuthClient(google = config.google) {
  const { clientId, clientSecret, refreshToken } = google;
  if (!clientId || !clientSecret || !refreshToken) return null;
  const oauth = new auth.OAuth2(clientId, clientSecret);
  oauth.setCredentials({ refresh_token: refreshToken });
  return oauth;
}
