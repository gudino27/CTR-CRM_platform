const env = process.env;
const port = Number(env.PORT ?? 3000);
const testMode = env.TEST_MODE !== 'false';

export const config = {
  port,
  dbPath: env.DB_PATH ?? './data/scheduler.db',
  timezone: env.TIMEZONE ?? 'America/Los_Angeles',
  testMode,
  // Public base URL of this app; used for the test endpoint, status callbacks, and local image links
  appUrl: (env.APP_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
  // How the app reaches itself (the built-in test endpoint); APP_URL may be a proxy it can't see from inside
  selfUrl: `http://127.0.0.1:${port}`,
  // "user:password" puts the whole app behind HTTP basic auth (for a public test URL, until team login)
  basicAuth: env.BASIC_AUTH || null,
  // Logs what the dispatcher would send instead of sending it
  dryRun: env.DRY_RUN === 'true',
  webhook: {
    // Production publish URL (the client's n8n); per-platform webhookUrl overrides it
    url: env.WEBHOOK_URL,
    // Test mode sends every post here; defaults to the built-in /api/test-webhook
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
};

/** Local image links are stored relative (the public URL can change between runs); make them absolute for n8n and Calendar. */
export const absoluteUrl = (link) => (link?.startsWith('/') ? `${config.appUrl}${link}` : link);