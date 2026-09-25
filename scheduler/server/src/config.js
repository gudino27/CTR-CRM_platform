const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  dbPath: env.DB_PATH ?? './data/scheduler.db',
  timezone: env.TIMEZONE ?? 'America/Los_Angeles',
  testMode: env.TEST_MODE !== 'false',
  google: {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    refreshToken: env.GOOGLE_REFRESH_TOKEN,
    // Test mode never touches the production calendar that n8n watches
    calendarId: env.TEST_MODE !== 'false' ? env.TEST_CALENDAR_ID : env.CALENDAR_ID,
    driveFolderId: env.DRIVE_FOLDER_ID,
  },
};
