import { app, BrowserWindow, screen, ipcMain, dialog, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as mysql from 'mysql2';
import * as sqlite3 from '@vscode/sqlite3';

import * as log from 'electron-log/main';
import { setupSqlite } from './sqlite3helper.main';

const Store = require('electron-store');
let win: BrowserWindow = null;
let store = new Store();
let sqlite3Obj: sqlite3.Database = null;
let sqliteDbName: string = 'interface.db';
const args = process.argv.slice(1),
  serve = args.some(val => val === '--serve');
let tray: Tray = null;

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function registerProcessErrorLogging(): void {
  process.on('uncaughtException', (error) => {
    log.error(`[Main][UncaughtException] ${formatUnknownError(error)}`);
  });

  process.on('unhandledRejection', (reason) => {
    log.error(`[Main][UnhandledRejection] ${formatUnknownError(reason)}`);
  });
}

function getSQLiteDBConnection() {
  return sqlite3Obj;
}

function restartApp() {
  app.relaunch();
  app.exit();
}

// Idempotent SQLite errors that we can safely ignore when re-applying a migration
// against a partially-applied schema (e.g. ALTER TABLE ADD COLUMN on a column that
// already exists). Anything outside this set is treated as a real failure.
const SQLITE_REPLAY_ERROR_FRAGMENTS = [
  'duplicate column name',
  'already exists',
  'no such index'
];

function isExpectedSqliteReplayError(err: Error | null): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return SQLITE_REPLAY_ERROR_FRAGMENTS.some(fragment => msg.includes(fragment));
}

// The core tables every healthy install must have. If any are missing while the
// versions table claims migrations have been applied, the bookkeeping is stale and
// we purge it so the runner re-applies the migrations from scratch.
const SQLITE_CORE_TABLES = ['orders', 'raw_data', 'app_log'];

function sqliteRun(db: sqlite3.Database, sql: string, params: any[] = []): Promise<{ ok: boolean; err: Error | null }> {
  return new Promise((resolve) => {
    db.run(sql, params, function (err: Error | null) {
      resolve({ ok: !err, err });
    });
  });
}

function sqliteAll<T = any>(db: sqlite3.Database, sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve) => {
    db.all(sql, params, (err: Error | null, rows: T[]) => {
      resolve(err || !Array.isArray(rows) ? [] : rows);
    });
  });
}

