import { app, BrowserWindow, screen, ipcMain, dialog, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as Store from 'electron-store';
import * as log from 'electron-log/main';
import { setupSqlite } from './sqlite3helper.main';

let win: BrowserWindow = null;
let store: Store = null;
let sqlitePath: string = null;
let sqliteDbName: string = 'interface.db';
const args = process.argv.slice(1),
  serve = args.some(val => val === '--serve');
let tray: Tray = null;

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

  sqlitePath = path.join(app.getPath('userData'), '/', sqliteDbName);
  store.set('appPath', sqlitePath);
  store.set('appVersion', app.getVersion());

  win = new BrowserWindow({
    x: 0,
    y: 0,
    fullscreenable: true,
    width: size.width,
    height: size.height,
    webPreferences: {
      nodeIntegration: true,
      allowRunningInsecureContent: (serve) ? true : false,
      contextIsolation: false,
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

    const url = new URL(path.join('file:', __dirname, pathIndex));
    win.loadURL(url.href);
  }

  win.on('closed', () => {
    win = null;
  });

  return win;
}

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

  app.on('ready', () => {
    setupSqlite(store, (db, err) => {
      if (err) {
        console.error('Error during SQLite setup:', err);
        return;
      }

      createWindow();

      const trayIconPath = path.join(__dirname, 'assets', 'icons', 'favicon.png');
      try {
        const icon = nativeImage.createFromPath(trayIconPath);
        tray = new Tray(icon);
        const contextMenu = Menu.buildFromTemplate([
          { label: 'Show', click: () => { win.show(); } },
          { label: 'Minimize', click: () => { win.minimize(); } },
          { label: 'Quit', click: () => { app.quit(); } },
        ]);
        tray.setToolTip('Your Application');
        tray.setContextMenu(contextMenu);

        tray.on('click', () => {
          win.show();
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
            fs.writeFileSync(filePath, settingsJSON, 'utf-8');
            return { status: 'success', message: 'Settings successfully exported.' };
          }
        } catch (err) {
          console.error('Failed to save settings:', err);
          return { status: 'error', message: 'Failed to export settings.' };
        }
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

      ipcMain.on('sqlite3-query', (event, sql, args) => {
        if (args === null || args === undefined) {
          db.all(sql, (err, rows) => {
            event.reply('sqlite3-reply', (err && err.message) || rows);
          });
        } else {
          db.all(sql, args, (err, rows) => {
            event.reply('sqlite3-reply', (err && err.message) || rows);
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
    });
  });

} catch (e) {
  console.error('Error during initialization: ', e);
}
