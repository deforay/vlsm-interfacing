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
    //console.log('User Data Path:', userDataPath);

    // Ensure mysqlPool and dbConfig are not initialized multiple times
    if (!that.mysqlPool && that.commonSettings?.mysqlHost && that.commonSettings?.mysqlUser && that.commonSettings?.mysqlDb) {

      that.dbConfig = {
        connectionLimit: 10,
        waitForConnections: true,
        queueLimit: 0,
        acquireTimeout: 10000,
        connectTimeout: 10000,
        timeout: 600,
        enableKeepAlive: true,
        host: that.commonSettings.mysqlHost,
        user: that.commonSettings.mysqlUser,
        password: that.cryptoService.decrypt(that.commonSettings.mysqlPassword),
        database: that.commonSettings.mysqlDb,
        port: that.commonSettings.mysqlPort,
        dateStrings: 'date'
      };

      that.mysqlPool = mysql.createPool(that.dbConfig);

      console.log('MySQL pool created, waiting for connection...');

      that.mysqlPool.on('connection', (connection) => {
        console.log('MySQL connection established, running migrations if necessary.');
        connection.query("SET SESSION sql_mode=(SELECT REPLACE(@@sql_mode, 'ONLY_FULL_GROUP_BY', ''))");
        connection.query("SET SESSION INTERACTIVE_TIMEOUT=600");
        connection.query("SET SESSION WAIT_TIMEOUT=600");

        that.checkAndRunMigrations(connection);
      });

      that.mysqlPool.on('error', (err) => {
        console.error('MySQL pool error:', err);
      });

    } else {
      //console.warn('MySQL Pool or configuration is already initialized or incomplete.');
    }
  }

  public sqlite3WalCheckpoint(): void {
    const that = this;

    // Run a checkpoint to merge WAL file changes back into the main database file
    // This helps prevent the WAL file from growing too large
    that.electronService.executeSqliteWalCheckpoint()
      .then((result) => {
        console.log('SQLite WAL checkpoint completed successfully:', result);
      })
      .catch((error) => {
        console.error('Error running SQLite WAL checkpoint:', error);
      });
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

  /**
   * Checks if migrations have been run and executes them if not.
   * This method is called automatically when the MySQL connection is established.
   */
  private async checkAndRunMigrations(connection) {
    const that = this;
    if (that.hasRunMigrations) {
      console.log('Migrations already run, skipping...');
      return;
    }
    that.hasRunMigrations = true;

    console.log('Running MySQL migrations via DatabaseService...');

    try {
      // Get the migration directory path
      const userDataPath = await that.electronService.getUserDataPath();
      const migrationDir = path.join(userDataPath, 'mysql-migrations');

      // Check if migration directory exists
      if (!that.electronService.fs.existsSync(migrationDir)) {
        console.log('No migration directory found, skipping migrations');
        return;
      }

      // Get migration files
      const migrationFiles = that.electronService.fs.readdirSync(migrationDir)
        .filter(file => file.endsWith('.sql'))
        .sort(); // Sort to ensure migrations run in order

      if (migrationFiles.length === 0) {
        console.log('No migration files found');
        return;
      }

      console.log(`Found ${migrationFiles.length} migration files:`, migrationFiles);

      // Create versions table if it doesn't exist
      const createVersionsTable = `
      CREATE TABLE IF NOT EXISTS versions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        version INT NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

      await that.execQueryPromise(createVersionsTable, []);

      // Get already executed migrations
      const executedResults = await that.execQueryPromise('SELECT version FROM versions', []);
      const executedVersions = executedResults.map((row: any) => row.version);

      // Parse migration files to get versions
      const migrations = migrationFiles
        .map(file => ({
          version: parseInt(file.replace('.sql', ''), 10),
          file: file
        }))
        .filter(migration => !isNaN(migration.version) && !executedVersions.includes(migration.version))
        .sort((a, b) => a.version - b.version);

      if (migrations.length === 0) {
        console.log('All migrations already executed');
        return;
      }

      console.log(`Executing ${migrations.length} pending migrations:`, migrations.map(m => m.file));

      // Execute migrations sequentially
      for (const migration of migrations) {
        try {
          const migrationPath = path.join(migrationDir, migration.file);
          const migrationSql = that.electronService.fs.readFileSync(migrationPath, 'utf8');

          console.log(`Executing migration: ${migration.file}`);

          // Split SQL into individual statements
          const statements = migrationSql
            .split(';')
            .map(stmt => stmt.trim())
            .filter(stmt => stmt.length > 0);

          // Execute all statements in the migration file
          for (const statement of statements) {
            try {
              await that.execQueryPromise(statement, []);
            } catch (err) {
              console.warn(`Warning in statement of ${migration.file}:`, err.message);
              // Continue with next statement even if one fails
            }
          }

          // Record the migration as completed
          await that.execQueryPromise('INSERT INTO versions (version) VALUES (?)', [migration.version]);
          console.log(`Migration ${migration.file} completed successfully`);

        } catch (err) {
          console.error(`Error executing migration ${migration.file}:`, err);
          throw err;
        }
      }

      console.log('All migrations completed successfully');

    } catch (error) {
      console.error('Error during migration process:', error);
      throw error;
    }
  }

  // Helper method to convert execQuery to Promise-based:
  private execQueryPromise(query: string, data: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      this.execQuery(query, data, resolve, reject);
    });
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
    // Ensure instrument_id is set if not already present
    if (!data.instrument_id && data.machine_used) {
      data.instrument_id = data.machine_used;
    }

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
        'machine', 'instrument_id', 'added_on', 'data'
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

    this.electronService.execSqliteQuery(recentResultsQuery, null)
      .then(success)
      .catch(errorf);

    // this.checkMysqlConnection(null, () => {
    //   // MySQL is connected, use MySQL
    //   this.execQuery(recentResultsQuery, null, success, (mysqlError) => {
    //     console.error('MySQL query error:', mysqlError.message);
    //     // If MySQL query fails, fallback to SQLite
    //     this.electronService.execSqliteQuery(recentResultsQuery, null)
    //       .then(success)
    //       .catch(errorf);
    //   });
    // }, (err) => {
    //   // MySQL not connected, fallback to SQLite
    //   this.electronService.execSqliteQuery(recentResultsQuery, null)
    //     .then(success)
    //     .catch(errorf);
    // });
  }

  reSyncRecord(orderId: string): void {
    const updateQuery = `UPDATE orders SET lims_sync_status = '0', lims_sync_date_time = CURRENT_TIMESTAMP WHERE order_id = ?`;
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

  syncLimsStatusToSQLite(success: any, errorf: any) {
    const that = this;

    // Step 1: Get the maximum `lims_sync_date_time` from SQLite
    const sqliteMaxQuery = 'SELECT MAX(lims_sync_date_time) as maxSyncDate FROM orders';

    that.electronService.execSqliteQuery(sqliteMaxQuery, [])
      .then((sqliteResult: any) => {
        const maxSyncDate = sqliteResult[0]?.maxSyncDate || '0000-00-00 00:00:00'; // Default to the earliest date
        //console.log('SQLite max lims_sync_date_time:', maxSyncDate);

        // Step 2: Query MySQL for records with `lims_sync_date_time` greater than `maxSyncDate`
        const mysqlQuery = `
          SELECT order_id, lims_sync_status, lims_sync_date_time
          FROM orders
          WHERE lims_sync_date_time > ?
          ORDER BY lims_sync_date_time ASC
        `;

        that.checkMysqlConnection(null, () => {
          that.execQuery(mysqlQuery, [maxSyncDate],
            (mysqlResults: any[]) => {
              if (mysqlResults.length === 0) {
                //console.log('No new updates to sync from MySQL to SQLite.');
                success('No updates to sync.');
                return;
              }

              console.log('Records to sync from MySQL to SQLite:', mysqlResults);

              // Step 3: Update SQLite with new data
              const updatePromises = mysqlResults.map(record => {
                const sqliteUpdateQuery = `
                  UPDATE orders
                  SET lims_sync_status = ?, lims_sync_date_time = ?
                  WHERE order_id = ?
                `;
                return that.electronService.execSqliteQuery(sqliteUpdateQuery, [
                  record.lims_sync_status,
                  record.lims_sync_date_time,
                  record.order_id
                ]);
              });

              // Wait for all updates to complete
              Promise.all(updatePromises)
                .then(() => {
                  console.log('Sync from MySQL to SQLite completed successfully.');
                  success('Sync completed.');
                })
                .catch(error => {
                  console.error('Error updating SQLite:', error);
                  errorf(error);
                });
            },
            (mysqlError) => {
              console.error('Error querying MySQL for updates:', mysqlError);
              errorf(mysqlError);
            });
        }, (mysqlConnectionError) => {
          console.error('Error connecting to MySQL:', mysqlConnectionError);
          errorf(mysqlConnectionError);
        });

      })
      .catch((sqliteError: any) => {
        console.error('Error fetching max lims_sync_date_time from SQLite:', sqliteError);
        errorf(sqliteError);
      });
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


  // In database.service.ts, replace the recordRawData method with this version:

  // In database.service.ts, update the recordRawData method:

  recordRawData(data, success, errorf) {
    const that = this;

    const placeholders = Object.values(data).map(() => '?').join(',');
    const sqliteQuery = 'INSERT INTO raw_data (' + Object.keys(data).join(',') + ') VALUES (' + placeholders + ')';
    const mysqlQuery = 'INSERT INTO raw_data (' + Object.keys(data).join(',') + ') VALUES (' + placeholders + ')';

    // Ensure instrument_id is set if not already present
    if (!data.instrument_id && data.machine) {
      data.instrument_id = data.machine;
    }

    // Insert into SQLite first
    that.electronService.execSqliteQuery(sqliteQuery, Object.values(data))
      .then(sqliteResults => {
        // Signal success immediately after SQLite succeeds
        success({ sqlite: sqliteResults });

        // Try MySQL separately (don't call errorf on MySQL failures)
        that.checkMysqlConnection(null,
          // MySQL connection success callback
          () => {
            that.execQuery(mysqlQuery, Object.values(data),
              // MySQL insert success
              () => {
                console.log('MySQL raw data insert successful');
              },
              // MySQL insert error - don't call main errorf since SQLite succeeded
              (mysqlError) => {
                // Just log a simplified error message
                let errorMsg = 'Unknown error';

                // Try to extract a useful message
                try {
                  if (mysqlError === null || mysqlError === undefined) {
                    errorMsg = 'Null or undefined error';
                  } else if (typeof mysqlError === 'string') {
                    errorMsg = mysqlError;
                  } else if (typeof mysqlError === 'object') {
                    if (mysqlError.message) {
                      errorMsg = mysqlError.message;
                    } else {
                      errorMsg = JSON.stringify(mysqlError, null, 2); // <-- Fix here
                    }
                  }
                } catch (e) {
                  errorMsg = 'Error while extracting error message';
                }

                // Log a simple warning without the full object
                console.warn(`MySQL insert warning (non-critical): ${errorMsg}`);
                console.warn('Full MySQL error object:', mysqlError);

              }
            );
          },
          // MySQL connection error - also don't call errorf
          () => {
            // Just log the connection issue
            console.log('MySQL connection unavailable, skipping MySQL insert');
          }
        );
      })
      .catch(sqliteError => {
        // Only call errorf if SQLite insert fails
        console.error('Error inserting into SQLite:', sqliteError);
        errorf(sqliteError);
      });
  }

  recordConsoleLogs(data: any, success: any, errorf: any) {
    const that = this;
    const placeholders = Object.values(data).map(() => '?').join(',');
    const sqliteQuery = 'INSERT INTO app_log (' + Object.keys(data).join(',') + ') VALUES (' + placeholders + ')';
    const mysqlQuery = 'INSERT INTO app_log (' + Object.keys(data).join(',') + ') VALUES (' + placeholders + ')';

    // Insert into SQLite first
    that.electronService.execSqliteQuery(sqliteQuery, Object.values(data))
      .then((sqliteResults: any) => {
        success({ sqlite: sqliteResults });
      })
      .catch((error: any) => {
        console.error('Error inserting into SQLite:', error);
        errorf(error);
      });

    // Independently try inserting into MySQL if connected
    that.checkMysqlConnection(null, () => {
      that.execQuery(mysqlQuery, Object.values(data), (mysqlResults) => {
        //console.log('MySQL Inserted:', mysqlResults);
      }, (mysqlError) => {
        console.error('Error inserting into MySQL:', mysqlError);
        errorf(mysqlError);
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
