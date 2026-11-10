
import test from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../../src/db/index.js';
import { createApp } from '../../src/app.js';
import { sessionToken } from '../../src/services/auth.js';

// TC-114: Verify API authentication and role restrictions.
test('TC-114: Reject unauthorized API access', async () => {
  const db = await openDb(':memory:');
  let server;

  try {
    // Create test users with different roles.
    const users = {};

    for (const role of [
      'superAdmin',
      'admin',
      'manager',
      'employee',
    ]) {
      const result = await db.run(`
        INSERT INTO appUser (email, name, role, active)
        VALUES (?, ?, ?, 1)
      `, [
        `${role}@test.invalid`,
        `Test ${role}`,
        role,
      ]);

      users[role] = result.lastInsertRowid;
    }

    // Start the real application and authentication middleware.
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

    // Generate valid signed session cookies.
    const cookieFor = role =>
      `ctrSession=${sessionToken(users[role])}`;

    async function request(path, method = 'GET', cookie) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: cookie ? { Cookie: cookie } : {},
      });

      return response.status;
    }

    // 1. Public health endpoint is accessible.
    assert.equal(
      await request('/api/health'),
      200
    );

    // 2. Unauthenticated users cannot view protected data.
    assert.equal(
      await request('/api/users'),
      401
    );

    assert.equal(
      await request('/api/posts'),
      401
    );

    // 3. Tampered session cookies are rejected.
    assert.equal(
      await request('/api/users', 'GET', 'ctrSession=invalid'),
      401
    );

    // 4. Super Admin can manage users.
    assert.equal(
      await request(
        '/api/users',
        'GET',
        cookieFor('superAdmin')
      ),
      200
    );

    // 5. Admin can manage users.
    assert.equal(
      await request(
        '/api/users',
        'GET',
        cookieFor('admin')
      ),
      200
    );

    // 6. Manager cannot manage users.
    assert.equal(
      await request(
        '/api/users',
        'GET',
        cookieFor('manager')
      ),
      403
    );

    // 7. Team member cannot delete posts.
    assert.equal(
      await request(
        '/api/posts/999',
        'DELETE',
        cookieFor('employee')
      ),
      403
    );

    // 8. Manager can view posts.
    assert.equal(
      await request(
        '/api/posts',
        'GET',
        cookieFor('manager')
      ),
      200
    );

    // 9. Only Super Admin can update permissions.
    assert.equal(
      await request(
        '/api/permissions',
        'PUT',
        cookieFor('admin')
      ),
      403
    );

    // 10. Deactivated accounts immediately lose access.
    await db.run(
      'UPDATE appUser SET active = 0 WHERE id = ?',
      [users.manager]
    );

    assert.equal(
      await request(
        '/api/posts',
        'GET',
        cookieFor('manager')
      ),
      401
    );

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
