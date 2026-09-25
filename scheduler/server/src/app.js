import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platformsRouter } from './routes/platforms.js';
import { postsRouter } from './routes/posts.js';
import { systemRouter } from './routes/system.js';

const clientDist = join(dirname(fileURLToPath(import.meta.url)), '../../client/dist');

export function createApp(db) {
  const app = express();
  app.use(express.json());

  app.use('/api', systemRouter());
  app.use('/api/platforms', platformsRouter(db));
  app.use('/api/posts', postsRouter(db));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Production: serve the built SPA from the same process
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('/{*splat}', (req, res) => res.sendFile(join(clientDist, 'index.html')));
  }

  return app;
}
