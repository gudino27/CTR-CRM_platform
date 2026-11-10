
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mkdtempSync,
  rmSync,
  readdirSync,
} from 'node:fs';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb } from '../../src/db/index.js';

// Create an isolated temporary SQLite database.
async function withTemporaryDatabase(callback) {
  const directory = mkdtempSync(
    join(tmpdir(), 'ctr-db-test-')
  );

  const dbPath = join(directory, 'test.sqlite');

  try {
    await callback(dbPath);
  } finally {
    rmSync(directory, {
      recursive: true,
      force: true,
    });
  }
}

// TC-069: Initialize SQLite database
test('TC-069: Initialize SQLite database', async () => {
  const db = await openDb(':memory:');

  try {
    const result = await db.get(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
      AND name = 'schemaMigration'
    `);

    assert.equal(result.name, 'schemaMigration');
    assert.equal(db.dialect, 'sqlite');

  } finally {
    await db.close();
  }
});

// TC-070: Verify database migrations
test('TC-070: Apply database migrations', async () => {
  const db = await openDb(':memory:');

  try {
    const expected = readdirSync(
      new URL('../../src/db/migrations/', import.meta.url)
    )
      .filter(name => name.endsWith('.sql'))
      .sort();

    const rows = await db.all(`
      SELECT name
      FROM schemaMigration
      ORDER BY name
    `);

    const actual = rows.map(row => row.name);

    assert.ok(expected.length > 0);
    assert.deepEqual(actual, expected);

  } finally {
    await db.close();
  }
});

// TC-071: Verify foreign key enforcement
test('TC-071: Enforce foreign key constraints', async () => {
  const db = await openDb(':memory:');

  try {
    const settings = await db.get(
      'PRAGMA foreign_keys'
    );

    assert.equal(settings.foreign_keys, 1);

    await db.exec(`
      CREATE TABLE testParent (
        id INTEGER PRIMARY KEY
      );

      CREATE TABLE testChild (
        id INTEGER PRIMARY KEY,
        parentId INTEGER REFERENCES testParent(id)
      );
    `);

    await assert.rejects(
      async () => {
        await db.run(
          'INSERT INTO testChild (id, parentId) VALUES (?, ?)',
          [1, 999]
        );
      },
      /FOREIGN KEY/i
    );

  } finally {
    await db.close();
  }
});

// TC-072: Verify database persistence
test('TC-072: Persist records after reopening', async () => {
  await withTemporaryDatabase(async dbPath => {
    let db = await openDb(dbPath);

    try {
      await db.exec(`
        CREATE TABLE testRecord (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL
        )
      `);

      await db.run(
        'INSERT INTO testRecord (id, name) VALUES (?, ?)',
        [1, 'CTR Test Record']
      );

    } finally {
      await db.close();
    }

    db = await openDb(dbPath);

    try {
      const record = await db.get(
        'SELECT * FROM testRecord WHERE id = ?',
        [1]
      );

      assert.equal(record.id, 1);
      assert.equal(record.name, 'CTR Test Record');

    } finally {
      await db.close();
    }
  });
});

// TC-073: Prevent duplicate migrations
test('TC-073: Avoid duplicate migrations', async () => {
  await withTemporaryDatabase(async dbPath => {
    let db = await openDb(dbPath);
    let original;

    try {
      const rows = await db.all(
        'SELECT name FROM schemaMigration ORDER BY name'
      );

      original = rows.map(row => row.name);

    } finally {
      await db.close();
    }

    db = await openDb(dbPath);

    try {
      const rows = await db.all(
        'SELECT name FROM schemaMigration ORDER BY name'
      );

      const afterReopen = rows.map(row => row.name);

      assert.deepEqual(afterReopen, original);

    } finally {
      await db.close();
    }
  });
});
