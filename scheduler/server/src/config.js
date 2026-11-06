/**
 * Values set per server, read once from the environment (.env). Every variable is listed in the
 * README under "Server settings (.env)" and in .env.example. Values that are the same on every
 * server but that people may want to change live in settings.js instead.
 *
 * What lives here:
 *   config       every .env value the server uses, with its default
 *   absoluteUrl  turns a stored local image link into a full URL
 *
 * When editing:
 *   A new variable also goes in .env.example and the README's "Server settings (.env)" list (the
 *   delivered zip does not include .env.example). MEDIA_TRASH_DAYS and ARCHIVE_AFTER_MONTHS are read
 *   in services/mediaTrash.js and services/archive.js, not here.
 */
import { randomBytes } from 'node:crypto';

const env = process.env;
const port = Number(env.PORT ?? 3000);
const testMode = env.TEST_MODE !== 'false';

/**
 * The server's settings from .env, with defaults.
 *
 * Usage:
 *   config.timezone, config.testMode, config.google.calendarId
 *
 * Returns:
 *   port             PORT (default 3000)
 *   dbPath           DB_PATH, the SQLite file (default ./data/scheduler.db)
 *   db               DB_CLIENT=sqlite (default, the DB_PATH file) or mariadb (DATABASE_URL, or the
 *                    DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME fields)
 *   timezone         TIMEZONE (default America/New_York): the time all schedules are in
 *   testMode         on unless TEST_MODE=false
 *   appUrl           APP_URL, the public base URL of this app (no trailing slash); used for the test
 *                    endpoint, status callbacks, and local image links
 *   selfUrl          how the app reaches itself (the built-in test endpoint); APP_URL may be a proxy
 *                    it can't see from inside
 *   basicAuth        BASIC_AUTH "user:password" puts the whole app behind HTTP basic auth (for a
 *                    public test URL, until team login); null when unset
 *   dryRun           DRY_RUN=true logs what the dispatcher would send instead of sending it
 *   webhook.url      WEBHOOK_URL, the production publish URL (the n8n publish workflow); a platform's own
 *                    webhookUrl overrides it
 *   webhook.testUrl  TEST_WEBHOOK_URL: test mode sends every post here; defaults to the built-in
 *                    /api/test-webhook
 *   google           GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, DRIVE_FOLDER_ID, and
 *                    calendarId: TEST_CALENDAR_ID in test mode, CALENDAR_ID otherwise, so test mode
 *                    never touches the production calendar
 *   session          sign-in sessions end after idleMinutes without a request (SESSION_IDLE_MINUTES,
 *                    default 30) and maxHours after signing in no matter what (SESSION_MAX_HOURS,
 *                    default 8); see services/auth.js
 *   n8nCallbackSecret N8N_CALLBACK_SECRET: when set, n8n's status callback must send it in the
 *                    X-Callback-Secret header
 *   selfCallSecret   made fresh at every start: the dispatcher sends it to the built-in test endpoint
 *                    so BASIC_AUTH lets the app's own call through (nobody outside the process knows it)
 *
 * When editing:
 *   Keep the test-mode calendar switch: test mode must never write to the production calendar.
 */
export const config = {
  port,
  dbPath: env.DB_PATH ?? './data/scheduler.db',
  db: {
    client: env.DB_CLIENT || 'sqlite',
    mariadb: {
      url: env.DATABASE_URL || undefined,
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
    },
  },
  timezone: env.TIMEZONE ?? 'America/New_York',
  testMode,
  appUrl: (env.APP_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
  selfUrl: `http://127.0.0.1:${port}`,
  basicAuth: env.BASIC_AUTH || null,
  dryRun: env.DRY_RUN === 'true',
  webhook: {
    url: env.WEBHOOK_URL,
    testUrl: env.TEST_WEBHOOK_URL,
  },
  google: {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    refreshToken: env.GOOGLE_REFRESH_TOKEN,
    // Test mode never touches the production calendar
    calendarId: testMode ? env.TEST_CALENDAR_ID : env.CALENDAR_ID,
    driveFolderId: env.DRIVE_FOLDER_ID,
  },
  session: {
    idleMinutes: positive(env.SESSION_IDLE_MINUTES, 30),
    maxHours: positive(env.SESSION_MAX_HOURS, 8),
  },
  n8nCallbackSecret: env.N8N_CALLBACK_SECRET || null,
  selfCallSecret: randomBytes(32).toString('hex'),
};

/**
 * A positive number from an environment variable, or the fallback.
 *
 * Usage:
 *   positive(env.SESSION_IDLE_MINUTES, 30)
 *
 * Takes:
 *   value    - the raw text from process.env (may be undefined)
 *   fallback - what to use when it is missing, not a number, zero or negative
 *
 * Returns:
 *   The number, or fallback.
 */
function positive(value, fallback) {
  const number = Number(value);
  return value && Number.isFinite(number) && number > 0 ? number : fallback;
}

/**
 * Makes a stored image link absolute, for n8n and Google Calendar. Local image links are
 * stored relative ("/api/media/12/file") because the public URL can change between runs.
 *
 * Usage:
 *   absoluteUrl(post.mediaLink)   // "https://app.example.org/api/media/12/file"
 *
 * Takes:
 *   link - a stored link: relative (starts with "/"), a Drive URL, or null/undefined
 *
 * Returns:
 *   config.appUrl + link for a relative link; anything else unchanged.
 */
export const absoluteUrl = (link) => (link?.startsWith('/') ? `${config.appUrl}${link}` : link);