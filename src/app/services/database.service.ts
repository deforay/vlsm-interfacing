import { Injectable, } from '@angular/core';
import { ElectronService } from '../core/services';
import { ElectronStoreService } from './electron-store.service';
import { CryptoService } from './crypto.service'
import * as path from 'path';
import * as fs from 'fs';

@Injectable({
  providedIn: 'root'
})
export class DatabaseService {

  private mysqlPool = null;
  private dbConfig = null;
  private commonSettings = null;
  private migrationDir: string; // Path for migrations
  private hasRunMigrations = false;

  constructor(private readonly electronService: ElectronService,
    private readonly store: ElectronStoreService,
    private readonly cryptoService: CryptoService
  ) {
    const that = this;
    that.store.electronStoreObservable().subscribe(config => {
      that.commonSettings = config.commonConfig;
      that.init();
    });
  }


  private async init() {
    const that = this;
    console.log('Initializing database service...');
    const mysql = that.electronService.mysql;

    // Fetch the userData path from Electron
    const userDataPath = await that.electronService.getUserDataPath();
    that.migrationDir = path.join(userDataPath, 'mysql-migrations');
    console.log('User Data Path:', userDataPath);

    // Ensure mysqlPool and dbConfig are not initialized multiple times
    if (!that.mysqlPool && that.commonSettings?.mysqlHost && that.commonSettings?.mysqlUser && that.commonSettings?.mysqlDb) {

      that.dbConfig = {
        connectionLimit: 10,
        waitForConnections: true,
        queueLimit: 0,
        acquireTimeout: 10000,
        connectTimeout: 10000,
        timeout: 600,
        host: that.commonSettings.mysqlHost,
        user: that.commonSettings.mysqlUser,
        password: that.cryptoService.decrypt(that.commonSettings.mysqlPassword),
        database: that.commonSettings.mysqlDb,
        port: that.commonSettings.mysqlPort,
        dateStrings: 'date'
      };

      that.mysqlPool = mysql.createPool(that.dbConfig);

      that.mysqlPool.on('connection', (connection) => {
        console.log('MySQL connection established, running migrations if necessary.');
        connection.query("SET SESSION sql_mode=(SELECT REPLACE(@@sql_mode, 'ONLY_FULL_GROUP_BY', ''))");
        connection.query("SET SESSION INTERACTIVE_TIMEOUT=600");
        connection.query("SET SESSION WAIT_TIMEOUT=600");

        that.checkAndRunMigrations(connection);
      });
    } else {
      console.warn('MySQL Pool or configuration is already initialized or incomplete.');
    }
  }

  public checkMysqlConnection(
    mysqlParams?: { host?: string, user?: string, password?: string, port?: string },
    successCallback?: Function,
    errorCallback?: Function
  ): void {
    const that = this;
    const mysql = that.electronService.mysql;

    const connection = mysql.createConnection({
      host: mysqlParams?.host ?? that.commonSettings.mysqlHost,
      user: mysqlParams?.user ?? that.commonSettings.mysqlUser,
      password: that.cryptoService.decrypt(mysqlParams?.password ?? that.commonSettings.mysqlPassword),
      port: mysqlParams?.port ?? that.commonSettings.mysqlPort
    });

    connection.connect((err: any) => {
      if (err) {
        if (errorCallback) errorCallback(err); // Check if errorCallback exists
      } else {
        if (successCallback) successCallback(); // Check if successCallback exists
        connection.destroy();
      }
    });
  }

  private checkAndRunMigrations(connection) {
    const that = this;
    if (that.hasRunMigrations) {
      console.log('Migrations already run, skipping...');
      return;
    }
    that.hasRunMigrations = true;

    console.log('Checking and running migrations...');
    connection.query('CREATE TABLE IF NOT EXISTS versions (id INT AUTO_INCREMENT PRIMARY KEY, version INT NOT NULL)ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;', (err) => {
      if (err) {
        console.error('Error creating versions table:', err);
        return;
      }
      that.getCurrentVersion(connection, (currentVersion: number) => {
        console.log(`Current DB version: ${currentVersion}`); // Log the current version before running migrations
        that.runMigrations(connection, currentVersion);
      });
    });
  }

