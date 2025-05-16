"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupSqlite = void 0;
const electron_1 = require("electron");
const path = require("path");
const fs = require("fs");
const log = require("electron-log/main");
const sqlite3 = require("@vscode/sqlite3");
let sqlitePath = null;
let sqliteDbName = 'interface.db';
let store = null;
const migrationsDir = path.join(__dirname, 'sqlite-migrations');
function ensureDirectoryExistence(filePath) {
    const dirname = path.dirname(filePath);
    if (!fs.existsSync(dirname)) {
        fs.mkdirSync(dirname, { recursive: true });
    }
}
function getCurrentVersion(db) {
    return new Promise((resolve) => {
        db.get("SELECT version FROM versions ORDER BY version DESC LIMIT 1", (err, row) => {
            if (err) {
                resolve(0);
            }
            else {
                resolve((row === null || row === void 0 ? void 0 : row.version) || 0);
            }
        });
    });
}
function runMigration(db, version) {
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
                    }
                    else {
                        db.run("COMMIT");
                        resolve();
                    }
                });
            }
            catch (err) {
                db.run("ROLLBACK");
                reject(err);
            }
        });
    });
}
function migrate(db) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve, reject) => {
            db.run(`CREATE TABLE IF NOT EXISTS versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => __awaiter(this, void 0, void 0, function* () {
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
                    const currentVersion = yield getCurrentVersion(db);
                    // Run migrations sequentially
                    for (const m of migrations) {
                        if (m.version > currentVersion) {
                            yield runMigration(db, m.version);
                        }
                    }
                    resolve();
                }
                catch (err) {
                    log.error('Error during migrations:', err);
                    reject(err);
                }
            }));
        });
    });
}
function setupSqlite(storeInstance, callback) {
    try {
        if (!storeInstance) {
            throw new Error('storeInstance is null or undefined.');
        }
        sqlitePath = path.join(electron_1.app.getPath('userData'), sqliteDbName);
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
                db.run("PRAGMA synchronous = NORMAL"); // Balance between performance and durability
                db.run("PRAGMA temp_store = MEMORY"); // Store temporary tables in memory
                db.run("PRAGMA cache_size = 10000"); // Increase cache size
                storeInstance.set('appPath', sqlitePath);
                storeInstance.set('appVersion', electron_1.app.getVersion());
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
    }
    catch (err) {
        log.error('Failed to set up SQLite:', err);
        callback(null, err); // Failure
    }
}
exports.setupSqlite = setupSqlite;
//# sourceMappingURL=sqlite3helper.main.js.map