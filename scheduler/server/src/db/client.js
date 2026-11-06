/**
 * One async database interface for the whole server, on SQLite or MariaDB. db/index.js picks
 * one (DB_CLIENT) and every other file only uses these methods:
 *   get(sql, params)  -> first row or undefined
 *   all(sql, params)  -> rows
 *   run(sql, params)  -> { changes, lastInsertRowid }
 *   exec(sql)         -> runs one or more statements, no params
 *   transaction(async (tx) => ...) -> tx has the same methods; commits when fn resolves,
 *                                     rolls back when it throws
 *   dialect           -> 'sqlite' or 'mariadb'
 *   close()
 * Queries are written in SQLite's dialect, kept to what both databases understand.
 * The MariaDB client rewrites the few SQLite-only idioms the app uses (see toMariaDb).
 * Rows come back as plain objects with the column names as stored (camelCase), straight to JSON.
 *
 * What lives here:
 *   sqliteClient, mariadbClient  the two clients
 *   toMariaDb, MARIADB_NOW       the SQLite-to-MariaDB rewrites
 *   mariadbOptions               connection settings from DATABASE_URL or the DB_* fields
 */
import { DatabaseSync } from 'node:sqlite';

const STATEMENT_CACHE = 500;

// ---- SQLite (node:sqlite, synchronous underneath) ----

/**
 * Opens a SQLite file (node:sqlite, synchronous underneath) behind the async interface.
 *
 * Usage:
 *   const db = sqliteClient('./data/scheduler.db');   // or ':memory:'
 *
 * Takes:
 *   path - the database file, or ':memory:'
 *
 * Returns:
 *   { dialect: 'sqlite', get, all, run, exec, transaction, close }. run's numbers are plain JS
 *   numbers.
 *
 * How it works:
 *   Turns on WAL and foreign keys. Prepared statements are cached by SQL text (up to
 *   STATEMENT_CACHE, then the cache starts over). There is one connection, so while a
 *   transaction is open (it awaits between queries) everything else waits for it; otherwise
 *   another request's queries would land inside it. A transaction inside a transaction just runs
 *   in the outer one.
 *
 * When editing:
 *   Keep the waiting (idle) in every method outside a transaction, and only tx inside one: a
 *   query through db inside a transaction waits forever.
 */
export function sqliteClient(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const statements = new Map();
  const prepare = (sql) => {
    let statement = statements.get(sql);
    if (!statement) {
      if (statements.size >= STATEMENT_CACHE) statements.clear();
      statement = db.prepare(sql);
      statements.set(sql, statement);
    }
    return statement;
  };
  const direct = {
    get: async (sql, params = []) => prepare(sql).get(...params),
    all: async (sql, params = []) => prepare(sql).all(...params),
    run: async (sql, params = []) => {
      const { changes, lastInsertRowid } = prepare(sql).run(...params);
      return { changes: Number(changes), lastInsertRowid: Number(lastInsertRowid) };
    },
    exec: async (sql) => { db.exec(sql); },
  };

  // One connection: everything else waits while a transaction is open
  let open = null;
  const idle = async () => {
    while (open) await open;
  };
  const outside = (method) => async (...args) => {
    await idle();
    return direct[method](...args);
  };

  const tx = { ...direct, dialect: 'sqlite', transaction: (fn) => fn(tx) };
  return {
    dialect: 'sqlite',
    get: outside('get'),
    all: outside('all'),
    run: outside('run'),
    exec: outside('exec'),
    async transaction(fn) {
      await idle();
      let release;
      open = new Promise((resolve) => { release = resolve; });
      db.exec('BEGIN');
      try {
        const result = await fn(tx);
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      } finally {
        open = null;
        release();
      }
    },
    async close() {
      await idle();
      db.close();
    },
  };
}

// ---- MariaDB (mariadb connection pool) ----

// SQL mode for every connection: "key" quotes an identifier as in SQLite, || joins strings,
// and strict mode refuses bad values instead of storing something else.
const SQL_MODE = 'ANSI_QUOTES,PIPES_AS_CONCAT,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';
// SQLite's datetime('now'): UTC as "YYYY-MM-DD HH:MM:SS"
export const MARIADB_NOW = "DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')";

const translated = new Map();
/**
 * Rewrites the SQLite-only idioms the app uses in MariaDB's words.
 *
 * Usage:
 *   conn.query(toMariaDb(sql).sql, params)
 *
 * Takes:
 *   sql - a query in SQLite's dialect
 *
 * Returns:
 *   { sql, doNothing }; doNothing marks an insert that may skip a duplicate.
 *
 * How it works:
 *   datetime('now')                                -> UTC_TIMESTAMP() in the same text format
 *   ON CONFLICT (a, b) DO NOTHING                  -> ON DUPLICATE KEY UPDATE a = a (a no-op update)
 *   ON CONFLICT (...) DO UPDATE SET x = excluded.x -> ON DUPLICATE KEY UPDATE x = VALUES(x)
 *   Results are cached by SQL text (up to STATEMENT_CACHE, then the cache starts over).
 *
 * When editing:
 *   A new SQLite-only idiom in any query needs a rewrite here, or that query fails on MariaDB.
 */