async function runSqliteMigrations(db, migrationsPath) {
  console.log('Running SQLite migrations from:', migrationsPath);

  // 1. Ensure versions table exists
  await sqliteRun(db, 'CREATE TABLE IF NOT EXISTS versions (version INTEGER PRIMARY KEY, filename TEXT, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)');

  // 2. Add filename column for backward compatibility (idempotent — old DBs may pre-date this column)
  await sqliteRun(db, 'ALTER TABLE versions ADD COLUMN filename TEXT');

  // 3. Get migration files
  if (!fs.existsSync(migrationsPath)) {
    log.error(`SQLite migration directory not found: ${migrationsPath}`);
    return;
  }

  const migrationFiles = fs.readdirSync(migrationsPath)
    .filter(file => file.endsWith('.sql'))
    .sort();

  if (migrationFiles.length === 0) {
    log.warn('No SQLite migration files found');
    return;
  }

  // 4. Self-heal stale bookkeeping. If the versions table claims migrations are
  //    applied but the core tables don't actually exist, the prior runner recorded
  //    a "success" after silently swallowing statement errors. Purge those rows so
  //    the migrations re-run instead of being skipped forever.
  const presentTables = new Set(
    (await sqliteAll<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type='table'"))
      .map(row => row.name)
  );
  const missingCoreTables = SQLITE_CORE_TABLES.filter(name => !presentTables.has(name));
  if (missingCoreTables.length > 0) {
    log.warn(`SQLite core tables missing (${missingCoreTables.join(', ')}); purging stale versions rows so migrations re-run`);
    const purge = await sqliteRun(db, 'DELETE FROM versions');
    if (!purge.ok) {
      log.error(`Failed to purge stale versions rows: ${purge.err?.message}`);
    }
  }

  // 5. Get applied migrations (return empty set on error)
  const appliedFilenames = new Set(
    (await sqliteAll<{ filename: string }>(db, 'SELECT filename FROM versions WHERE filename IS NOT NULL'))
      .map(row => row.filename)
  );

  // 6. Run migrations. Real per-statement failures stop that migration and leave
  //    its versions row absent so the next launch retries — never record a
  //    migration as applied when its statements actually failed.
  let successCount = 0;
  for (const file of migrationFiles) {
    if (appliedFilenames.has(file)) {
      continue;
    }

    console.log(`Applying SQLite migration: ${file}`);
    const filePath = path.join(migrationsPath, file);
    const sql = fs.readFileSync(filePath, 'utf8');

    const statements = sql.split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    let migrationFailed = false;
    for (const statement of statements) {
      const { ok, err } = await sqliteRun(db, statement);
      if (ok) continue;

      if (isExpectedSqliteReplayError(err)) {
        console.log(`SQLite migration ${file} replay note: ${err?.message}`);
        continue;
      }

      log.error(`SQLite migration ${file} failed: ${err?.message}\nStatement: ${statement}`);
      migrationFailed = true;
      break;
    }

    if (migrationFailed) {
      log.error(`SQLite migration ${file} did NOT complete cleanly; leaving versions row absent so next launch retries`);
      continue;
    }

    const version = parseInt(file.split('.')[0], 10);
    const insert = await sqliteRun(db, 'INSERT OR IGNORE INTO versions (version, filename) VALUES (?, ?)', [version, file]);
    if (!insert.ok) {
      log.error(`Failed to record SQLite migration ${file} as applied: ${insert.err?.message}`);
      continue;
    }

    console.log(`✅ SQLite migration ${file} completed (${statements.length} statements)`);
    successCount++;
  }

  console.log(`SQLite migrations: ${successCount} processed`);
}


function createUniversalMySQLConfig(baseConfig: any) {
  return {
    ...baseConfig,
    // Connection settings (valid for both pools and connections)
    ssl: false,                    // Disable SSL to avoid cert issues
    insecureAuth: true,           // Allow insecure auth for older versions
    supportBigNumbers: true,      // Handle large numbers properly
    bigNumberStrings: true,       // Return big numbers as strings

    // Connection-specific timeout (valid for connections)
    connectTimeout: 10000,        // 10 seconds to connect

    // Date handling (consistent across versions)
    dateStrings: ['DATE', 'DATETIME', 'TIMESTAMP'],

    // Character set (important for MySQL 5.x compatibility)
    charset: 'utf8mb4',

    // SQL mode handling (MySQL 5.x vs 8.x differences)
    typeCast: function (field: any, next: any) {
      // Handle different data types consistently
      if (field.type === 'BIT' && field.length === 1) {
        return field.buffer()[0] === 1;
      }
      return next();
    }
  };
}

function createUniversalMySQLPoolConfig(baseConfig: any) {
  return {
    ...createUniversalMySQLConfig(baseConfig),
    // Pool-specific settings
    // acquireTimeout: 10000,        // 10 seconds to get connection from pool
    // timeout: 600,                 // Query timeout (pool-specific)
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 0
  };
}


// Daily on-disk backup of interface.db with 7-day rotation. Runs at startup
// before the SQLite connection is opened so the snapshot is guaranteed
// consistent (no WAL/checkpoint races). The cost — a few hundred KB of disk
// per client per day — buys recovery from accidental deletion, AV quarantine,
// or anything else that wipes the live DB without warning.
async function backupSqliteDb(): Promise<void> {
  try {
    const dbPath = path.join(app.getPath('userData'), sqliteDbName);
    if (!fs.existsSync(dbPath)) {
      // Nothing to back up — fresh install or post-deletion launch.
      return;
    }
    const stat = await fs.promises.stat(dbPath);
    if (stat.size === 0) {
      return; // empty stub, nothing worth saving
    }

    const backupDir = path.join(app.getPath('userData'), 'backups');
    await fs.promises.mkdir(backupDir, { recursive: true });

    const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const target = path.join(backupDir, `${sqliteDbName}.${stamp}.bak`);
    if (!fs.existsSync(target)) {
      await fs.promises.copyFile(dbPath, target);
      log.info(`SQLite backup written: ${target}`);
    }

    // Rotate — keep only the most recent 7 daily backups
    const backups = (await fs.promises.readdir(backupDir))
      .filter(name => name.startsWith(`${sqliteDbName}.`) && name.endsWith('.bak'))
      .sort();
    while (backups.length > 7) {
      const oldest = backups.shift();
      if (oldest) {
        await fs.promises.unlink(path.join(backupDir, oldest));
        log.info(`Pruned old SQLite backup: ${oldest}`);
      }
    }
  } catch (err) {
    // Backup is best-effort — never block startup if it fails
    log.error(`SQLite backup failed: ${formatUnknownError(err)}`);
  }
}


async function copySqliteMigrationFiles(): Promise<void> {
  const sourceDir = path.join(__dirname, 'sqlite-migrations');
  const targetDir = path.join(app.getPath('userData'), 'sqlite-migrations');

  try {
    if (!fs.existsSync(sourceDir)) {
      log.error(`SQLite migration source directory not found: ${sourceDir}`);
      return;
    }

    if (!fs.existsSync(targetDir)) {
      await fs.promises.mkdir(targetDir, { recursive: true });
    }

    const files = await fs.promises.readdir(sourceDir);
    for (const file of files) {
      const sourceFile = path.join(sourceDir, file);
      const targetFile = path.join(targetDir, file);

      // Always overwrite to prevent stale migration scripts in userData.
      await fs.promises.copyFile(sourceFile, targetFile);
      console.log(`Synced SQLite migration file: ${file}`);
    }
  } catch (err) {
    log.error(`Error copying SQLite migration files: ${formatUnknownError(err)}`);
  }
}


async function copyMySQLMigrationFiles(): Promise<void> {
  const sourceDir = path.join(__dirname, 'mysql-migrations');
  const targetDir = path.join(app.getPath('userData'), 'mysql-migrations');

  try {
    if (!fs.existsSync(sourceDir)) {
      log.error(`MySQL migration source directory not found: ${sourceDir}`);
      return;
    }

    if (!fs.existsSync(targetDir)) {
      await fs.promises.mkdir(targetDir, { recursive: true });
    }

    const files = await fs.promises.readdir(sourceDir);
    for (const file of files) {
      const sourceFile = path.join(sourceDir, file);
      const targetFile = path.join(targetDir, file);

      // Always overwrite to prevent stale migration scripts in userData.
      await fs.promises.copyFile(sourceFile, targetFile);
      console.log(`Synced MySQL migration file: ${file}`);
    }
  } catch (err) {
    log.error(`Error copying MySQL migration files: ${formatUnknownError(err)}`);
  }
}


function createWindow(): BrowserWindow {
  const electronScreen = screen;
  const size = electronScreen.getPrimaryDisplay().workAreaSize;

  log.initialize();
  log.transports.file.level = 'info';
  log.transports.console.level = 'info';

  const today = new Date();
  const dateString = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
  log.transports.file.fileName = `${dateString}.log`;

  Store.initRenderer();
  store = new Store();

  store.set('appPath', path.join(app.getPath('userData'), '/', sqliteDbName));
  store.set('appVersion', app.getVersion());

  win = new BrowserWindow({
    x: 0,
    y: 0,
    fullscreenable: true,
    width: size.width,
    height: size.height,
    webPreferences: {
      nodeIntegration: true,
      allowRunningInsecureContent: serve,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });

  if (serve) {
    import('electron-debug').then(debug => {
      debug.default({ isEnabled: true, showDevTools: true });
    });

    import('electron-reloader').then(reloader => {
      const reloaderFn = (reloader as any).default || reloader;
      reloaderFn(module, { watchRenderer: false });
    });
    win.loadURL('http://localhost:4200');
  } else {
    let pathIndex = './browser/index.html';

    if (fs.existsSync(path.join(__dirname, '../dist/browser/index.html'))) {
      pathIndex = '../dist/browser/index.html';
    }

    const fullPath = path.join(__dirname, pathIndex);
    const url = `file://${path.resolve(fullPath).replace(/\\/g, '/')}`;
    win.loadURL(url);
  }

  win.on('closed', () => {
    win = null;
  });

  return win;
}

function openModal() {
  const modal = new BrowserWindow({ parent: win, modal: true, show: false });
  modal.loadURL('');
  modal.once('ready-to-show', () => {
    modal.show();
  });
}

ipcMain.on('openModal', (event, arg) => {
  openModal();
});

registerProcessErrorLogging();


try {
  const gotTheLock = app.requestSingleInstanceLock();

  if (!gotTheLock) {
    app.quit();
  } else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    });
  }

  const mysqlPools: Record<string, any> = {}; // simple in-memory cache of pools

  function registerIpcHandlers() {
    ipcMain.handle('export-settings', async (event, settingsJSON) => {
      try {
        const today = new Date();
        const timestamp = `${today.getFullYear()}${(today.getMonth() + 1).toString().padStart(2, '0')}${today.getDate().toString().padStart(2, '0')}-${today.getHours().toString().padStart(2, '0')}${today.getMinutes().toString().padStart(2, '0')}`;
        const defaultPath = `interface-settings-${timestamp}.json`;

        const { filePath, canceled } = await dialog.showSaveDialog({
          title: 'Export Settings',
          defaultPath: defaultPath,
          filters: [{ name: 'JSON Files', extensions: ['json'] }]
        });

        if (canceled) {
          return { status: 'cancelled', message: 'Export cancelled.' };
        } else {
          fs.writeFileSync(filePath, settingsJSON, 'utf8');
          return { status: 'success', message: 'Settings successfully exported.' };
        }
      } catch (err) {
        log.error(`Failed to save settings: ${formatUnknownError(err)}`);
        return { status: 'error', message: 'Failed to export settings.' };
      }
    });

    ipcMain.handle('getUserDataPath', () => {
      return app.getPath('userData');
    });

    ipcMain.handle('mysql-create-pool', (event, config) => {
      const key = JSON.stringify(config);
      if (!mysqlPools[key]) {
        const universalConfig = createUniversalMySQLPoolConfig(config);
        try {
          mysqlPools[key] = mysql.createPool(universalConfig);
          mysqlPools[key].on('connection', (connection: any) => {
            console.log('MySQL connection established');
            const compatibilityQueries = [
              "SET SESSION sql_mode=(SELECT REPLACE(@@sql_mode, 'ONLY_FULL_GROUP_BY', ''))",
              "SET SESSION INTERACTIVE_TIMEOUT=600",
              "SET SESSION WAIT_TIMEOUT=600"
            ];
            compatibilityQueries.forEach(query => {
              connection.query(query, (err: any) => {
                if (err) {
                  console.warn(`Non-critical SQL mode warning: ${err.message}`);
                }
              });
            });
          });
          mysqlPools[key].on('error', (err: any) => {
            console.error('MySQL pool error:', err.message);
          });
        } catch (error) {
          console.error('Error creating MySQL pool:', error);
          throw error;
        }
      }
      return { status: 'ok' };
    });

    ipcMain.handle('mysql-query', (event, config, query: string, values?: any[]) => {
      const key = JSON.stringify(config);
      if (!mysqlPools[key]) {
        const universalConfig = createUniversalMySQLPoolConfig(config);
        mysqlPools[key] = mysql.createPool(universalConfig);
      }
      return new Promise((resolve, reject) => {
        mysqlPools[key].query(query, values ?? [], (err: any, results: any) => {
          if (err) {
            const errorInfo = {
              message: err.message,
              code: err.code,
              errno: err.errno,
              sqlState: err.sqlState,
              sqlMessage: err.sqlMessage,
              fatal: err.fatal
            };
            if (err.code === 'ER_NOT_SUPPORTED_AUTH_MODE') {
              console.error('MySQL Authentication Error - Try updating user auth method:', errorInfo);
            } else if (err.code === 'ECONNREFUSED') {
              console.error('MySQL Connection Refused - Check if MySQL is running:', errorInfo);
            } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
              console.error('MySQL Access Denied - Check credentials:', errorInfo);
            } else {
              console.error('MySQL Error:', errorInfo);
            }
            reject(err);
          } else {
            resolve(results);
          }
        });
      });
    });

    ipcMain.handle('mysql-test-connection', (event, config) => {
      return new Promise((resolve, reject) => {
        const universalConfig = createUniversalMySQLConfig(config);
        const testConnection = mysql.createConnection(universalConfig);
        testConnection.connect((err: any) => {
          if (err) {
            testConnection.destroy();
            reject({ success: false, error: err.message, code: err.code, version: 'unknown' });
          } else {
            testConnection.query('SELECT VERSION() as version', (versionErr: any, results: any) => {
              const version = results && results[0] ? results[0].version : 'unknown';
              testConnection.destroy();
              if (versionErr) {
                reject({ success: false, error: versionErr.message, version: version });
              } else {
                resolve({ success: true, message: 'Connection successful', version: version });
              }
            });
          }
        });
        setTimeout(() => {
          testConnection.destroy();
          reject({ success: false, error: 'Connection test timeout', code: 'TIMEOUT' });
        }, 15000);
      });
    });

    ipcMain.handle('import-settings', async (event) => {
      try {
        const { filePaths, canceled } = await dialog.showOpenDialog({
          title: 'Import Settings',
          filters: [{ name: 'JSON Files', extensions: ['json'] }],
          properties: ['openFile']
        });
        if (canceled || !filePaths || filePaths.length === 0) {
          return { status: 'cancelled', message: 'Import cancelled.' };
        }
        const filePath = filePaths[0];
        const data = fs.readFileSync(filePath, 'utf-8');
        const importedSettings = JSON.parse(data);
        win.webContents.send('imported-settings', importedSettings);
        for (const key in importedSettings) {
          if (importedSettings.hasOwnProperty(key)) {
            store.set(key, importedSettings[key]);
          }
        }
        return { status: 'success', message: 'Settings successfully imported.' };
      } catch (err) {
        console.error('Failed to import settings:', err);
        return { status: 'error', message: 'Failed to import settings.' };
      }
    });

    ipcMain.handle('dialog', (event, method, params) => {
      return dialog[method](params);
    });

    ipcMain.on('sqlite3-query', (event, sql: string, params: any, replyChannel: string) => {
      const respond = (payload: any) => {
        if (replyChannel) {
          event.sender.send(replyChannel, payload);
        }
      };

      if (!replyChannel) {
        log.error('sqlite3-query invoked without reply channel');
        return;
      }

      if (!sqlite3Obj) {
        respond({ __sqliteError: true, message: 'SQLite database not initialized' });
        return;
      }

      const statementType = typeof sql === 'string'
        ? sql.trim().split(/\s+/)[0]?.toLowerCase()
        : '';
      const isSelectStatement = ['select', 'pragma', 'with', 'show'].includes(statementType);
      const safeParams = params ?? [];

      const handleError = (err: any) => {
        log.error(`SQLite query error: ${err?.message || err}`);
        respond({
          __sqliteError: true,
          message: err?.message || 'Unknown SQLite error'
        });
      };

      try {
        if (isSelectStatement) {
          sqlite3Obj.all(sql, safeParams, (err, rows) => {
            if (err) {
              handleError(err);
            } else {
              respond(rows ?? []);
            }
          });
        } else {
          sqlite3Obj.run(sql, safeParams, function runCallback(err) {
            if (err) {
              handleError(err);
            } else {
              respond({
                changes: this.changes,
                lastID: this.lastID
              });
            }
          });
        }
      } catch (err) {
        handleError(err);
      }
    });

    ipcMain.handle('log-info', (event, message: string, instrumentId: string | null = null) => {
      let scopedLogger = log.scope('app');
      if (instrumentId) {
        scopedLogger = log.scope(instrumentId);
      }
      scopedLogger.info(message);
    });

    ipcMain.handle('log-warning', (event, message: string, instrumentId: string | null = null) => {
      let scopedLogger = log.scope('app');
      if (instrumentId) {
        scopedLogger = log.scope(instrumentId);
      }
      scopedLogger.warn(message);
    });

    ipcMain.handle('log-error', (event, message: string, instrumentId: string | null = null) => {
      let scopedLogger = log.scope('app');
      if (instrumentId) {
        scopedLogger = log.scope(instrumentId);
      }
      scopedLogger.error(message);
    });

    ipcMain.handle('sqlite3-wal-checkpoint', () => {
      return new Promise((resolve, reject) => {
        if (!sqlite3Obj) {
          reject(new Error('SQLite database not initialized'));
          return;
        }

        sqlite3Obj.run('PRAGMA wal_checkpoint(PASSIVE)', function (err) {
          if (err) {
            log.error(`Error running SQLite WAL checkpoint: ${err.message || err}`);
            reject(err);
          } else {
            resolve({ success: true });
          }
        });
      });
    });

    ipcMain.handle('force-rerun-migrations', async () => {
      const db = getSQLiteDBConnection();
      if (db) {
        // DELETE instead of DROP - cleaner, keeps table structure
        await new Promise<void>((resolve) => {
          db.run('DELETE FROM versions', () => resolve());
        });
      }

      // Ensure userData migrations are in sync before restart/replay.
      await copySqliteMigrationFiles();
      await copyMySQLMigrationFiles();

      setTimeout(() => restartApp(), 500);
      return { success: true };
    });

    ipcMain.handle('show-confirm-dialog', async (event, options) => {
      const focusedWindow = BrowserWindow.getFocusedWindow();
      if (focusedWindow) {
        return dialog.showMessageBox(focusedWindow, options);
      }
      return dialog.showMessageBox(null, options);
    });
  }

  app.on('ready', async () => {
    try {
      // Snapshot the existing SQLite file BEFORE opening it. Doing this here
      // (rather than after) means the file is closed by every other process,
      // so the copy can't race with an in-flight write or a WAL checkpoint.
      await backupSqliteDb();

      // First, set up the SQLite database connection
      sqlite3Obj = await new Promise<sqlite3.Database>((resolve, reject) => {
        setupSqlite(store, (db, err) => {
          if (err) {
            log.error(`Error during SQLite setup: ${formatUnknownError(err)}`);
            return reject(err);
          }
          console.info('SQLite setup complete');
          resolve(db);
        });
      });

      // Then, copy and run the migrations
      const migrationsPath = path.join(app.getPath('userData'), 'sqlite-migrations');
      await copySqliteMigrationFiles();
      await copyMySQLMigrationFiles();
      await runSqliteMigrations(sqlite3Obj, migrationsPath);

      // IMPORTANT: Register all IPC handlers BEFORE creating the window
      registerIpcHandlers();

      // Now that the database and IPC are ready, create the main window
      createWindow();

      // Log app startup to both console and file
      const startupTime = new Date().toISOString();
      console.log(`\n${'='.repeat(80)}\n🚀 APPLICATION STARTED - ${startupTime}\n${'='.repeat(80)}\n`);

      let trayIconPath = path.join(__dirname, './browser/assets/icons/favicon.png');
      if (fs.existsSync(path.join(__dirname, '../dist/browser/assets/icons/favicon.png'))) {
        trayIconPath = path.join(__dirname, '../dist/browser/assets/icons/favicon.png');
      }
      try {
        const icon = nativeImage.createFromPath(trayIconPath);
        tray = new Tray(icon);
        const contextMenu = Menu.buildFromTemplate([
          { label: 'Show', click: () => { win.show(); } },
          { label: 'Minimize', click: () => { win.minimize(); } },
          { label: 'Quit', click: () => { app.quit(); } },
        ]);
        tray.setToolTip('Interface Tool');
        tray.setContextMenu(contextMenu);

        tray.on('click', () => {
          if (win) {
            if (win.isMinimized()) win.restore();
            if (!win.isVisible()) win.show();
            win.focus();
          }
        });

        console.log('Tray icon setup successful.');
      } catch (error) {
        console.error('Error setting up tray icon:', error);
      }

      // Quit when all windows are closed.
      app.on('window-all-closed', () => {
        // On OS X it is common for applications and their menu bar
        // to stay active until the user quits explicitly with Cmd + Q
        if (process.platform !== 'darwin') {
          app.quit();
        }
      });

      app.on('activate', () => {
        if (win === null) {
          createWindow();
        }
      });
    } catch (error) {
      log.error(`Failed to initialize the application: ${formatUnknownError(error)}`);
      // If initialization fails, quit the app to prevent it from running in a broken state
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    if (tray) {
      tray.destroy();
      tray = null;
    }
    app.quit();
  });

} catch (e) {
  console.error('Error during initialization: ', e);
}
