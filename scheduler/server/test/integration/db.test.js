
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

// Create a separate temporary database location.
function withTemporaryDatabase(callback) {
  const directory = mkdtempSync(
    join(tmpdir(), 'ctr-db-test-')
  );

  const dbPath = join(directory, 'test.sqlite');

  try {
    callback(dbPath);
  } finally {
    rmSync(directory, {
      recursive: true,
      force: true,
    });
  }
}

// TC-069: Initialize database
test('TC-069: Initialize SQLite database', () => {
  const db = openDb(':memory:');

  try {
    const result = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
      AND name = 'schemaMigration'
    `).get();

    assert.equal(result.name, 'schemaMigration');
  } finally {
    db.close();
  }
});

// TC-070: Verify database migrations
test('TC-070: Apply database migrations', () => {
  const db = openDb(':memory:');

  try {
    const expected = readdirSync(
      new URL('../../src/db/migrations/', import.meta.url)
    )
      .filter(name => name.endsWith('.sql'))
      .sort();

    const actual = db.prepare(`
      SELECT name
      FROM schemaMigration
      ORDER BY name
    `).all().map(row => row.name);

    assert.ok(expected.length > 0);
    assert.deepEqual(actual, expected);
  } finally {
    db.close();
  }
});

// TC-071: Verify foreign key enforcement
test('TC-071: Enforce foreign key constraints', () => {
  const db = openDb(':memory:');

  try {
    const settings = db.prepare(
      'PRAGMA foreign_keys'
    ).get();

    assert.equal(settings.foreign_keys, 1);

    // Create isolated tables for testing.
    db.exec(`
      CREATE TABLE testParent (
        id INTEGER PRIMARY KEY
      );

      CREATE TABLE testChild (
        id INTEGER PRIMARY KEY,
        parentId INTEGER REFERENCES testParent(id)
      );
    `);

    assert.throws(() => {
      db.prepare(
        'INSERT INTO testChild (id, parentId) VALUES (?, ?)'
      ).run(1, 999);
    }, /FOREIGN KEY constraint failed/);

  } finally {
    db.close();
  }
});


 // TC-072: Verify database persistence
test('TC-072: Persist records after reopening', () => {
  withTemporaryDatabase(dbPath => {
    let db = openDb(dbPath);

    try {
      db.exec(`
        CREATE TABLE testRecord (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL
        )
      `);

      db.prepare(
        'INSERT INTO testRecord (id, name) VALUES (?, ?)'
      ).run(1, 'CTR Test Record');
    } finally {
      db.close();
    }

    db = openDb(dbPath);

    try {
      const record = db.prepare(
        'SELECT * FROM testRecord WHERE id = ?'
      ).get(1);

      assert.equal(record.id, 1);
      assert.equal(record.name, 'CTR Test Record');

    } finally {
      db.close();
    }
  });
});


// TC-073: Prevent duplicate migrations
test('TC-073: Avoid duplicate migrations', () => {
  withTemporaryDatabase(dbPath => {
    let db = openDb(dbPath);
    let original;

    try {
      original = db.prepare(
        'SELECT name FROM schemaMigration ORDER BY name'
      ).all();
    } finally {
      db.close();
    }

    db = openDb(dbPath);

    try {
      const afterReopen = db.prepare(
        'SELECT name FROM schemaMigration ORDER BY name'
      ).all();

      assert.deepEqual(afterReopen, original);
    } finally {
      db.close();
    }
  });
});
