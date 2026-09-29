import { config } from './config.js';
import { openDb } from './db/index.js';
import { seed } from './db/seed.js';
import { createApp } from './app.js';
import { failInterrupted } from './services/dispatch.js';
import { tick } from './routes/system.js';

const TICK_MS = 60_000;

const db = openDb();
seed(db);
failInterrupted(db);

createApp(db).listen(config.port, async () => {
  console.log(`Scheduler API on http://localhost:${config.port} (test mode: ${config.testMode}, dry run: ${config.dryRun})`);
  
  const health = await fetch(`${config.selfUrl}/api/health`).then((r) => r.json()).catch(() => null);
  if (health?.app !== 'ctr-scheduler') {
    console.error(`\nWARNING: something else is answering on port ${config.port}. Set a free PORT in .env (for example PORT=3100).\n`);
  }
  await tick(db);
  setInterval(() => tick(db).catch((err) => console.error('Tick failed:', err)), TICK_MS);
});