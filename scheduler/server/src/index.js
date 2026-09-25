import { config } from './config.js';
import { openDb } from './db/index.js';
import { seed } from './db/seed.js';
import { createApp } from './app.js';

const db = openDb();
seed(db);

createApp(db).listen(config.port, () => {
  console.log(`Scheduler API on http://localhost:${config.port} (test mode: ${config.testMode})`);
});
