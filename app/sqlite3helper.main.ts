import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { Database } from 'sqlite3';
import * as log from 'electron-log/main';
import * as Store from 'electron-store';

let sqlitePath: string = null;
let sqliteDbName: string = 'interface.db';
let store: Store = null;
const migrationsDir = path.join(__dirname, 'sqlite-migrations');

interface VersionRow {
  version: number;
}

function ensureDirectoryExistence(filePath: string) {
  const dirname = path.dirname(filePath);
  if (fs.existsSync(dirname)) {
    return true;
  }
  fs.mkdirSync(dirname, { recursive: true });
}

function initializeDatabase(callback: (db: Database, err?: Error) => void): void {
  sqlitePath = path.join(app.getPath('userData'), sqliteDbName);

  // Ensure the directory exists
  ensureDirectoryExistence(sqlitePath);

  const database = new Database(sqlitePath, (err) => {
    if (err) {
      store.set('appPath', JSON.stringify(err));
      log.error('Database opening error: ', err);
      callback(database, err);
    } else {
      log.info('SQLite database initialized at:', sqlitePath);
      callback(database);
    }
  });
}

function getCurrentVersion(db: Database, callback: (version: number) => void): void {
  db.get<VersionRow>("SELECT version FROM versions ORDER BY version DESC LIMIT 1", (err, row) => {
    if (err) {
      callback(0);
    } else {
      callback(row ? row.version : 0);
    }
  });
}

function runMigration(db: Database, version: number, callback: (err?: Error) => void): void {
  const filePath = path.join(migrationsDir, `${String(version).padStart(3, '0')}.sql`);
  const sql = fs.readFileSync(filePath, 'utf8');
  const statements = sql.split(';').map(stmt => stmt.trim()).filter(stmt => stmt.length > 0);

  db.serialize(() => {
    statements.forEach((statement, index) => {
      db.run(statement, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          callback(err);
          return;
        }
        if (index === statements.length - 1) {
          db.run("INSERT INTO versions (version) VALUES (?)", [version], (err) => {
            callback(err);
          });
        }
      });
    });
  });
}

function migrate(db: Database, callback: (err?: Error) => void): void {
  db.run('CREATE TABLE IF NOT EXISTS versions ( \
    id INTEGER PRIMARY KEY AUTOINCREMENT, \
    version INTEGER NOT NULL, \
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP \
  );', (err) => {
    if (err) return callback(err);

    getCurrentVersion(db, (currentVersion) => {
      const migrations = [
        { version: 1 }, // Add new migrations here as { version: <number> }
        { version: 2 }
      ];

      let migrationIndex = 0;
      const runNextMigration = () => {
        if (migrationIndex < migrations.length) {
          const migration = migrations[migrationIndex];
          if (migration.version > currentVersion) {
            runMigration(db, migration.version, (err) => {
              if (err) return callback(err);
              migrationIndex++;
              runNextMigration();
            });
          } else {
            migrationIndex++;
            runNextMigration();
          }
        } else {
          callback();
        }
      };

      runNextMigration();
    });
  });
}

function setupSqlite(storeInstance: Store, callback: (db: Database, err?: Error) => void): void {
  store = storeInstance;
  initializeDatabase((db, err) => {
    if (err) {
      callback(db, err);
      return;
    }
    migrate(db, (err) => {
      callback(db, err);
    });
  });
}

export { setupSqlite };
