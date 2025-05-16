import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as log from 'electron-log/main';
import * as Store from 'electron-store';
import * as sqlite3 from '@vscode/sqlite3';

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

function getCurrentVersion(db: sqlite3.Database): Promise<number> {
  return new Promise((resolve) => {
    db.get("SELECT version FROM versions ORDER BY version DESC LIMIT 1", (err, row) => {
      if (err) {
        resolve(0);
      } else {
        resolve(row?.version || 0);
      }
    });
  });
}

function runMigration(db: sqlite3.Database, version: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const filePath = path.join(migrationsDir, `${String(version).padStart(3, '0')}.sql`);
    const sql = fs.readFileSync(filePath, 'utf8');
    const statements = sql.split(';').map(stmt => stmt.trim()).filter(stmt => stmt.length > 0);

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");

      try {
        statements.forEach(stmt => {
          if (stmt.length > 0) {
            db.run(stmt, (err) => {
              if (err && !String(err.message).includes('duplicate column name')) {
                log.error(`Error running migration statement: ${stmt}`, err);
                // Continue despite errors
              }
            });
          }
        });

        db.run("INSERT INTO versions (version) VALUES (?)", version, (err) => {
          if (err) {
            log.error(`Error inserting version ${version}:`, err);
            db.run("ROLLBACK");
            reject(err);
          } else {
            db.run("COMMIT");
            resolve();
          }
        });
      } catch (err) {
        db.run("ROLLBACK");
        reject(err);
      }
    });
  });
}

async function migrate(db: sqlite3.Database): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(`CREATE TABLE IF NOT EXISTS versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, async (err) => {
      if (err) {
        log.error('Error creating versions table:', err);
        reject(err);
        return;
      }

      try {
        const migrations = [
          { version: 1 },
          { version: 2 }
        ];

        const currentVersion = await getCurrentVersion(db);

        // Run migrations sequentially
        for (const m of migrations) {
          if (m.version > currentVersion) {
            await runMigration(db, m.version);
          }
        }

        resolve();
      } catch (err) {
        log.error('Error during migrations:', err);
        reject(err);
      }
    });
  });
}

function setupSqlite(storeInstance: Store, callback: (db: sqlite3.Database, err?: Error) => void): void {
  try {
    if (!storeInstance) {
      throw new Error('storeInstance is null or undefined.');
    }

    sqlitePath = path.join(app.getPath('userData'), sqliteDbName);
    ensureDirectoryExistence(sqlitePath);

    // Enable verbose mode for better debugging
    sqlite3.verbose();

    // Create a new database connection
    const db = new sqlite3.Database(sqlitePath, (err) => {
      if (err) {
        log.error('Error opening database:', err);
        callback(null, err);
        return;
      }

      // Set pragmas for performance
      db.serialize(() => {
        // Enable WAL mode
        db.run("PRAGMA journal_mode = WAL");
        db.run("PRAGMA synchronous = NORMAL");  // Balance between performance and durability
        db.run("PRAGMA temp_store = MEMORY");   // Store temporary tables in memory
        db.run("PRAGMA cache_size = 10000");    // Increase cache size

        storeInstance.set('appPath', sqlitePath);
        storeInstance.set('appVersion', app.getVersion());
        log.info('SQLite database initialized at:', sqlitePath);

        // Run migrations
        migrate(db)
          .then(() => {
            log.info('Migrations completed successfully');
            callback(db); // Success
          })
          .catch((migrateErr) => {
            log.error('Failed to run migrations:', migrateErr);
            callback(db, migrateErr); // Still return the db but with the error
          });
      });
    });
  } catch (err) {
    log.error('Failed to set up SQLite:', err);
    callback(null, err); // Failure
  }
}

export { setupSqlite };