  private getCurrentVersion(connection: any, callback: any) {
    connection.query('SELECT MAX(version) AS version FROM versions', (err: any, results: any) => {
      if (err) {
        console.error('Error fetching current version:', err);
        callback(0);  // Return 0 if there's an error fetching the version
      } else {
        const currentVersion = results[0]?.version || 0;
        console.log('Fetched current version:', currentVersion);
        callback(currentVersion);
      }
    });
  }
  private runMigrations(connection: any, currentVersion: number) {
    const that = this;
    console.log('Starting migrations...');
    const migrationFiles = fs.readdirSync(that.migrationDir).filter(file => file.endsWith('.sql'));
    const sortedMigrations = migrationFiles
      .map(file => ({ version: parseInt(file.replace('.sql', ''), 10), file }))
      .filter(migration => migration.version > currentVersion)
      .sort((a, b) => a.version - b.version);

    if (sortedMigrations.length === 0) {
      console.log('No new migrations to apply.');
      return;
    }

    const runNextMigration = (index: number) => {
      if (index < sortedMigrations.length) {
        const { version, file } = sortedMigrations[index];
        console.log(`Applying migration ${version} from file ${file}`);  // Added log for visibility
        const filePath = path.join(that.migrationDir, file);
        const sql = fs.readFileSync(filePath, 'utf8');

        // Run all SQL statements from the file
        that.runSqlStatements(connection, sql, () => {
          console.log(`Migration ${version} APPLYING`);
          // After all SQL statements from the file have been processed, insert the version number
          connection.query('INSERT INTO versions (version) VALUES (?)', [version], (err) => {
            if (err) {
              console.error(`Error recording migration version ${version}:`, err);
            } else {
              console.log(`Migration ${version} applied successfully and recorded in versions table.`);
            }
            runNextMigration(index + 1); // Move to the next migration file
          });
        });
      } else {
        console.log('All migrations applied.');
      }
    };

    runNextMigration(0);
  }

  private runSqlStatements(connection: any, sql: string, callback: any) {
    const statements = sql.split(';').map(stmt => stmt.trim()).filter(stmt => stmt.length > 0);

    const runNextStatement = (index) => {
      if (index < statements.length) {
        connection.query(statements[index], (err) => {
          if (err) {
            // Log the error but continue processing the next statement
            console.warn(`Error running SQL statement: ${statements[index]}`, err.message);
          }
          runNextStatement(index + 1); // Continue with the next statement
        });
      } else {
        callback(); // All statements processed, proceed to the next migration file
      }
    };

    runNextStatement(0);
  }



  execQuery(query: string, data: any, success: any, errorf: any, callback = null) {
    if (!this.mysqlPool) {
      errorf({ error: 'Database Connection not found' });
      return;
    }

    this.mysqlPool.getConnection((err, connection) => {
      if (err) {
        errorf(err);
        return;
      }

      connection.query({ sql: query }, data, (queryError, results) => {
        if (queryError) {
          connection.release();
          errorf(queryError);
          return;
        }

        // If a callback is provided, use it and let it handle the connection release
        if (callback) {
          callback(results, error => {
            connection.release();
            if (error) {
              errorf(error);
            } else {
              success(results);
            }
          });
        } else {
          // If no callback, handle success and release the connection
          success(results);
          connection.release();
        }
      });
    });
  }


  recordTestResults(data: any, success: any, errorf: any) {
    const placeholders = Object.values(data).map(() => '?').join(',');
    const mysqlQuery = 'INSERT INTO orders (' + Object.keys(data).join(',') + ') VALUES (' + placeholders + ')';

    const handleSQLiteInsert = (mysqlInserted: boolean) => {
      data.mysql_inserted = mysqlInserted ? 1 : 0;
      const sqlitePlaceholders = Object.values(data).map(() => '?').join(',');
      const sqliteQuery = `INSERT INTO orders (${Object.keys(data).join(',')}, mysql_inserted) VALUES (${sqlitePlaceholders}, ?)`;
      this.electronService.execSqliteQuery(sqliteQuery, [...Object.values(data), data.mysql_inserted])
        .then(success)
        .catch(errorf);
    };

    this.checkMysqlConnection(null, () => {
      // MySQL connected
      this.execQuery(mysqlQuery, [...Object.values(data)],
        () => handleSQLiteInsert(true),
        (mysqlError) => {
          handleSQLiteInsert(false);
          console.error('Error inserting record into MySQL:', mysqlError);
        }
      );
    }, (err) => {
      // MySQL connection failed, insert into SQLite
      console.error('MySQL connection failed, insert into SQLite:', err.message);
      handleSQLiteInsert(false);
    });
  }


  resyncTestResultsToMySQL(success: any, errorf: any) {
    const sqliteQuery = 'SELECT * FROM orders WHERE mysql_inserted = 0';

    this.electronService.execSqliteQuery(sqliteQuery, [])
      .then((records) => {
        if (records.length === 0) {
          success('No records to resync.');
          return;
        }

        this.processResyncRecords(records, success, errorf);
      })
      .catch((err: any) => {
        errorf('Error fetching records from SQLite:', err);
      });
  }

