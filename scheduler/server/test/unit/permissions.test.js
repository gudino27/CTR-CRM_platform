
import test from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../../src/db/index.js';

import {
  can,
  savePermissions,
  riskyGrants,
} from '../../src/services/permissions.js';


// TC-112: Verify user role permissions
test('TC-112: Enforce user roles and permissions', async () => {
  const db = await openDb(':memory:');

  try {
    const superAdmin = {
      role: 'superAdmin',
      active: 1,
    };

    const admin = {
      role: 'admin',
      active: 1,
    };

    const manager = {
      role: 'manager',
      active: 1,
    };

    const employee = {
      role: 'employee',
      active: 1,
    };

    const inactiveUser = {
      role: 'superAdmin',
      active: 0,
    };

    // Super Admin has all permissions.
    assert.equal(
      await can(db, superAdmin, 'manageUsers'),
      true
    );

    assert.equal(
      await can(db, superAdmin, 'superAdmin'),
      true
    );

    // Admin can manage users but cannot
    // perform Super Admin-only actions.
    assert.equal(
      await can(db, admin, 'manageUsers'),
      true
    );

    assert.equal(
      await can(db, admin, 'superAdmin'),
      false
    );

    // Manager can edit schedules,
    // but cannot manage users.
    assert.equal(
      await can(db, manager, 'editSchedules'),
      true
    );

    assert.equal(
      await can(db, manager, 'manageUsers'),
      false
    );

    // Team members can create posts,
    // but cannot edit schedules.
    assert.equal(
      await can(db, employee, 'createPosts'),
      true
    );

    assert.equal(
      await can(db, employee, 'editSchedules'),
      false
    );

    // Inactive accounts lose access,
    // even if they are Super Admin.
    assert.equal(
      await can(db, inactiveUser, 'manageUsers'),
      false
    );

    // Requests without authentication are denied.
    assert.equal(
      await can(db, null, 'createPosts'),
      false
    );

  } finally {
    await db.close();
  }
});


 // TC-113: Verify role permission changes
test('TC-113: Save and validate role permission changes', async () => {
  const db = await openDb(':memory:');

  try {
    const manager = {
      role: 'manager',
      active: 1,
    };

    // Manager initially has permission to edit schedules.
    assert.equal(
      await can(db, manager, 'editSchedules'),
      true
    );

    // Disable the permission.
    const updated = await savePermissions(db, {
      manager: {
        editSchedules: false,
      },
    });

    assert.equal(updated, 1);

    // Verify the new permission is enforced.
    assert.equal(
      await can(db, manager, 'editSchedules'),
      false
    );

    // Restore the permission.
    await savePermissions(db, {
      manager: {
        editSchedules: true,
      },
    });

    assert.equal(
      await can(db, manager, 'editSchedules'),
      true
    );

    // Risky permission grants must be identified.
    const risky = await riskyGrants(db, {
      manager: {
        deletePosts: true,
      },
    });

    assert.ok(
      risky.some(
        item =>
          item.role === 'manager' &&
          item.permission === 'deletePosts'
      )
    );

    // A risky-grant preview must not change permissions.
    assert.equal(
      await can(db, manager, 'deletePosts'),
      false
    );

    // Super Admin permissions cannot be modified.
    await assert.rejects(
      () => savePermissions(db, {
        superAdmin: {
          manageUsers: false,
        },
      }),
      error =>
        String(error).includes(
          'Super admins always have every permission'
        )
    );

  } finally {
    await db.close();
  }
});
