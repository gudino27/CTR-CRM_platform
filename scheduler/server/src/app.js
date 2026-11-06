/**
 * The Express app: middleware order, every /api router, the built client, and JSON errors.
 * index.js starts it on a port; the tests call createApp on a test database.
 *
 * What lives here:
 *   OPEN_PATHS, isSelfCall, basicAuth  the optional BASIC_AUTH password in front of everything
 *   createApp                          builds the app for one database
 */
import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventoryRouter } from './routes/inventory.js';
import { mediaRouter } from './routes/media.js';
import { platformsRouter } from './routes/platforms.js';
import { postsRouter } from './routes/posts.js';
import { slotsRouter } from './routes/slots.js';
import { systemRouter } from './routes/system.js';
import { testWebhookRouter } from './routes/testWebhook.js';
import { usersRouter } from './routes/users.js';
import { accessControl } from './services/access.js';
import { ensureUsers, sameSecret, SETUP_ACCOUNT } from './services/auth.js';
// The stored session secret and the setup code
import { startAuth } from './services/auth.js';
// Blackout dates
import { blackoutsRouter } from './routes/blackouts.js';
// Notification area
import { notificationsRouter } from './routes/notifications.js';
// Archive for old published posts
import { archiveRouter } from './routes/archive.js';

const clientDist = join(dirname(fileURLToPath(import.meta.url)), '../../client/dist');

// Paths n8n and health checks call without the password
const OPEN_PATHS = [/^\/api\/health$/, /^\/api\/posts\/\d+\/status$/];

/**
 * Whether a request is the dispatcher's own test-mode send to the built-in test endpoint.
 * That call comes from this process, which does not send the BASIC_AUTH password.
 *
 * Usage:
 *   if (isSelfCall(req)) return next();
 *
 * Takes:
 *   req - the Express request
 *
 * Returns:
 *   true for POST /api/test-webhook with the right X-Self-Call header, otherwise false.
 *
 * How it works:
 *   Compares the X-Self-Call header with config.selfCallSecret (made fresh at startup and
 *   sent by services/dispatch.js), in constant time (sameSecret).
 *
 * When editing:
 *   Do not swap this for a loopback-address check: behind a proxy or tunnel everyone looks
 *   like 127.0.0.1.
 */
const isSelfCall = (req) => req.method === 'POST' && req.path === '/api/test-webhook'
  && sameSecret(req.get('x-self-call'), config.selfCallSecret);

/**
 * Middleware that puts the whole app behind HTTP basic auth (BASIC_AUTH="user:password"),
 * for a public test URL. It runs before, and apart from, the app's own sign-in.
 *
 * Usage:
 *   if (config.basicAuth) app.use(basicAuth(config.basicAuth));
 *
 * Takes:
 *   expected - the "user:password" text from BASIC_AUTH
 *
 * Returns:
 *   Express middleware: next() for OPEN_PATHS, the app's own test call and the right password;
 *   otherwise 401 "Sign in required" with a WWW-Authenticate header so the browser asks.
 *
 * How it works:
 *   Builds the expected Authorization header once, then compares each request's header with it
 *   in constant time (timingSafeEqual, after a length check).
 *
 * When editing:
 *   Keep the comparison constant-time. A path added to OPEN_PATHS skips the password for everyone.
 */
function basicAuth(expected) {
  const want = Buffer.from(`Basic ${Buffer.from(expected).toString('base64')}`);
  return (req, res, next) => {
    if (OPEN_PATHS.some((p) => p.test(req.path))) return next();
    if (isSelfCall(req)) return next();
    const got = Buffer.from(req.get('authorization') ?? '');
    if (got.length === want.length && timingSafeEqual(got, want)) return next();
    res.set('WWW-Authenticate', 'Basic realm="CTR Social Scheduler"').status(401).send('Sign in required');
  };
}

/**
 * Builds the Express app for one open database.
 *
 * Usage:
 *   (await createApp(db)).listen(config.port);
 *
 * Takes:
 *   db - the database from db/index.js openDb (SQLite or MariaDB)
 *
 * Returns:
 *   The Express app, ready to listen. Unknown /api paths answer 404 { error: 'Not found' };
 *   errors answer JSON { error } (500s say only "Internal server error" and are logged).
 *
 * How it works:
 *   1. BASIC_AUTH, when set.
 *   2. Users: makes sure a super admin exists (the setup account otherwise, announced in the log
 *      outside tests), then startAuth: sessions survive a restart, and outside test mode the
 *      setup account gets a one-time code in the log (services/auth.js).
 *   3. accessControl (services/access.js): who is signed in, may they call this route
 *      (ROUTES in services/permissions.js), and the audit log after a change.
 *   4. The media router, then express.json, then every other router.
 *   5. In production, the built client (client/dist) for every other path.
 *   6. The JSON error handler: body-parser errors (too large, bad JSON) and anything unexpected.
 *
 * When editing:
 *   The order matters: accessControl must stay before every router, and /api/media before
 *   express.json so image uploads keep their raw body. A new router also needs its mutating
 *   routes in ROUTES (services/permissions.js), or only super admins may call them.
 */
export async function createApp(db) {
  const app = express();
  if (config.basicAuth) app.use(basicAuth(config.basicAuth));
  const { setupCreated } = await ensureUsers(db);
  if (setupCreated && !process.env.NODE_TEST_CONTEXT) {
    console.log(`No active super admin: "${SETUP_ACCOUNT.name}" is ready. Sign in with it, add the real super admins on the Users page, then delete it there.`);
  }
  await startAuth(db);
  // Permissions for every route below: must stay first
  app.use(accessControl(db));
  // Before express.json so image uploads keep their raw body
  app.use('/api/media', mediaRouter(db));
  app.use(express.json());

  app.use('/api', systemRouter(db));
  app.use('/api/platforms', platformsRouter(db));
  app.use('/api/posts', postsRouter(db));
  app.use('/api/slots', slotsRouter(db));
  app.use('/api', inventoryRouter(db));
  app.use('/api/test-webhook', testWebhookRouter(db));
  app.use('/api', usersRouter(db));
  app.use('/api/blackouts', blackoutsRouter(db)); // blackout dates
  app.use('/api/notifications', notificationsRouter(db)); // notification area
  app.use('/api/archive', archiveRouter(db)); // archive for old published posts
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Production: serve the built SPA from the same process
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('/{*splat}', (req, res) => res.sendFile(join(clientDist, 'index.html')));
  }

  app.use((err, req, res, next) => {
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
  });

  return app;
}
