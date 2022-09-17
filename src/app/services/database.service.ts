import { Injectable } from '@angular/core';
import { ElectronService } from '../core/services';
import { ElectronStoreService } from './electron-store.service';

@Injectable({
  providedIn: 'root'
})
export class DatabaseService {
  //private settings = null;
  private mysqlPool = null;
  private dbConfig = null;

  constructor(private electronService: ElectronService,
    private store: ElectronStoreService) {

    const mysql = this.electronService.mysql;
    const settings = this.store.get('appSettings');

    // Initialize mysql connection pool only if settings are available
    if (settings.mysqlHost != null && settings.mysqlHost != ''
      && settings.mysqlUser != null && settings.mysqlUser != ''
      && settings.mysqlDb != null && settings.mysqlDb != '') {

      this.dbConfig = {
        connectionLimit: 1000,
        // connectTimeout: 60 * 60 * 1000,
        // acquireTimeout: 60 * 60 * 1000,
        // timeout: 60 * 60 * 1000,
        host: settings.mysqlHost,
        user: settings.mysqlUser,
        password: settings.mysqlPassword,
        database: settings.mysqlDb,
        port: settings.mysqlPort,
        dateStrings: 'date'
      };

      this.mysqlPool = mysql.createPool(this.dbConfig);

      this.execQuery('SET GLOBAL sql_mode = \
                        (SELECT REPLACE(@@sql_mode, "ONLY_FULL_GROUP_BY", ""))', [], (res) => { console.log(res) }, (err) => { console.error(err) });
      this.execQuery('SET GLOBAL CONNECT_TIMEOUT=28800', [], (res) => { console.log(res) }, (err) => { console.error(err) });
      this.execQuery('SET SESSION INTERACTIVE_TIMEOUT = 28800', [], (res) => { console.log(res) }, (err) => { console.error(err) });
      this.execQuery('SET SESSION WAIT_TIMEOUT = 28800', [], (res) => { console.log(res) }, (err) => { console.error(err) });
      this.execQuery('SET SESSION MAX_EXECUTION_TIME = 28800', [], (res) => { console.log(res) }, (err) => { console.error(err) });

    }

  }

  execQuery(query, data, success, errorf) {
    if (this.mysqlPool != null) {
      this.mysqlPool.getConnection((err, connection) => {
        if (err) {
          try {
            connection.release();
          } catch (ex) { }
          errorf(err);
          return;
        }

        connection.query({ sql: query }, data, (errors, results, fields) => {
          if (!errors) { success(results); connection.release(); } else { errorf(errors); connection.release(); }
        });

      });
    } else {
      errorf({ error: 'Please check your database connection' });
    }
  }
  execWithCallback(query, data, success, errorf, callback) {
    if (this.mysqlPool != null) {
      this.mysqlPool.getConnection((err, connection) => {
        if (err) {
          try {
            connection.release();
          } catch (ex) { }
          errorf(err);
          return;
        }
        const sql = connection.query({ sql: query }, data);
        sql.on('result', (result, index) => { success(result); });
        sql.on('error', (err) => { connection.destroy(); errorf(err) });
        sql.on('end', () => {
          if (callback != null) { callback(); }
          if (connection) { connection.destroy(); }
        });
      });
    } else {
      errorf({ error: 'database not found' });
    }
  }

  addOrderTest(data, success, errorf) {
    const t = 'INSERT INTO orders (' + Object.keys(data).join(',') + ') VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
    if (this.mysqlPool != null) {
      this.execQuery(t, Object.values(data), success, errorf);
    }

    (this.electronService.execSqliteQuery(t, Object.values(data))).then((results) => { success(results) });

  }

  fetchLastOrders(success, errorf) {
    const t = 'SELECT * FROM orders ORDER BY added_on DESC LIMIT 1000';
    //this.execQuery(t, null, success, errorf);


    // Fetching from SQLITE
    (this.electronService.execSqliteQuery(t, null)).then((results) => { success(results) });

  }

  addOrderTestLog(data, success, errorf) {
    const t = 'INSERT INTO orders_log (testedBy,units,results,analysedDateTime, ' +
      'specimenDateTime,acceptedDateTime, ' +
      'machineUsed,testLocation,status,orderID,testType,clientID1) ' +
      'VALUES (?,?,?,?,?,?,?,?,?,?,?,?)';
    if (this.mysqlPool != null) {
      this.execQuery(t, data, success, errorf);
    }

    (this.electronService.execSqliteQuery(t, data)).then((results) => { success(results) });

  }

  addResults(data, success, errorf) {
    const t = 'UPDATE orders SET tested_by = ?,test_unit = ?,results = ?,analysed_date_time = ?,specimen_date_time = ? ' +
      ',result_accepted_date_time = ?,machine_used = ?,test_location = ?,result_status = ? ' +
      ' WHERE test_id = ? AND result_status < 1';
    if (this.mysqlPool != null) {
      this.execQuery(t, data, success, errorf);
    }

    (this.electronService.execSqliteQuery(t, data)).then((results) => { success(results) });
  }
  addRawData(data, success, errorf) {
    // console.log("======Raw Data=======");
    // console.log(data);
    // console.log(Object.keys(data));
    // console.log(Object.values(data));
    // console.log("=============");
    const t = 'INSERT INTO raw_data (' + Object.keys(data).join(',') + ') VALUES (?,?)';

    if (this.mysqlPool != null) {
      this.execQuery(t, Object.values(data), success, errorf);
    }


    (this.electronService.execSqliteQuery(t, Object.values(data))).then((results) => { success(results) });


  }


}
