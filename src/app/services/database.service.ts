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
  public commonSettings = null;
  private migrationDir: string; // Path for migrations
  private hasRunMigrations = false;

  constructor(private readonly electronService: ElectronService,
    private readonly store: ElectronStoreService,
    private readonly cryptoService: CryptoService
  ) {

    this.store.electronStoreObservable().subscribe(config => {
      this.commonSettings = config.commonConfig;
      this.init();
    });
  }


  private async init() {
    console.log('Initializing database service...');
    const mysql = this.electronService.mysql;

    // Fetch the userData path from Electron
    const userDataPath = await this.electronService.getUserDataPath();
    this.migrationDir = path.join(userDataPath, 'mysql-migrations');
    console.log('User Data Path:', userDataPath);

    // Ensure mysqlPool and dbConfig are not initialized multiple times
    if (!this.mysqlPool && this.commonSettings?.mysqlHost && this.commonSettings?.mysqlUser && this.commonSettings?.mysqlDb) {
      let decryptedPassword = this.commonSettings.mysqlPassword;
      decryptedPassword = this.cryptoService.decrypt(decryptedPassword);

      this.dbConfig = {
        connectionLimit: 10,
        waitForConnections: true,
        queueLimit: 0,
        acquireTimeout: 10000,
        connectTimeout: 10000,
        timeout: 600,
        host: this.commonSettings.mysqlHost,
        user: this.commonSettings.mysqlUser,
        password: decryptedPassword,
        database: this.commonSettings.mysqlDb,
        port: this.commonSettings.mysqlPort,
        dateStrings: 'date'
      };

      this.mysqlPool = mysql.createPool(this.dbConfig);

      this.mysqlPool.on('connection', (connection) => {
        console.log('MySQL connection established, running migrations if necessary.');
        connection.query("SET SESSION sql_mode=(SELECT REPLACE(@@sql_mode, 'ONLY_FULL_GROUP_BY', ''))");
        connection.query("SET SESSION INTERACTIVE_TIMEOUT=600");
        connection.query("SET SESSION WAIT_TIMEOUT=600");

        this.checkAndRunMigrations(connection);
      });
    } else {
      console.warn('MySQL Pool or configuration is already initialized or incomplete.');
    }
  }

  private checkAndRunMigrations(connection) {
    if (this.hasRunMigrations) {
      console.log('Migrations already run, skipping...');
      return;
    }
    this.hasRunMigrations = true;

    console.log('Checking and running migrations...');
    connection.query('CREATE TABLE IF NOT EXISTS versions (id INT AUTO_INCREMENT PRIMARY KEY, version INT NOT NULL)ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;', (err) => {
      if (err) {
        console.error('Error creating versions table:', err);
        return;
      }
      this.getCurrentVersion(connection, (currentVersion: number) => {
        console.log(`Current DB version: ${currentVersion}`); // Log the current version before running migrations
        this.runMigrations(connection, currentVersion);
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
    console.log('Starting migrations...');
    const migrationFiles = fs.readdirSync(this.migrationDir).filter(file => file.endsWith('.sql'));
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
        const filePath = path.join(this.migrationDir, file);
        const sql = fs.readFileSync(filePath, 'utf8');

        // Run all SQL statements from the file
        this.runSqlStatements(connection, sql, () => {
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
      errorf({ error: 'Database not found' });
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

    // console.log('SQL Query:', mysqlQuery);
    // console.log('SQL Data:');
    // Object.entries(data).forEach(([key, value]) => {
    //   console.log(`${key}:`, value);
    // });

    const handleSQLiteInsert = (mysqlInserted: any) => {
      console.log('MySQL Inserted:', mysqlInserted);
      data.mysql_inserted = mysqlInserted ? 1 : 0;
      const placeholders = Object.values(data).map(() => '?').join(',');
      const sqliteQuery = `INSERT INTO orders (${Object.keys(data).join(',')}) VALUES (${placeholders}, ?, ?)`;
      this.electronService.execSqliteQuery(sqliteQuery, [...Object.values(data)])
        .then(success)
        .catch(errorf);
      console.log('SQLite Query:', sqliteQuery);
    };


    if (this.mysqlPool != null) {
      this.execQuery(mysqlQuery, [...Object.values(data)],
        () => handleSQLiteInsert(true),
        (mysqlError) => {
          handleSQLiteInsert(false);
          console.error('Error inserting record into MySQL:', mysqlError);
          // No need to update SQLite as the mysql_inserted is already 0
        }
      );
    } else {
      handleSQLiteInsert(false);
    }
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
      const placeholders = Object.values(record).map(() => '?').join(',');
      const t = 'INSERT INTO orders (' + Object.keys(record).join(',') + ') VALUES (' + placeholders + ')';

      this.execQuery(t, Object.values(record),
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

  // fetchrawData(success, errorf) {
  //   const that = 'SELECT * FROM raw_data ORDER BY added_on DESC';
  //   if (this.mysqlPool != null) {
  //     this.execQuery(that, null, success, errorf);
  //   } else {
  //     (this.electronService.execSqliteQuery(that, null)).then((results) => { success(results) });
  //   }
  // }

  // fetchLastOrders(success, errorf) {
  //   const t = 'SELECT * FROM orders ORDER BY added_on DESC LIMIT 1000';
  //   if (this.mysqlPool != null) {
  //     this.execQuery(t, null, success, errorf);
  //   } else {
  //     // Fetching from SQLITE
  //     (this.electronService.execSqliteQuery(t, null)).then((results) => { success(results) });
  //   }
  // }
  fetchrawData(success: any, errorf: any, searchParam = '') {
    let that = 'SELECT * FROM raw_data';

    if (searchParam) {
      const columns = [
        'machine', 'added_on', 'date'
      ];
      const searchConditions = columns.map(col => `${col} LIKE '%${searchParam}%'`).join(' OR ');
      that += `WHERE ${searchConditions}`;
    }
    that += ' ORDER BY added_on DESC LIMIT 1000';
    if (this.mysqlPool != null) {
      this.execQuery(that, null, success, errorf);
    } else {

      this.electronService.execSqliteQuery(that, null).then((results) => { success(results) });
    }
  }

  fetchLastOrders(success: any, errorf: any, searchParam = '') {
    let t = 'SELECT * FROM orders';

    if (searchParam) {
      const columns = [
        'order_id', 'test_id', 'test_type', 'created_date', 'test_unit',
        'results', 'tested_by', 'analysed_date_time', 'specimen_date_time',
        'authorised_date_time', 'result_accepted_date_time', 'machine_used',
        'test_location', 'test_description', 'raw_text', 'added_on', 'lims_sync_status', 'lims_sync_date_time'
      ];
      const searchConditions = columns.map(col => `${col} LIKE '%${searchParam}%'`).join(' OR ');
      t += ` WHERE ${searchConditions}`;
    }

    t += ' ORDER BY added_on DESC LIMIT 1000';

    if (this.mysqlPool != null) {
      this.execQuery(t, null, success, errorf);
    } else {
      // Fetching from SQLITE
      this.electronService.execSqliteQuery(t, null).then((results) => { success(results) });
    }
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
    const t = 'SELECT MAX(lims_sync_date_time) as lastLimsSync, MAX(added_on) as lastResultReceived FROM `orders`';

    if (this.mysqlPool != null) {
      this.execQuery(t, null, success, errorf);
    } else {
      // Fetching from SQLITE
      (this.electronService.execSqliteQuery(t, null)).then((results) => { success(results) });
    }
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

    const placeholders = Object.values(data).map(() => '?').join(',');
    const t = 'INSERT INTO raw_data (' + Object.keys(data).join(',') + ') VALUES (' + placeholders + ')';

    if (this.mysqlPool != null) {
      this.execQuery(t, Object.values(data), success, errorf);
    }
    (this.electronService.execSqliteQuery(t, Object.values(data))).then((results) => { success(results) });
  }

  addApplicationLog(data, success, errorf) {

    const placeholders = Object.values(data).map(() => '?').join(',');
    const t = 'INSERT INTO app_log (' + Object.keys(data).join(',') + ') VALUES (' + placeholders + ')';

    if (this.mysqlPool != null) {
      this.execQuery(t, Object.values(data), success, errorf);
    }
    (this.electronService.execSqliteQuery(t, Object.values(data))).then((results) => { success(results) });
  }

  fetchRecentLogs(instrumentId = null, success = null, errorf = null) {
    let query;
    if (instrumentId) {
      // Adjust the SQL query to filter by instrumentId
      query = 'SELECT * FROM app_log WHERE log like "%[' + instrumentId + ']%" ORDER BY added_on DESC, id DESC LIMIT 500';
    } else {
      // If no instrumentId is provided, fetch all logs
      query = 'SELECT * FROM app_log ORDER BY added_on DESC, id DESC LIMIT 500';
    }
    if (this.mysqlPool != null) {
      // Execute query with MySQL
      this.execQuery(query, null, success, errorf);
    } else {
      // Execute query with SQLite
      this.electronService.execSqliteQuery(query, [instrumentId])
        .then((results) => { success(results) })
        .catch((err) => { if (errorf) errorf(err); });
    }
  }

  /**
   * Fetches an order that is ready to be sent.
   */
  getOrdersToSend(success = null, errorf = null) {
    const query = 'SELECT * FROM orders WHERE result_status = 99 ORDER BY created_date ASC';

    this.execQuery(query, [],
      (results) => {
        if (results.length > 0) {
          success(results); // Assuming execQuery returns an array of results
        } else {
          success(null); // No orders to send
        }
      },
      (err) => {
        errorf(err);
      }
    );
  }



}
