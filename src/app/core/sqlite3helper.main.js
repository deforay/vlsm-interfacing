"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Sqlite3Helper {
    constructor(appUserDataPath) {
        this.registerIpcMain(appUserDataPath);
    }
    registerIpcMain(appUserDataPath) {
        //register to getEvent object for send scraping process status message.
        const { ipcMain } = require('electron');
        const sqlite3 = require('sqlite3');
        const database = new sqlite3.Database(appUserDataPath + '/interfacing.db', (err) => {
            if (err)
                console.error('Database opening error: ', err);
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
        ipcMain.on('sqlite3-query', (event, sql, args) => {
            if (args === null || args === undefined) {
                database.all(sql, (err, rows) => {
                    event.reply('sqlite3-reply', (err && err.message) || rows);
                });
            }
            else {
                database.all(sql, args, (err, rows) => {
                    event.reply('sqlite3-reply', (err && err.message) || rows);
                });
            }
        });
    }
}
exports.default = Sqlite3Helper;
//# sourceMappingURL=sqlite3helper.main.js.map