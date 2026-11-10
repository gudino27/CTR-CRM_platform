
import test from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../../src/db/index.js';
import { createApp } from '../../src/app.js';
import { sessionToken } from '../../src/services/auth.js';
import { config } from '../../src/config.js';

// TC-115: Session expiration, logout, and revocation
test('TC-115: Enforce session expiration and logout', async () => {
  const db = await openDb(':memory:');
  let server;

  try {
    // Create a test Super Admin.
    const result = await db.run(`
      INSERT INTO appUser (email, name, role, active)
      VALUES (?, ?, ?, 1)
    `, [
      'session-test@test.invalid',
      'Session Test User',
      'superAdmin',
    ]);

    const userId = result.lastInsertRowid;

    // Start the real application.
    const app = await createApp(db);

    server = await new Promise(resolve => {
      const instance = app.listen(
        0,
        '127.0.0.1',
        () => resolve(instance)
      );
    });

    const baseUrl =
      `http://127.0.0.1:${server.address().port}`;

    async function request(path, token, method = 'GET') {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: token
          ? { Cookie: `ctrSession=${token}` }
          : {},
      });

      const data = response.status === 204
        ? null
        : await response.json();

      return { status: response.status, data };
    }

    // 1. A valid session allows access.
    const validToken = sessionToken(userId);

    const valid = await request('/api/posts', validToken);

    assert.equal(valid.status, 200);

    // Check the session status endpoint.
    const session = await request(
      '/api/auth/session',
      validToken
    );

    assert.equal(session.status, 200);
    assert.equal(session.data.active, true);

    // 2. Logging out revokes the session.
    const logout = await request(
      '/api/auth/sign-out',
      validToken,
      'POST'
    );

    assert.equal(logout.status, 204);

    // The old cookie must no longer work.
    const revoked = await request(
      '/api/posts',
      validToken
    );

    assert.equal(revoked.status, 401);
    assert.equal(revoked.data.reason, 'signedOut');

    // 3. A session expires after inactivity.
    const now = Date.now();
    const idleMs = config.session.idleMinutes * 60_000;

    const idleToken = sessionToken(userId, {
      issued: now - idleMs - 10_000,
      seen: now - idleMs - 5_000,
    });

    const idle = await request(
      '/api/posts',
      idleToken
    );

    assert.equal(idle.status, 401);
    assert.equal(idle.data.reason, 'idle');

    // 4. Absolute expiration overrides recent activity.
    const maxMs = config.session.maxHours * 3_600_000;

    const expiredToken = sessionToken(userId, {
      issued: now - maxMs - 10_000,
      seen: now - 1_000,
    });

    const expired = await request(
      '/api/posts',
      expiredToken
    );

    assert.equal(expired.status, 401);
    assert.equal(expired.data.reason, 'absolute');

    // 5. A new session can still access the API.
    const newToken = sessionToken(userId);

    const renewed = await request(
      '/api/posts',
      newToken
    );

    assert.equal(renewed.status, 200);

  } finally {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close(error =>
          error ? reject(error) : resolve()
        );
      });
    }

    await db.close();
  }
});
