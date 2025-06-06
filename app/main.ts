import { app, BrowserWindow, screen, ipcMain, dialog, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as mysql from 'mysql';
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


function copyMigrationFiles() {
  const migrationSourceDir = path.join(__dirname, 'mysql-migrations');
  const migrationTargetDir = path.join(app.getPath('userData'), 'mysql-migrations');

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
    } else {
      // Check if the source file is newer than the target file
      const sourceStat = fs.statSync(sourceFile);
      const targetStat = fs.statSync(targetFile);

      if (sourceStat.mtime > targetStat.mtime) {
        fs.copyFileSync(sourceFile, targetFile);
      }
    }
  });
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
    const debug = require('electron-debug');
    debug();

    require('electron-reloader')(module);
    win.loadURL('http://localhost:4200');
  } else {
    let pathIndex = './index.html';

    if (fs.existsSync(path.join(__dirname, '../dist/index.html'))) {
      pathIndex = '../dist/index.html';
    }

    let joinedPath = path.join(__dirname, pathIndex)
    const url = new URL(`file:${path.sep}${path.sep}${joinedPath}`);
    win.loadURL(url.href);
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


  app.on('ready', () => {
    setupSqlite(store, (db, err) => {
      if (err) {
        console.error('Error during SQLite setup:', err);
      }
      sqlite3Obj = db;
      console.info('SQLite setup complete');

      createWindow();
      copyMigrationFiles();  // Ensure migration files are moved

      const trayIconPath = 'dist/assets/icons/favicon.png';
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
          console.error('Failed to save settings:', err);
          return { status: 'error', message: 'Failed to export settings.' };
        }
      });

      // Register the 'getUserDataPath' handler after window creation
      ipcMain.handle('getUserDataPath', () => {
        return app.getPath('userData');
      });

      ipcMain.handle('mysql-create-pool', (event, config) => {
        const key = JSON.stringify(config);
        if (!mysqlPools[key]) {
          mysqlPools[key] = mysql.createPool(config);
        }
        return { status: 'ok' };
      });


      ipcMain.handle('mysql-query', (event, config, query: string, values?: any[]) => {
        const key = JSON.stringify(config);
        if (!mysqlPools[key]) {
          mysqlPools[key] = mysql.createPool(config);
        }

        return new Promise((resolve, reject) => {
          mysqlPools[key].query(query, values ?? [], (err: any, results: any) => {
            if (err) {
              // Log the detailed error in the main process for debugging
              // console.error('MySQL error in main process:', {
              //   message: err.message,
              //   code: err.code,
              //   sqlState: err.sqlState,
              //   sqlMessage: err.sqlMessage,
              //   fatal: err.fatal
              // });
              // Reject with the original MySQL error object
              reject(err);
            } else {
              resolve(results);
            }
          });
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

      // Register a 'dialog' event listener.
      ipcMain.handle('dialog', (event, method, params) => {
        return dialog[method](params);
      });

      ipcMain.on('sqlite3-query', (event, sql, args, uniqueEvent) => {
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
                if (err) {
                  console.error(`SQLite error for query [${sql}]:`, err);
                  event.reply(uniqueEvent, {
                    error: err.message,
                    code: (err as any).code ?? 'SQLITE_ERROR',
                    sql: sql
                  });
                } else {
                  event.reply(uniqueEvent, rows);
                }
              });
            } else {
              sqlite3Obj.all(sql, args, (err, rows) => {
                if (err) {
                  console.error(`SQLite error for query [${sql}]:`, err);
                  event.reply(uniqueEvent, {
                    error: err.message,
                    code: (err as any).code ?? 'SQLITE_ERROR',
                    sql: sql
                  });
                } else {
                  event.reply(uniqueEvent, rows);
                }
              });
            }
          } else if (isInsert) {
            // For INSERT queries, use db.run() and return the lastID
            if (args === null || args === undefined) {
              sqlite3Obj.run(sql, function (err) {
                if (err) {
                  console.error(`SQLite error for query [${sql}]:`, err);
                  event.reply(uniqueEvent, {
                    error: err.message,
                    code: (err as any).code ?? 'SQLITE_ERROR',
                    sql: sql
                  });
                } else {
                  event.reply(uniqueEvent, {
                    changes: this.changes,
                    lastInsertRowid: this.lastID
                  });
                  console.log(`Insert operation completed. Changes: ${this.changes}, Last ID: ${this.lastID}`);
                }
              });
            } else {
              sqlite3Obj.run(sql, args, function (err) {
                if (err) {
                  console.error(`SQLite error for query [${sql}]:`, err);
                  event.reply(uniqueEvent, {
                    error: err.message,
                    code: (err as any).code ?? 'SQLITE_ERROR',
                    sql: sql
                  });
                } else {
                  event.reply(uniqueEvent, {
                    changes: this.changes,
                    lastInsertRowid: this.lastID
                  });
                  console.log(`Insert operation completed. Changes: ${this.changes}, Last ID: ${this.lastID}`);
                }
              });
            }
          } else {
            // For UPDATE, DELETE, etc., use db.run()
            if (args === null || args === undefined) {
              sqlite3Obj.run(sql, function (err) {
                if (err) {
                  console.error(`SQLite error for query [${sql}]:`, err);
                  event.reply(uniqueEvent, {
                    error: err.message,
                    code: (err as any).code ?? 'SQLITE_ERROR',
                    sql: sql
                  });
                } else {
                  event.reply(uniqueEvent, { changes: this.changes });
                }
              });
            } else {
              sqlite3Obj.run(sql, args, function (err) {
                if (err) {
                  console.error(`SQLite error for query [${sql}]:`, err);
                  event.reply(uniqueEvent, {
                    error: err.message,
                    code: (err as any).code ?? 'SQLITE_ERROR',
                    sql: sql
                  });
                } else {
                  event.reply(uniqueEvent, { changes: this.changes });
                }
              });
            }
          }
        } catch (err) {
          console.error(`SQLite general error:`, err);
          event.reply(uniqueEvent, {
            error: err.message,
            code: 'SQLITE_ERROR',
            sql: sql
          });
        }
      });



      ipcMain.handle('log-info', (event, message, instrumentId = null) => {
        let appLog = log.scope('app');
        if (instrumentId) {
          appLog = log.scope(instrumentId);
        }
        appLog.info(message);
      });

      ipcMain.handle('log-warning', (event, message, instrumentId = null) => {
        let appLog = log.scope('app');
        if (instrumentId) {
          appLog = log.scope(instrumentId);
        }
        appLog.warn(message);
      });

      ipcMain.handle('log-error', (event, message, instrumentId = null) => {
        let appLog = log.scope('app');
        if (instrumentId) {
          appLog = log.scope(instrumentId);
        }
        appLog.error(message);
      });

      // Add WAL checkpoint handler for sqlite3
      ipcMain.handle('sqlite3-wal-checkpoint', () => {
        return new Promise((resolve, reject) => {
          if (!sqlite3Obj) {
            reject(new Error('Database not initialized'));
            return;
          }

          sqlite3Obj.run("PRAGMA wal_checkpoint(PASSIVE)", function (err) {
            if (err) {
              console.error('Error running WAL checkpoint:', err);
              reject(err);
            } else {
              console.log('WAL checkpoint completed successfully');
              resolve({ success: true });
            }
          });
        });
      });
    });
  });

} catch (e) {
  console.error('Error during initialization: ', e);
}
