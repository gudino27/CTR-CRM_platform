import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mediaRouter } from './routes/media.js';
import { platformsRouter } from './routes/platforms.js';
import { postsRouter } from './routes/posts.js';
import { systemRouter } from './routes/system.js';
import { testWebhookRouter } from './routes/testWebhook.js';

const clientDist = join(dirname(fileURLToPath(import.meta.url)), '../../client/dist');

// Paths n8n and health checks call without the password
const OPEN_PATHS = [/^\/api\/health$/, /^\/api\/posts\/\d+\/status$/];

function basicAuth(expected) {
  const want = Buffer.from(`Basic ${Buffer.from(expected).toString('base64')}`);
  return (req, res, next) => {
    if (OPEN_PATHS.some((p) => p.test(req.path))) return next();
    const got = Buffer.from(req.get('authorization') ?? '');
    if (got.length === want.length && timingSafeEqual(got, want)) return next();
    res.set('WWW-Authenticate', 'Basic realm="CTR Social Scheduler"').status(401).send('Sign in required');
  };
}

export function createApp(db) {
  const app = express();
  if (config.basicAuth) app.use(basicAuth(config.basicAuth));
  // Before express.json so image uploads keep their raw body
  app.use('/api/media', mediaRouter(db));
  app.use(express.json());

  app.use('/api', systemRouter(db));
  app.use('/api/platforms', platformsRouter(db));
  app.use('/api/posts', postsRouter(db));
  app.use('/api/test-webhook', testWebhookRouter(db));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Production: serve the built SPA from the same process
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('/{*splat}', (req, res) => res.sendFile(join(clientDist, 'index.html')));
  }

  // Body-parser errors (too large, bad JSON) and anything unexpected come back as JSON
  app.use((err, req, res, next) => {
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
  });

  return app;
}