  private processResyncRecords(records: any[], success: any, errorf: any) {
    records.forEach((record: any) => {
      // Exclude `mysql_inserted` from the record before inserting into MySQL
      const mysqlRecord = { ...record };
      delete mysqlRecord.mysql_inserted;
      delete mysqlRecord.id;

      const placeholders = Object.values(mysqlRecord).map(() => '?').join(',');
      const t = 'INSERT INTO orders (' + Object.keys(mysqlRecord).join(',') + ') VALUES (' + placeholders + ')';

      this.execQuery(t, Object.values(mysqlRecord),
        () => this.updateSQLiteAfterMySQLInsert(record),
        (mysqlError: any) => {
          console.error('Error inserting record into MySQL:', mysqlError);
          // No need to update SQLite as the mysql_inserted is already 0
        }
      );
    });

    success('Resync process completed.');
  }


  private updateSQLiteAfterMySQLInsert(record: any) {
    const updateQuery = 'UPDATE orders SET mysql_inserted = 1 WHERE order_id = ?';
    this.electronService.execSqliteQuery(updateQuery, [record.order_id])
      .then(() => {
        console.log('Record successfully resynced and updated in SQLite:', record.order_id);
      })
      .catch((error: any) => {
        console.error('Error updating SQLite after successful MySQL insert:', error);
      });
  }

  fetchrawData(success: any, errorf: any, searchParam = '') {
    const that = this;
    let recentRawDataQuery = 'SELECT * FROM `raw_data` ';

    if (searchParam) {
      const columns = [
        'machine', 'added_on', 'date'
      ];
      const searchConditions = columns.map(col => `${col} LIKE '%${searchParam}%'`).join(' OR ');
      recentRawDataQuery += ` WHERE ${searchConditions}`;
    }
    recentRawDataQuery += ' ORDER BY added_on DESC LIMIT 1000';

    this.checkMysqlConnection(null, () => {
      // MySQL connected
      that.execQuery(recentRawDataQuery, null, success, errorf);
    }, (err) => {
      // MySQL connection failed, fallback to SQLite
      console.error('MySQL connection error:', err);
      that.electronService.execSqliteQuery(recentRawDataQuery, null)
        .then(results => success(results))
        .catch(errorf);
    });
  }

  fetchRecentResults(success: any, errorf: any, searchParam = '') {
    let recentResultsQuery = 'SELECT * FROM orders';
    if (searchParam) {
      const columns = [
        'order_id', 'test_id', 'test_type', 'created_date', 'test_unit',
        'results', 'tested_by', 'analysed_date_time', 'specimen_date_time',
        'authorised_date_time', 'result_accepted_date_time', 'machine_used',
        'test_location', 'test_description', 'raw_text', 'added_on',
        'lims_sync_status', 'lims_sync_date_time'
      ];
      const searchConditions = columns.map(col => `${col} LIKE '%${searchParam}%'`).join(' OR ');
      recentResultsQuery += ` WHERE ${searchConditions}`;
    }

    // this.electronService.execSqliteQuery(recentResultsQuery, null)
    //   .then(success)
    //   .catch(errorf);

    this.checkMysqlConnection(null, () => {
      // MySQL is connected, use MySQL
      this.execQuery(recentResultsQuery, null, success, (mysqlError) => {
        console.error('MySQL query error:', mysqlError.message);
        // If MySQL query fails, fallback to SQLite
        this.electronService.execSqliteQuery(recentResultsQuery, null)
          .then(success)
          .catch(errorf);
      });
    }, (err) => {
      // MySQL not connected, fallback to SQLite
      this.electronService.execSqliteQuery(recentResultsQuery, null)
        .then(success)
        .catch(errorf);
    });
  }

  reSyncRecord(orderId: string): void {
    const updateQuery = `UPDATE orders SET lims_sync_status = '0' WHERE order_id = ?`;
    this.execQuery(
      updateQuery,
      [orderId],
      (result) => {
        console.log('Record re-synced successfully:', result);
      },
      (error) => {
        console.error('Error while re-syncing record:', error);
      }
    );
  }

  fetchLastSyncTimes(success, errorf) {
    const that = this;
    const query = 'SELECT MAX(lims_sync_date_time) as lastLimsSync, MAX(added_on) as lastResultReceived FROM `orders`';

    this.checkMysqlConnection(null, () => {
      // MySQL connected
      that.execQuery(query, null, success, errorf);
    }, (err) => {
      // MySQL connection failed, fallback to SQLite
      //console.error('MySQL connection error:', err.message);
      that.electronService.execSqliteQuery(query, null)
        .then(results => success(results))
        .catch(errorf);
    });
  }

