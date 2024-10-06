"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupSqlite = void 0;
const electron_1 = require("electron");
const path = require("path");
const fs = require("fs");
const sqlite3_1 = require("sqlite3");
const log = require("electron-log/main");
let sqlitePath = null;
let sqliteDbName = 'interface.db';
let store = null;
const migrationsDir = path.join(__dirname, 'sqlite-migrations');
function ensureDirectoryExistence(filePath) {
    const dirname = path.dirname(filePath);
    if (fs.existsSync(dirname)) {
        return true;
    }
    fs.mkdirSync(dirname, { recursive: true });
}
function initializeDatabase(callback) {
    sqlitePath = path.join(electron_1.app.getPath('userData'), sqliteDbName);
    // Ensure the directory exists
    ensureDirectoryExistence(sqlitePath);
    const database = new sqlite3_1.Database(sqlitePath, (err) => {
        if (err) {
            store.set('appPath', JSON.stringify(err));
            log.error('Database opening error: ', err);
            callback(database, err);
        }
        else {
            log.info('SQLite database initialized at:', sqlitePath);
            callback(database);
        }
    });
}
function getCurrentVersion(db, callback) {
    db.get("SELECT version FROM versions ORDER BY version DESC LIMIT 1", (err, row) => {
        if (err) {
            callback(0);
        }
        else {
            callback(row ? row.version : 0);
        }
    });
}
function runMigration(db, version, callback) {
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
function migrate(db, callback) {
    db.run(`CREATE TABLE IF NOT EXISTS versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version INTEGER NOT NULL,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`, (err) => {
        if (err)
            return callback(err);
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
                            if (err)
                                return callback(err);
                            migrationIndex++;
                            runNextMigration();
                        });
                    }
                    else {
                        migrationIndex++;
                        runNextMigration();
                    }
                }
                else {
                    callback();
                }
            };
            runNextMigration();
        });
    });
}
function setupSqlite(storeInstance, callback) {
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
exports.setupSqlite = setupSqlite;
//# sourceMappingURL=sqlite3helper.main.js.map