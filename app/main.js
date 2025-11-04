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
const electron_1 = require("electron");
const path = require("path");
const fs = require("fs");
const mysql = require("mysql2");
const log = require("electron-log/main");
const sqlite3helper_main_1 = require("./sqlite3helper.main");
const Store = require('electron-store');
let win = null;
let store = new Store();
let sqlite3Obj = null;
let sqliteDbName = 'interface.db';
const args = process.argv.slice(1), serve = args.some(val => val === '--serve');
let tray = null;
function getSQLiteDBConnection() {
    return sqlite3Obj;
}
function restartApp() {
    electron_1.app.relaunch();
    electron_1.app.exit();
}
function runSqliteMigrations(db, migrationsPath) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('Running SQLite migrations from:', migrationsPath);
        try {
            // 1. Ensure versions table exists
            yield new Promise((resolve, reject) => {
                db.run('CREATE TABLE IF NOT EXISTS versions (version INTEGER PRIMARY KEY, filename TEXT, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)', (err) => {
                    if (err)
                        return reject(err);
                    resolve();
                });
            });
            // 2. Add filename column for backward compatibility
            yield new Promise((resolve, reject) => {
                db.run('ALTER TABLE versions ADD COLUMN filename TEXT', (err) => {
                    if (err && !err.message.includes('duplicate column name')) {
                        console.error('Error altering versions table:', err);
                        return reject(err);
                    }
                    resolve();
                });
            });
            // 3. Get migration files
            const migrationFiles = fs.readdirSync(migrationsPath)
                .filter(file => file.endsWith('.sql'))
                .sort();
            // 4. Get applied migrations
            const appliedFilenames = yield new Promise((resolve, reject) => {
                db.all('SELECT filename FROM versions WHERE filename IS NOT NULL', (err, rows) => {
                    if (err)
                        return reject(err);
                    resolve(new Set(rows.map(row => row.filename)));
                });
            });
            // 5. Run new migrations
            for (const file of migrationFiles) {
                if (appliedFilenames.has(file)) {
                    continue;
                }
                console.log(`Applying SQLite migration: ${file}`);
                const filePath = path.join(migrationsPath, file);
                const sql = fs.readFileSync(filePath, 'utf8');
                // 1. Remove comment lines, 2. Split by semicolon, 3. Trim and filter empty statements
                const statements = sql.split('\n')
                    .filter(line => !line.trim().startsWith('--'))
                    .join('\n')
                    .split(';')
                    .map(s => s.trim())
                    .filter(s => s.length > 0);
                console.log(`Executing ${statements.length} statements from migration file: ${file}`);
                console.log(`Statements:`, statements);
                for (const statement of statements) {
                    yield new Promise((resolve) => {
                        db.run(statement, (err) => {
                            if (err) {
                                console.warn(`Warning executing statement in ${file}: "${statement}". Error: ${err.message}`);
                            }
                            resolve(); // Always resolve, even if there's an error
                        });
                    });
                }
                // Record the migration as complete, regardless of statement errors, to prevent re-running.
                const version = parseInt(file.split('.')[0], 10);
                yield new Promise((resolve, reject) => {
                    db.run('INSERT INTO versions (version, filename) VALUES (?, ?)', [version, file], (err) => {
                        if (err) {
                            // If we fail to record the version, that's a critical error.
                            return reject(new Error(`Failed to record migration version for ${file}: ${err.message}`));
                        }
                        console.log(`Finished applying SQLite migration: ${file}`);
                        resolve();
                    });
                });
            }
            console.log('SQLite migrations check complete.');
        }
        catch (err) {
            console.error('A critical error occurred during the SQLite migration process:', err);
        }
    });
}
function createUniversalMySQLConfig(baseConfig) {
    return Object.assign(Object.assign({}, baseConfig), { 
        // Connection settings (valid for both pools and connections)
        ssl: false, insecureAuth: true, supportBigNumbers: true, bigNumberStrings: true, 
        // Connection-specific timeout (valid for connections)
        connectTimeout: 10000, 
        // Date handling (consistent across versions)
        dateStrings: ['DATE', 'DATETIME', 'TIMESTAMP'], 
        // Character set (important for MySQL 5.x compatibility)
        charset: 'utf8mb4', 
        // SQL mode handling (MySQL 5.x vs 8.x differences)
        typeCast: function (field, next) {
            // Handle different data types consistently
            if (field.type === 'BIT' && field.length === 1) {
                return field.buffer()[0] === 1;
            }
            return next();
        } });
}
function createUniversalMySQLPoolConfig(baseConfig) {
    return Object.assign(Object.assign({}, createUniversalMySQLConfig(baseConfig)), { 
        // Pool-specific settings
        // acquireTimeout: 10000,        // 10 seconds to get connection from pool
        // timeout: 600,                 // Query timeout (pool-specific)
        connectionLimit: 10, waitForConnections: true, queueLimit: 0 });
}
function copySqliteMigrationFiles() {
    return __awaiter(this, void 0, void 0, function* () {
        const sourceDir = path.join(serve ? __dirname : process.resourcesPath, 'sqlite-migrations');
        const targetDir = path.join(electron_1.app.getPath('userData'), 'sqlite-migrations');
        try {
            if (!fs.existsSync(sourceDir)) {
                console.error(`SQLite migration source directory not found: ${sourceDir}`);
                return;
            }
            if (!fs.existsSync(targetDir)) {
                yield fs.promises.mkdir(targetDir, { recursive: true });
            }
            const files = yield fs.promises.readdir(sourceDir);
            for (const file of files) {
                const sourceFile = path.join(sourceDir, file);
                const targetFile = path.join(targetDir, file);
                if (!fs.existsSync(targetFile)) {
                    yield fs.promises.copyFile(sourceFile, targetFile);
                    console.log(`Copied SQLite migration file: ${file}`);
                }
            }
        }
        catch (err) {
            console.error('Error copying SQLite migration files:', err);
        }
    });
}
function createWindow() {
    const electronScreen = electron_1.screen;
    const size = electronScreen.getPrimaryDisplay().workAreaSize;
    log.initialize();
    log.transports.file.level = 'info';
    log.transports.console.level = 'info';
    const today = new Date();
    const dateString = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
    log.transports.file.fileName = `${dateString}.log`;
    Store.initRenderer();
    store = new Store();
    store.set('appPath', path.join(electron_1.app.getPath('userData'), '/', sqliteDbName));
    store.set('appVersion', electron_1.app.getVersion());
    win = new electron_1.BrowserWindow({
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
        const debug = require('electron-debug');
        debug();
        require('electron-reloader')(module);
        win.loadURL('http://localhost:4200');
    }
    else {
        let pathIndex = './index.html';
        if (fs.existsSync(path.join(__dirname, '../dist/index.html'))) {
            pathIndex = '../dist/index.html';
        }
        let joinedPath = path.join(__dirname, pathIndex);
        const url = new URL(`file:${path.sep}${path.sep}${joinedPath}`);
        win.loadURL(url.href);
    }
    win.on('closed', () => {
        win = null;
    });
    return win;
}
function openModal() {
    const modal = new electron_1.BrowserWindow({ parent: win, modal: true, show: false });
    modal.loadURL('');
    modal.once('ready-to-show', () => {
        modal.show();
    });
}
electron_1.ipcMain.on('openModal', (event, arg) => {
    openModal();
});
try {
    const gotTheLock = electron_1.app.requestSingleInstanceLock();
    if (!gotTheLock) {
        electron_1.app.quit();
    }
    else {
        electron_1.app.on('second-instance', (event, commandLine, workingDirectory) => {
            if (win && !win.isDestroyed()) {
                if (win.isMinimized())
                    win.restore();
                win.focus();
            }
        });
    }
    const mysqlPools = {}; // simple in-memory cache of pools
    function registerIpcHandlers() {
        electron_1.ipcMain.handle('export-settings', (event, settingsJSON) => __awaiter(this, void 0, void 0, function* () {
            try {
                const today = new Date();
                const timestamp = `${today.getFullYear()}${(today.getMonth() + 1).toString().padStart(2, '0')}${today.getDate().toString().padStart(2, '0')}-${today.getHours().toString().padStart(2, '0')}${today.getMinutes().toString().padStart(2, '0')}`;
                const defaultPath = `interface-settings-${timestamp}.json`;
                const { filePath, canceled } = yield electron_1.dialog.showSaveDialog({
                    title: 'Export Settings',
                    defaultPath: defaultPath,
                    filters: [{ name: 'JSON Files', extensions: ['json'] }]
                });
                if (canceled) {
                    return { status: 'cancelled', message: 'Export cancelled.' };
                }
                else {
                    fs.writeFileSync(filePath, settingsJSON, 'utf8');
                    return { status: 'success', message: 'Settings successfully exported.' };
                }
            }
            catch (err) {
                console.error('Failed to save settings:', err);
                return { status: 'error', message: 'Failed to export settings.' };
            }
        }));
        electron_1.ipcMain.handle('getUserDataPath', () => {
            return electron_1.app.getPath('userData');
        });
        electron_1.ipcMain.handle('mysql-create-pool', (event, config) => {
            const key = JSON.stringify(config);
            if (!mysqlPools[key]) {
                const universalConfig = createUniversalMySQLPoolConfig(config);
                try {
                    mysqlPools[key] = mysql.createPool(universalConfig);
                    mysqlPools[key].on('connection', (connection) => {
                        console.log('MySQL connection established');
                        const compatibilityQueries = [
                            "SET SESSION sql_mode=(SELECT REPLACE(@@sql_mode, 'ONLY_FULL_GROUP_BY', ''))",
                            "SET SESSION INTERACTIVE_TIMEOUT=600",
                            "SET SESSION WAIT_TIMEOUT=600"
                        ];
                        compatibilityQueries.forEach(query => {
                            connection.query(query, (err) => {
                                if (err) {
                                    console.warn(`Non-critical SQL mode warning: ${err.message}`);
                                }
                            });
                        });
                    });
                    mysqlPools[key].on('error', (err) => {
                        console.error('MySQL pool error:', err.message);
                    });
                }
                catch (error) {
                    console.error('Error creating MySQL pool:', error);
                    throw error;
                }
            }
            return { status: 'ok' };
        });
        electron_1.ipcMain.handle('mysql-query', (event, config, query, values) => {
            const key = JSON.stringify(config);
            if (!mysqlPools[key]) {
                const universalConfig = createUniversalMySQLPoolConfig(config);
                mysqlPools[key] = mysql.createPool(universalConfig);
            }
            return new Promise((resolve, reject) => {
                mysqlPools[key].query(query, values !== null && values !== void 0 ? values : [], (err, results) => {
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
                        }
                        else if (err.code === 'ECONNREFUSED') {
                            console.error('MySQL Connection Refused - Check if MySQL is running:', errorInfo);
                        }
                        else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
                            console.error('MySQL Access Denied - Check credentials:', errorInfo);
                        }
                        else {
                            console.error('MySQL Error:', errorInfo);
                        }
                        reject(err);
                    }
                    else {
                        resolve(results);
                    }
                });
            });
        });
        electron_1.ipcMain.handle('mysql-test-connection', (event, config) => {
            return new Promise((resolve, reject) => {
                const universalConfig = createUniversalMySQLConfig(config);
                const testConnection = mysql.createConnection(universalConfig);
                testConnection.connect((err) => {
                    if (err) {
                        testConnection.destroy();
                        reject({ success: false, error: err.message, code: err.code, version: 'unknown' });
                    }
                    else {
                        testConnection.query('SELECT VERSION() as version', (versionErr, results) => {
                            const version = results && results[0] ? results[0].version : 'unknown';
                            testConnection.destroy();
                            if (versionErr) {
                                reject({ success: false, error: versionErr.message, version: version });
                            }
                            else {
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
        electron_1.ipcMain.handle('import-settings', (event) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { filePaths, canceled } = yield electron_1.dialog.showOpenDialog({
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
            }
            catch (err) {
                console.error('Failed to import settings:', err);
                return { status: 'error', message: 'Failed to import settings.' };
            }
        }));
        electron_1.ipcMain.handle('dialog', (event, method, params) => {
            return electron_1.dialog[method](params);
        });
        electron_1.ipcMain.on('force-rerun-migrations', (event) => {
            try {
                const db = getSQLiteDBConnection();
                if (db) {
                    db.exec('DROP TABLE IF EXISTS versions', (err) => {
                        if (err) {
                            console.error('Failed to drop SQLite versions table:', err);
                        }
                        restartApp();
                    });
                }
                else {
                    console.error('SQLite DB connection not available.');
                    restartApp();
                }
            }
            catch (error) {
                console.error('Error during SQLite table drop:', error);
                restartApp();
            }
        });
        electron_1.ipcMain.handle('show-confirm-dialog', (event, options) => __awaiter(this, void 0, void 0, function* () {
            const focusedWindow = electron_1.BrowserWindow.getFocusedWindow();
            if (focusedWindow) {
                return electron_1.dialog.showMessageBox(focusedWindow, options);
            }
            return electron_1.dialog.showMessageBox(null, options);
        }));
    }
    electron_1.app.on('ready', () => __awaiter(void 0, void 0, void 0, function* () {
        try {
            // First, set up the SQLite database connection
            sqlite3Obj = yield new Promise((resolve, reject) => {
                (0, sqlite3helper_main_1.setupSqlite)(store, (db, err) => {
                    if (err) {
                        console.error('Error during SQLite setup:', err);
                        return reject(err);
                    }
                    console.info('SQLite setup complete');
                    resolve(db);
                });
            });
            // Then, copy and run the migrations
            const migrationsPath = path.join(electron_1.app.getPath('userData'), 'sqlite-migrations');
            yield copySqliteMigrationFiles();
            yield runSqliteMigrations(sqlite3Obj, migrationsPath);
            // IMPORTANT: Register all IPC handlers BEFORE creating the window
            registerIpcHandlers();
            // Now that the database and IPC are ready, create the main window
            createWindow();
            // Log app startup to both console and file
            const startupTime = new Date().toISOString();
            console.log(`\n${'='.repeat(80)}\n🚀 APPLICATION STARTED - ${startupTime}\n${'='.repeat(80)}\n`);
            const trayIconPath = 'dist/assets/icons/favicon.png';
            try {
                const icon = electron_1.nativeImage.createFromPath(trayIconPath);
                tray = new electron_1.Tray(icon);
                const contextMenu = electron_1.Menu.buildFromTemplate([
                    { label: 'Show', click: () => { win.show(); } },
                    { label: 'Minimize', click: () => { win.minimize(); } },
                    { label: 'Quit', click: () => { electron_1.app.quit(); } },
                ]);
                tray.setToolTip('Interface Tool');
                tray.setContextMenu(contextMenu);
                tray.on('click', () => {
                    if (win) {
                        if (win.isMinimized())
                            win.restore();
                        if (!win.isVisible())
                            win.show();
                        win.focus();
                    }
                });
                console.log('Tray icon setup successful.');
            }
            catch (error) {
                console.error('Error setting up tray icon:', error);
            }
            // Quit when all windows are closed.
            electron_1.app.on('window-all-closed', () => {
                // On OS X it is common for applications and their menu bar
                // to stay active until the user quits explicitly with Cmd + Q
                if (process.platform !== 'darwin') {
                    electron_1.app.quit();
                }
            });
            electron_1.app.on('activate', () => {
                if (win === null) {
                    createWindow();
                }
            });
        }
        catch (error) {
            console.error('Failed to initialize the application:', error);
            // If initialization fails, quit the app to prevent it from running in a broken state
            electron_1.app.quit();
        }
    }));
    electron_1.app.on('window-all-closed', () => {
        if (tray) {
            tray.destroy();
            tray = null;
        }
        electron_1.app.quit();
    });
}
catch (e) {
    console.error('Error during initialization: ', e);
}
//# sourceMappingURL=main.js.map