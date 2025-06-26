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
        acquireTimeout: 10000, timeout: 600, connectionLimit: 10, waitForConnections: true, queueLimit: 0 });
}
function copyMigrationFiles() {
    const migrationSourceDir = path.join(__dirname, 'mysql-migrations');
    const migrationTargetDir = path.join(electron_1.app.getPath('userData'), 'mysql-migrations');
    if (!fs.existsSync(migrationSourceDir)) {
        console.error(`Migration source directory not found: ${migrationSourceDir}`);
        return;
    }
    const sourceFiles = fs.readdirSync(migrationSourceDir);
    // Create the target directory if it doesn't exist
    if (!fs.existsSync(migrationTargetDir)) {
        fs.mkdirSync(migrationTargetDir, { recursive: true });
    }
    // Check each file in the source directory
    sourceFiles.forEach(file => {
        const sourceFile = path.join(migrationSourceDir, file);
        const targetFile = path.join(migrationTargetDir, file);
        if (!fs.existsSync(targetFile)) {
            // If the target file doesn't exist, copy it
            fs.copyFileSync(sourceFile, targetFile);
        }
        else {
            // Check if the source file is newer than the target file
            const sourceStat = fs.statSync(sourceFile);
            const targetStat = fs.statSync(targetFile);
            if (sourceStat.mtime > targetStat.mtime) {
                fs.copyFileSync(sourceFile, targetFile);
            }
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
    electron_1.app.on('ready', () => {
        (0, sqlite3helper_main_1.setupSqlite)(store, (db, err) => {
            if (err) {
                console.error('Error during SQLite setup:', err);
            }
            sqlite3Obj = db;
            console.info('SQLite setup complete');
            createWindow();
            copyMigrationFiles(); // Ensure migration files are moved
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
            electron_1.ipcMain.handle('export-settings', (event, settingsJSON) => __awaiter(void 0, void 0, void 0, function* () {
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
            // Register the 'getUserDataPath' handler after window creation
            electron_1.ipcMain.handle('getUserDataPath', () => {
                return electron_1.app.getPath('userData');
            });
            electron_1.ipcMain.handle('mysql-create-pool', (event, config) => {
                const key = JSON.stringify(config);
                if (!mysqlPools[key]) {
                    const universalConfig = createUniversalMySQLPoolConfig(config);
                    try {
                        mysqlPools[key] = mysql.createPool(universalConfig);
                        // Set up pool event handlers
                        mysqlPools[key].on('connection', (connection) => {
                            console.log('MySQL connection established');
                            // Set session variables for compatibility across versions
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
                            // Enhanced error handling for different MySQL versions
                            const errorInfo = {
                                message: err.message,
                                code: err.code,
                                errno: err.errno,
                                sqlState: err.sqlState,
                                sqlMessage: err.sqlMessage,
                                fatal: err.fatal
                            };
                            // Log different error types
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
                    // Use connection config (not pool config) for single connection test
                    const universalConfig = createUniversalMySQLConfig(config);
                    // Create a temporary connection for testing
                    const testConnection = mysql.createConnection(universalConfig);
                    testConnection.connect((err) => {
                        if (err) {
                            testConnection.destroy();
                            reject({
                                success: false,
                                error: err.message,
                                code: err.code,
                                version: 'unknown'
                            });
                        }
                        else {
                            // Get MySQL version for debugging
                            testConnection.query('SELECT VERSION() as version', (versionErr, results) => {
                                const version = results && results[0] ? results[0].version : 'unknown';
                                testConnection.destroy();
                                if (versionErr) {
                                    reject({
                                        success: false,
                                        error: versionErr.message,
                                        version: version
                                    });
                                }
                                else {
                                    resolve({
                                        success: true,
                                        message: 'Connection successful',
                                        version: version
                                    });
                                }
                            });
                        }
                    });
                    // Timeout the test after 15 seconds
                    setTimeout(() => {
                        testConnection.destroy();
                        reject({
                            success: false,
                            error: 'Connection test timeout',
                            code: 'TIMEOUT'
                        });
                    }, 15000);
                });
            });
            electron_1.ipcMain.handle('import-settings', (event) => __awaiter(void 0, void 0, void 0, function* () {
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
            // Register a 'dialog' event listener.
            electron_1.ipcMain.handle('dialog', (event, method, params) => {
                return electron_1.dialog[method](params);
            });
            electron_1.ipcMain.on('sqlite3-query', (event, sql, args, uniqueEvent) => {
                try {
                    if (!sqlite3Obj) {
                        throw new Error('Database not initialized');
                    }
                    const isSelect = sql.trim().toLowerCase().startsWith('select');
                    const isInsert = sql.trim().toLowerCase().startsWith('insert');
                    if (isSelect) {
                        // For SELECT queries, use db.all() to get all results
                        if (args === null || args === undefined) {
                            sqlite3Obj.all(sql, (err, rows) => {
                                var _a;
                                if (err) {
                                    console.error(`SQLite error for query [${sql}]:`, err);
                                    event.reply(uniqueEvent, {
                                        error: err.message,
                                        code: (_a = err.code) !== null && _a !== void 0 ? _a : 'SQLITE_ERROR',
                                        sql: sql
                                    });
                                }
                                else {
                                    event.reply(uniqueEvent, rows);
                                }
                            });
                        }
                        else {
                            sqlite3Obj.all(sql, args, (err, rows) => {
                                var _a;
                                if (err) {
                                    console.error(`SQLite error for query [${sql}]:`, err);
                                    event.reply(uniqueEvent, {
                                        error: err.message,
                                        code: (_a = err.code) !== null && _a !== void 0 ? _a : 'SQLITE_ERROR',
                                        sql: sql
                                    });
                                }
                                else {
                                    event.reply(uniqueEvent, rows);
                                }
                            });
                        }
                    }
                    else if (isInsert) {
                        // For INSERT queries, use db.run() and return the lastID
                        if (args === null || args === undefined) {
                            sqlite3Obj.run(sql, function (err) {
                                var _a;
                                if (err) {
                                    console.error(`SQLite error for query [${sql}]:`, err);
                                    event.reply(uniqueEvent, {
                                        error: err.message,
                                        code: (_a = err.code) !== null && _a !== void 0 ? _a : 'SQLITE_ERROR',
                                        sql: sql
                                    });
                                }
                                else {
                                    event.reply(uniqueEvent, {
                                        changes: this.changes,
                                        lastInsertRowid: this.lastID
                                    });
                                    console.log(`Insert operation completed. Changes: ${this.changes}, Last ID: ${this.lastID}`);
                                }
                            });
                        }
                        else {
                            sqlite3Obj.run(sql, args, function (err) {
                                var _a;
                                if (err) {
                                    console.error(`SQLite error for query [${sql}]:`, err);
                                    event.reply(uniqueEvent, {
                                        error: err.message,
                                        code: (_a = err.code) !== null && _a !== void 0 ? _a : 'SQLITE_ERROR',
                                        sql: sql
                                    });
                                }
                                else {
                                    event.reply(uniqueEvent, {
                                        changes: this.changes,
                                        lastInsertRowid: this.lastID
                                    });
                                    console.log(`Insert operation completed. Changes: ${this.changes}, Last ID: ${this.lastID}`);
                                }
                            });
                        }
                    }
                    else {
                        // For UPDATE, DELETE, etc., use db.run()
                        if (args === null || args === undefined) {
                            sqlite3Obj.run(sql, function (err) {
                                var _a;
                                if (err) {
                                    console.error(`SQLite error for query [${sql}]:`, err);
                                    event.reply(uniqueEvent, {
                                        error: err.message,
                                        code: (_a = err.code) !== null && _a !== void 0 ? _a : 'SQLITE_ERROR',
                                        sql: sql
                                    });
                                }
                                else {
                                    event.reply(uniqueEvent, { changes: this.changes });
                                }
                            });
                        }
                        else {
                            sqlite3Obj.run(sql, args, function (err) {
                                var _a;
                                if (err) {
                                    console.error(`SQLite error for query [${sql}]:`, err);
                                    event.reply(uniqueEvent, {
                                        error: err.message,
                                        code: (_a = err.code) !== null && _a !== void 0 ? _a : 'SQLITE_ERROR',
                                        sql: sql
                                    });
                                }
                                else {
                                    event.reply(uniqueEvent, { changes: this.changes });
                                }
                            });
                        }
                    }
                }
                catch (err) {
                    console.error(`SQLite general error:`, err);
                    event.reply(uniqueEvent, {
                        error: err.message,
                        code: 'SQLITE_ERROR',
                        sql: sql
                    });
                }
            });
            electron_1.ipcMain.handle('log-info', (event, message, instrumentId = null) => {
                let appLog = log.scope('app');
                if (instrumentId) {
                    appLog = log.scope(instrumentId);
                }
                appLog.info(message);
            });
            electron_1.ipcMain.handle('log-warning', (event, message, instrumentId = null) => {
                let appLog = log.scope('app');
                if (instrumentId) {
                    appLog = log.scope(instrumentId);
                }
                appLog.warn(message);
            });
            electron_1.ipcMain.handle('log-error', (event, message, instrumentId = null) => {
                let appLog = log.scope('app');
                if (instrumentId) {
                    appLog = log.scope(instrumentId);
                }
                appLog.error(message);
            });
            // Add WAL checkpoint handler for sqlite3
            electron_1.ipcMain.handle('sqlite3-wal-checkpoint', () => {
                return new Promise((resolve, reject) => {
                    if (!sqlite3Obj) {
                        reject(new Error('Database not initialized'));
                        return;
                    }
                    sqlite3Obj.run("PRAGMA wal_checkpoint(PASSIVE)", function (err) {
                        if (err) {
                            console.error('Error running WAL checkpoint:', err);
                            reject(err);
                        }
                        else {
                            console.log('WAL checkpoint completed successfully');
                            resolve({ success: true });
                        }
                    });
                });
            });
        });
    });
}
catch (e) {
    console.error('Error during initialization: ', e);
}
//# sourceMappingURL=main.js.map