export function toMariaDb(sql) {
  let out = translated.get(sql);
  if (out === undefined) {
    let doNothing = false;
    const text = sql
      .replace(/datetime\('now'\)/gi, MARIADB_NOW)
      .replace(/ON CONFLICT\s*\(([^)]*)\)\s*DO NOTHING/gi, (m, cols) => {
        doNothing = true;
        const first = cols.split(',')[0].trim();
        return `ON DUPLICATE KEY UPDATE ${first} = ${first}`;
      })
      .replace(/ON CONFLICT\s*\([^)]*\)\s*DO UPDATE SET/gi, 'ON DUPLICATE KEY UPDATE')
      .replace(/\bexcluded\.("?\w+"?)/gi, 'VALUES($1)');
    out = { sql: text, doNothing };
    if (translated.size >= STATEMENT_CACHE) translated.clear();
    translated.set(sql, out);
  }
  return out;
}

/**
 * Connection settings from DATABASE_URL or the separate DB_* fields.
 *
 * Usage:
 *   mariadbOptions({ url: 'mariadb://user:password@host:3306/name' })
 *
 * Takes:
 *   { url, host, port, user, password, database } - config.db.mariadb; url wins when set
 *
 * Returns:
 *   { host, port, user, password, database }; host defaults to localhost and port to 3306.
 *   User, password and database name are URL-decoded.
 */
export function mariadbOptions({ url, host, port, user, password, database } = {}) {
  if (url) {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: decodeURIComponent(u.pathname.replace(/^\//, '')) || undefined,
    };
  }
  return { host: host ?? 'localhost', port: Number(port ?? 3306), user, password, database };
}

/**
 * Opens a MariaDB connection pool behind the same async interface as sqliteClient.
 *
 * Usage:
 *   const db = await mariadbClient({ url: process.env.DATABASE_URL });
 *
 * Takes:
 *   options - mariadbOptions' fields, plus connectionLimit (default 5)
 *
 * Returns:
 *   { dialect: 'mariadb', get, all, run, exec, transaction, close, pool }
 *
 * How it works:
 *   Every query goes through toMariaDb. The pool is set up to answer like SQLite: numbers come
 *   back as JS numbers (ids, counts, sums), dates as text, UPDATE reports the rows it matched (as
 *   SQLite's changes does), a later column with the same name wins, and every connection uses
 *   SQL_MODE and UTC. NaN parameters are sent as NULL, as SQLite stores them. A skipped duplicate
 *   (ON CONFLICT DO NOTHING) reports 0 changes, as in SQLite. A transaction holds one connection
 *   from the pool until it commits or rolls back.
 *
 * When editing:
 *   The mariadb package is loaded only here, so a SQLite server never needs it.
 */
export async function mariadbClient(options) {
  const { default: mariadb } = await import('mariadb');
  const pool = mariadb.createPool({
    ...mariadbOptions(options),
    connectionLimit: options.connectionLimit ?? 5,
    charset: 'utf8mb4',
    // Numbers come back as JS numbers, like SQLite's (ids, counts, sums)
    bigIntAsNumber: true,
    insertIdAsNumber: true,
    decimalAsNumber: true,
    dateStrings: true,
    // UPDATE reports the rows it matched, as SQLite's changes does
    foundRows: true,
    // A later column with the same name wins, as in SQLite
    checkDuplicate: false,
    multipleStatements: true,
    initSql: [`SET SESSION sql_mode = '${SQL_MODE}'`, "SET SESSION time_zone = '+00:00'"],
  });

  // SQLite stores NaN as NULL; MariaDB would read the bare word NaN as a column name
  const bindable = (params) => params.map((v) => (typeof v === 'number' && Number.isNaN(v) ? null : v));
  const query = (conn, sql, params) => conn.query(toMariaDb(sql).sql, bindable(params));
  const methods = (conn) => ({
    dialect: 'mariadb',
    get: async (sql, params = []) => (await query(conn, sql, params))[0],
    all: async (sql, params = []) => [...(await query(conn, sql, params))],
    run: async (sql, params = []) => {
      const result = await query(conn, sql, params);
      // A skipped duplicate still counts as a found row; SQLite reports no change
      const skipped = toMariaDb(sql).doNothing && !result.insertId;
      return { changes: skipped ? 0 : Number(result.affectedRows), lastInsertRowid: Number(result.insertId) };
    },
    exec: async (sql) => { await conn.query(toMariaDb(sql).sql); },
  });

  return {
    ...methods(pool),
    pool,
      async transaction(fn) {
      const conn = await pool.getConnection();
      const tx = methods(conn);
      tx.transaction = (inner) => inner(tx);
      try {
        await conn.beginTransaction();
        const result = await fn(tx);
        await conn.commit();
        return result;
      } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
      } finally {
        conn.release();
      }
    },
    close: () => pool.end(),
  };
}
