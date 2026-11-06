/**
 * One-time move of an existing SQLite database into an empty MariaDB database, ids kept.
 *   npm run db:copy-sqlite-to-mariadb -- [path/to/scheduler.db]
 * The SQLite file (default DB_PATH) is opened read-only and must be fully migrated: start the
 * app on it once first. The MariaDB database comes from DATABASE_URL (or DB_HOST/DB_PORT/
 * DB_USER/DB_PASSWORD/DB_NAME); the script builds its schema and refuses if it holds data.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { openDb } from './index.js';

// Parents before children, so every foreign key finds its row
const TABLES = ['platform', 'media', 'appUser', 'postType', 'scheduleRule', 'post', 'slot', 'dispatch',
  'testWebhookReceipt', 'blackout', 'appSetting', 'rolePermission', 'auditLog', 'revokedSession',
  'notification']; // notification: after post and platform, which it points at)
TABLES.push('ruleTypeChange'); // per-rule post type changes (after scheduleRule)
// Filled in by the migrations themselves; replaced by the SQLite rows
const MIGRATION_ROWS = new Set(['rolePermission']);
const BATCH = 200;

/**
 * Copies every table of a SQLite database into a new, empty MariaDB database.
 *
 * Usage:
 *   const counts = await copySqliteToMariadb('./data/scheduler.db');   // { platform: 4, post: 120, ... }
 *
 * Takes:
 *   sqlitePath    - the SQLite file
 *   mariadbTarget - optional connection fields for openDb (default: the .env MariaDB settings)
 *
 * Returns:
 *   { table: rows copied } for each table the SQLite file has. Throws when the file is missing,
 *   lacks a migration, has a table not in TABLES, the MariaDB database already has data, or a
 *   count does not match after copying.
 *
 * How it works:
 *   1. Checks the SQLite file has every migration and only known tables.
 *   2. Opens MariaDB with openDb, which builds the schema, and checks it is empty (tables the
 *      migrations fill, MIGRATION_ROWS, aside).
 *   3. In one transaction: empties MIGRATION_ROWS tables, then copies every table in TABLES order,
 *      BATCH rows per INSERT.
 *   4. Checks every table holds exactly what the SQLite one does.
 *
 * When editing:
 *   A new table must be added to TABLES after the tables it points at, or the copy refuses
 *   ("Don't know where these tables go").
 */
export async function copySqliteToMariadb(sqlitePath, mariadbTarget = {}) {
  if (!existsSync(sqlitePath)) throw new Error(`No SQLite database at ${sqlitePath}`);
  const source = new DatabaseSync(sqlitePath, { readOnly: true });
  const migrations = readdirSync(join(dirname(fileURLToPath(import.meta.url)), 'migrations')).filter((f) => f.endsWith('.sql'));
  const applied = new Set(source.prepare('SELECT name FROM schemaMigration').all().map((r) => r.name));
  const missing = migrations.filter((f) => !applied.has(f));
  if (missing.length) {
    source.close();
    throw new Error(`The SQLite database is missing migrations ${missing.join(', ')}; start the app on it once, then copy`);
  }
  const sourceTables = source.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schemaMigration'")
    .all().map((r) => r.name);
  const unknown = sourceTables.filter((t) => !TABLES.includes(t));
  if (unknown.length) {
    source.close();
    throw new Error(`Don't know where these tables go: ${unknown.join(', ')}`);
  }

  const target = await openDb({ client: 'mariadb', ...mariadbTarget });
  const counts = {};
  try {
    for (const table of TABLES) {
      if (MIGRATION_ROWS.has(table)) continue;
      const { n } = await target.get(`SELECT COUNT(*) AS n FROM "${table}"`);
      if (n > 0) throw new Error(`The MariaDB database already has data (${table} has ${n} rows); copy into an empty database`);
    }
    await target.transaction(async (tx) => {
      for (const table of TABLES) {
        if (MIGRATION_ROWS.has(table)) await tx.run(`DELETE FROM "${table}"`);
        if (!sourceTables.includes(table)) continue;
        const rows = source.prepare(`SELECT * FROM "${table}"`).all();
        counts[table] = rows.length;
        if (rows.length === 0) continue;
        const columns = Object.keys(rows[0]);
        const list = columns.map((c) => `"${c}"`).join(', ');
        const placeholders = `(${columns.map(() => '?').join(', ')})`;
        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH);
          await tx.run(`INSERT INTO "${table}" (${list}) VALUES ${batch.map(() => placeholders).join(', ')}`,
            batch.flatMap((row) => columns.map((c) => row[c])));
        }
      }
    });
    // Every table must hold exactly what the SQLite one does
    for (const [table, n] of Object.entries(counts)) {
      const { n: copied } = await target.get(`SELECT COUNT(*) AS n FROM "${table}"`);
      if (copied !== n) throw new Error(`${table}: copied ${copied} of ${n} rows`);
    }
  } finally {
    source.close();
    await target.close();
  }
  return counts;
}

// Run directly (npm run db:copy-sqlite-to-mariadb): copy and print the row counts
if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2] ?? config.dbPath;
  try {
    const counts = await copySqliteToMariadb(path);
    console.log(`Copied ${path} into MariaDB:`);
    for (const [table, n] of Object.entries(counts)) console.log(`  ${table}: ${n}`);
  } catch (err) {
    console.error(`Copy failed: ${err.message}`);
    process.exitCode = 1;
  }
}