  recordRawData(data, success, errorf) {
    // console.log("====== Raw Data ======");
    // console.log(data);
    // console.log(Object.keys(data));
    // console.log(Object.values(data));
    // console.log("======================");
    const that = this;
    const placeholders = Object.values(data).map(() => '?').join(',');
    const sqliteQuery = 'INSERT INTO raw_data (' + Object.keys(data).join(',') + ') VALUES (' + placeholders + ')';
    const mysqlQuery = 'INSERT INTO raw_data (' + Object.keys(data).join(',') + ') VALUES (' + placeholders + ')';

    // Insert into SQLite
    that.electronService.execSqliteQuery(sqliteQuery, Object.values(data))
      .then(sqliteResults => {
        success({ sqlite: sqliteResults });
      })
      .catch(error => {
        console.error('Error inserting into SQLite:', error);
        errorf(error);
      });

    // Try inserting into MySQL if connected
    that.checkMysqlConnection(null, () => {
      that.execQuery(mysqlQuery, Object.values(data), (mysqlResults) => {
        //console.log('MySQL Inserted:', mysqlResults);
      }, (mysqlError) => {
        console.error('Error inserting into MySQL:', mysqlError.message);
      });
    }, (mysqlError) => {
      //console.error('MySQL connection error:', mysqlError.message);
    });
  }

  recordConsoleLogs(data: any, success: any, errorf: any) {
    const that = this;
    const placeholders = Object.values(data).map(() => '?').join(',');
    const sqliteQuery = 'INSERT INTO app_log (' + Object.keys(data).join(',') + ') VALUES (' + placeholders + ')';
    const mysqlQuery = 'INSERT INTO app_log (' + Object.keys(data).join(',') + ') VALUES (' + placeholders + ')';

    // Insert into SQLite first
    that.electronService.execSqliteQuery(sqliteQuery, Object.values(data))
      .then(sqliteResults => {
        success({ sqlite: sqliteResults });
      })
      .catch(error => {
        console.error('Error inserting into SQLite:', error);
        errorf(error);
      });

    // Independently try inserting into MySQL if connected
    that.checkMysqlConnection(null, () => {
      that.execQuery(mysqlQuery, Object.values(data), (mysqlResults) => {
        //console.log('MySQL Inserted:', mysqlResults);
      }, (mysqlError) => {
        console.error('Error inserting into MySQL:', mysqlError);
      });
    }, (mysqlError) => {
      //console.error('MySQL connection error:', mysqlError);
    });
  }

  fetchRecentLogs(instrumentId = null, success = null, errorf = null) {
    let recentLogsQuery: string;
    const that = this;

    if (instrumentId) {
      // Adjust the SQL query to filter by instrumentId
      recentLogsQuery = 'SELECT * FROM app_log WHERE log like ? ORDER BY added_on DESC, id DESC LIMIT 500';
    } else {
      // If no instrumentId is provided, fetch all logs
      recentLogsQuery = 'SELECT * FROM app_log ORDER BY added_on DESC, id DESC LIMIT 500';
    }

    const sqliteArgs = instrumentId ? [`%[${instrumentId}]%`] : [];

    that.electronService.execSqliteQuery(recentLogsQuery, sqliteArgs)
      .then((results) => { success(results); })
      .catch((err) => { if (errorf) errorf(err); });

    // that.checkMysqlConnection(null, () => {
    //   // If MySQL is connected, execute the query in MySQL
    //   that.execQuery(recentLogsQuery, sqliteArgs.length ? sqliteArgs : null, success, (err) => {
    //     console.error('Error fetching from MySQL:', err.message);
    //     // On MySQL error, fallback to SQLite
    //     that.electronService.execSqliteQuery(recentLogsQuery, sqliteArgs)
    //       .then((results) => { success(results); })
    //       .catch((err) => { if (errorf) errorf(err); });
    //   });
    // }, () => {
    //   // If MySQL is not connected, fetch from SQLite
    //   that.electronService.execSqliteQuery(recentLogsQuery, sqliteArgs)
    //     .then((results) => { success(results); })
    //     .catch((err) => { if (errorf) errorf(err); });
    // });
  }

  /**
   * Fetches an order that is ready to be sent.
   */
  getOrdersToSend(success = null, errorf = null) {
    const that = this;
    const query = 'SELECT * FROM orders WHERE result_status = 99 ORDER BY created_date ASC';

    that.execQuery(query, [],
      (results) => {
        if (results.length > 0) {
          success(results); // Assuming execQuery returns an array of results
        } else {
          success(null); // No orders to send
        }
      },
      (err: any) => {
        errorf(err);
      }
    );
  }



}
