/**
 * Opens the database (SQLite or MariaDB, see client.js) and runs the migrations it has not had yet.
 *
 * What lives here:
 *   openDb   opens a database and brings its schema up to date
 *   migrate  applies the migration files in name order, once each
 */
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { mariadbClient, sqliteClient } from './client.js';

// SQLite migrations sit in migrations/, their MariaDB twins (same names) in migrations/mariadb/
const migrationsRoot = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const migrationsDir = (dialect) => (dialect === 'mariadb' ? join(migrationsRoot, 'mariadb') : migrationsRoot);

/**
 * Opens the database the config points at and brings its schema up to date.
 *
 * Usage:
 *   const db = await openDb();                            // DB_CLIENT from .env (config.db)
 *   const db = await openDb(':memory:');                  // or openDb('/path/file.db'): that SQLite file
 *   const db = await openDb({ client: 'mariadb', url });  // a MariaDB database
 *
 * Takes:
 *   target - nothing, a SQLite path, or { client, path, url, host, port, user, password, database }
 *
 * Returns:
 *   The client from client.js. Throws for an unknown client; a failed migration closes the
 *   database and throws.
 *
 * How it works:
 *   Makes the SQLite file's folder when needed, opens the client, then runs migrate.
 */
export async function openDb(target = {}) {
  const options = typeof target === 'string' ? { client: 'sqlite', path: target } : target;
  const client = options.client ?? config.db.client;
  let db;
  if (client === 'mariadb') {
    db = await mariadbClient({ ...config.db.mariadb, ...options });
  } else if (client === 'sqlite') {
    const path = options.path ?? config.dbPath;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    db = sqliteClient(path);
  } else {
    throw new Error(`DB_CLIENT must be "sqlite" or "mariadb", not "${client}"`);
  }
  try {
    await migrate(db);
  } catch (err) {
    await db.close();
    throw err;
  }
  return db;
}

/**
 * Applies every migration file not yet listed in schemaMigration, in file-name order, each in
 * its own transaction, and records it there.
 *
 * Usage:
 *   await migrate(db);   (openDb only)
 *
 * When editing:
 *   A new migration needs BOTH migrations/NNN_name.sql and migrations/mariadb/NNN_name.sql with
 *   the same name. Never change a file that has already run anywhere: add a new one. MariaDB
 *   commits each CREATE/ALTER on its own, so there a failed migration can leave part of its
 *   changes behind; SQLite rolls the whole file back.
 */
async function migrate(db) {
  const mariadb = db.dialect === 'mariadb';
  await db.exec(mariadb
    ? 'CREATE TABLE IF NOT EXISTS schemaMigration (name VARCHAR(255) NOT NULL PRIMARY KEY, appliedAt VARCHAR(32) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin'
    : 'CREATE TABLE IF NOT EXISTS schemaMigration (name TEXT PRIMARY KEY, appliedAt TEXT NOT NULL)');
  const applied = new Set((await db.all('SELECT name FROM schemaMigration')).map((r) => r.name));
  const dir = migrationsDir(db.dialect);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue;
    // Only all-or-nothing on SQLite (see above)
    await db.transaction(async (tx) => {
      await tx.exec(readFileSync(join(dir, file), 'utf8'));
      await tx.run("INSERT INTO schemaMigration VALUES (?, datetime('now'))", [file]);
    });
  }
}
