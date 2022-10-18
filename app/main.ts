import { app, BrowserWindow, screen, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as Store from 'electron-store';
//import { Sqlite3Helper } from '../src/app/core/sqlite3helper.main';


let win: BrowserWindow = null;
let store: Store = null;
let sqlitePath: string = null;
let sqliteDbName: string = 'interface.db';
const args = process.argv.slice(1),
  serve = args.some(val => val === '--serve');



function createWindow(): BrowserWindow {

  const electronScreen = screen;
  const size = electronScreen.getPrimaryDisplay().workAreaSize;

  //const Store = require('electron-store');
  Store.initRenderer();
  store = new Store();


  sqlitePath = path.join(app.getPath('userData'), '/', sqliteDbName);
  store.set('appPath', sqlitePath);


  // Create the browser window.
  win = new BrowserWindow({
    x: 0,
    y: 0,
    fullscreenable: true,
    width: size.width,
    height: size.height,
    webPreferences: {
      nodeIntegration: true,
      allowRunningInsecureContent: (serve) ? true : false,
      contextIsolation: false,  // false if you want to run e2e test with Spectron
    },
  });

  if (serve) {
    const debug = require('electron-debug');
    debug();

    require('electron-reloader')(module);
    win.loadURL('http://localhost:4200');
  } else {
    // Path when running electron executable
    let pathIndex = './index.html';

    if (fs.existsSync(path.join(__dirname, '../dist/index.html'))) {
      // Path when running electron in local folder
      pathIndex = '../dist/index.html';
    }

    const url = new URL(path.join('file:', __dirname, pathIndex));
    win.loadURL(url.href);

  }

  // Emitted when the window is closed.
  win.on('closed', () => {
    // Dereference the window object, usually you would store window
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    win = null;
  });

  return win;
}

try {

  const gotTheLock = app.requestSingleInstanceLock();

  if (!gotTheLock) {
    app.quit()
  } else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
      // Someone tried to run a second instance, we should focus our window.
      if (win) {
        if (win.isMinimized()) win.restore()
        win.focus();
      }
    });
  }

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  // Added 400 ms to fix the black background issue while using transparent window. More detais at https://github.com/electron/electron/issues/15947
  app.on('ready', () => setTimeout(createWindow, 400));

  // Quit when all windows are closed.
  app.on('window-all-closed', () => {
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (win === null) {
      createWindow();
    }
  });
  app.whenReady().then(() => {

    // Register a 'dialog' event listener.
    ipcMain.handle('dialog', (event, method, params) => {
      dialog[method](params);
    });
    //new Sqlite3Helper(appUserDataPath);
    const sqlite3 = require('sqlite3');

    sqlitePath = path.join(app.getPath('userData'), '/', sqliteDbName);
    const database = new sqlite3.Database(sqlitePath, (err) => {
      if (err) {
        store.set('appPath', JSON.stringify(err));
        console.error('Database opening error: ', err);
      }

    });

    database.run('CREATE TABLE IF NOT EXISTS `orders` ( \
      `id` INTEGER NOT NULL, \
      `order_id` TEXT NOT NULL, \
      `test_id` TEXT DEFAULT NULL, \
      `test_type` TEXT NOT NULL, \
      `created_date` date DEFAULT NULL, \
      `test_unit` TEXT DEFAULT NULL, \
      `results` TEXT DEFAULT NULL, \
      `tested_by` TEXT DEFAULT NULL, \
      `analysed_date_time` datetime DEFAULT NULL, \
      `specimen_date_time` datetime DEFAULT NULL, \
      `authorised_date_time` datetime DEFAULT NULL, \
      `result_accepted_date_time` datetime DEFAULT NULL, \
      `machine_used` TEXT DEFAULT NULL, \
      `test_location` TEXT DEFAULT NULL, \
      `created_at` INTEGER NOT NULL DEFAULT "0", \
      `result_status` INTEGER NOT NULL DEFAULT "0", \
      `lims_sync_status` INTEGER DEFAULT "0", \
      `lims_sync_date_time` datetime DEFAULT NULL, \
      `repeated` INTEGER DEFAULT "0", \
      `test_description` TEXT DEFAULT NULL, \
      `is_printed` INTEGER DEFAULT NULL, \
      `printed_at` INTEGER DEFAULT NULL, \
      `raw_text` mediumtext, \
      `added_on` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP, \
      PRIMARY KEY("id" AUTOINCREMENT) \
      );');

    database.run('CREATE TABLE IF NOT EXISTS `raw_data` ( \
      `id` INTEGER NOT NULL, \
      `data` mediumtext NOT NULL, \
      `machine` TEXT NOT NULL, \
      `added_on` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP, \
      PRIMARY KEY("id" AUTOINCREMENT) \
      );');

    database.run('CREATE TABLE IF NOT EXISTS `app_log` ( \
      `id` INTEGER NOT NULL, \
      `log` TEXT NOT NULL, \
      `added_on` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP, \
      PRIMARY KEY("id" AUTOINCREMENT) \
      );');

    database.run('PRAGMA journal_mode = WAL;');

    ipcMain.on('sqlite3-query', (event, sql, args) => {
      // event.reply('sqlite3-reply', sql);
      // event.reply('sqlite3-reply', database);
      if (args === null || args === undefined) {
        database.all(sql, (err, rows) => {
          event.reply('sqlite3-reply', (err && err.message) || rows);
        });
      } else {
        database.all(sql, args, (err, rows) => {
          event.reply('sqlite3-reply', (err && err.message) || rows);
        });
      }
    });


  });

} catch (e) {
  // Catch Error
  // throw e;
}
