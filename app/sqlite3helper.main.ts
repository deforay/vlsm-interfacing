import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as log from 'electron-log/main';
import * as Store from 'electron-store';

const Database = require('better-sqlite3');
import type { Database as SQLiteDatabase } from 'better-sqlite3';

let sqlitePath: string = null;
let sqliteDbName: string = 'interface.db';
let store: Store = null;
const migrationsDir = path.join(__dirname, 'sqlite-migrations');

function ensureDirectoryExistence(filePath: string) {
  const dirname = path.dirname(filePath);
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, { recursive: true });
  }
}

function getCurrentVersion(db: SQLiteDatabase): number {
  try {
    const row = db.prepare("SELECT version FROM versions ORDER BY version DESC LIMIT 1").get();
    return row?.version || 0;
  } catch (err) {
    return 0;
  }
}

function runMigration(db: SQLiteDatabase, version: number): void {
  const filePath = path.join(migrationsDir, `${String(version).padStart(3, '0')}.sql`);
  const sql = fs.readFileSync(filePath, 'utf8');
  const statements = sql.split(';').map(stmt => stmt.trim()).filter(stmt => stmt.length > 0);

  const insertVersionStmt = db.prepare("INSERT INTO versions (version) VALUES (?)");

  const transaction = db.transaction(() => {
    for (const stmt of statements) {
      try {
        db.prepare(stmt).run();
      } catch (err) {
        if (!String(err.message).includes('duplicate column name')) throw err;
      }
    }
    insertVersionStmt.run(version);
  });

  transaction();
}

function migrate(db: SQLiteDatabase): void {
  db.prepare(`CREATE TABLE IF NOT EXISTS versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version INTEGER NOT NULL,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run();

  const migrations = [
    { version: 1 },
    { version: 2 }
  ];

  const currentVersion = getCurrentVersion(db);
  for (const m of migrations) {
    if (m.version > currentVersion) {
      runMigration(db, m.version);
    }
  }
}

function setupSqlite(storeInstance: Store, callback: (db: SQLiteDatabase, err?: Error) => void): void {
  try {
    if (!storeInstance) {
      throw new Error('storeInstance is null or undefined.');
    }

    sqlitePath = path.join(app.getPath('userData'), sqliteDbName);
    ensureDirectoryExistence(sqlitePath);

    const db: SQLiteDatabase = new Database(sqlitePath);

    // Enable WAL mode
    db.pragma('journal_mode = WAL');

    // Additional recommended pragmas for performance and reliability
    db.pragma('synchronous = NORMAL');  // Good balance between performance and durability
    db.pragma('temp_store = MEMORY');   // Store temporary tables in memory for better performance
    db.pragma('mmap_size = 30000000');  // Allocate 30MB for memory-mapped I/O
    db.pragma('cache_size = 10000');    // Increase cache size for better performance


    storeInstance.set('appPath', sqlitePath);
    storeInstance.set('appVersion', app.getVersion());
    log.info('SQLite database initialized at:', sqlitePath);

    migrate(db);
    callback(db); // Success
  } catch (err) {
    log.error('Failed to set up SQLite:', err);
    callback(null, err); // Failure
  }
}



export { setupSqlite };
