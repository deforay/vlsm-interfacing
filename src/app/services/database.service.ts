import { Injectable, } from '@angular/core';
import { ElectronService } from '../core/services';
import { ElectronStoreService } from './electron-store.service';
import { CryptoService } from './crypto.service'
import { LoggingService } from './logging.service';
import { Observable, Subject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class DatabaseService {

  private mysqlPool = null;
  private dbConfig = null;
  private commonSettings = null;
  private migrationDir: string; // Path for migrations
  private hasRunMigrations = false;
  private migrationAutoRetryCount = 0;
  // Once the schema-error dialog has been shown (and accepted) in this session,
  // don't show it again — the user is either restarting or has declined.
  private schemaErrorPromptShown = false;
  private static readonly DDL_ERROR_CODES = new Set(['ER_BAD_FIELD_ERROR', 'ER_NO_SUCH_TABLE', 'ER_NO_SUCH_COLUMN']);
  private static readonly DDL_ERROR_PATTERNS = [
    /unknown column/i,
    /table .+ doesn't exist/i,
    /column .+ (cannot be null|doesn't have a default)/i,
  ];
  // SQLite errors look different from MySQL — `no such table: orders`,
  // `no such column: x`, `table orders has no column named x`.
  private static readonly SQLITE_DDL_ERROR_PATTERNS = [
    /no such table/i,
    /no such column/i,
    /has no column named/i,
  ];
  private static readonly MIGRATION_REPLAY_ERROR_CODES = new Set([
    'ER_TABLE_EXISTS_ERROR',
    'ER_CANT_DROP_FIELD_OR_KEY',
    'ER_DUP_FIELDNAME',
    'ER_DUP_ENTRY',
    'ER_DUP_INDEX',
    'ER_DUP_KEYNAME',
    'ER_DUP_UNIQUE',
    'ER_FK_COLUMN_CANNOT_DROP',
    'ER_FK_COLUMN_CANNOT_DROP_CHILD',
    'ER_FK_COLUMN_CANNOT_DROP_PARENT',
    'ER_TABLESPACE_EXISTS',
    'ER_MULTIPLE_PRI_KEY',
  ]);
  private static readonly MIGRATION_REPLAY_ERROR_PATTERNS = [
    /already exists/i,
    /can't drop .+ check that .+ exists/i,
    /cannot drop .+ needed in a foreign key constraint/i,
    /cannot drop index .+ needed in a foreign key constraint/i,
    /duplicate/i,
    /duplicate column name/i,
    /duplicate entry/i,
    /duplicate foreign key constraint name/i,
    /duplicate index/i,
    /duplicate key name/i,
    /duplicate unique/i,
    /foreign key constraint .+ already exists/i,
    /multiple primary key defined/i,
  ];
  private static readonly MYSQL_APP_LOG_RESYNC_BATCH_SIZE = 25;
  private static readonly MYSQL_ORDER_COLUMNS = [
    'instrument_id',
    'order_id',
    'test_id',
    'test_type',
    'created_date',
    'test_unit',
    'results',
    'tested_by',
    'analysed_date_time',
    'specimen_date_time',
    'authorised_date_time',
    'result_accepted_date_time',
    'machine_used',
    'test_location',
    'created_at',
    'result_status',
    'lims_sync_status',
    'lims_sync_date_time',
    'repeated',
    'test_description',
    'is_printed',
    'printed_at',
    'raw_text',
    'added_on',
    'notes',
  ];
  private static readonly SQLITE_ORDER_COLUMNS = [
    ...DatabaseService.MYSQL_ORDER_COLUMNS,
    'mysql_inserted',
  ];
  private static readonly MYSQL_RAW_DATA_COLUMNS = [
    'data',
    'machine',
    'added_on',
    'instrument_id',
  ];
  private static readonly SQLITE_RAW_DATA_COLUMNS = [
    ...DatabaseService.MYSQL_RAW_DATA_COLUMNS,
    'mysql_inserted',
  ];
  private readonly moment = (window as any).require('moment');
  private readonly path: any = (window as any).require('path');

  constructor(private readonly electronService: ElectronService,
    private readonly store: ElectronStoreService,
    private readonly cryptoService: CryptoService,
    private readonly loggingService: LoggingService
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
    that.migrationDir = that.path.join(userDataPath, 'mysql-migrations');
    //console.log('User Data Path:', userDataPath);

    // Ensure mysqlPool and dbConfig are not initialized multiple times
    if (!that.mysqlPool && that.commonSettings?.mysqlHost && that.commonSettings?.mysqlUser && that.commonSettings?.mysqlDb) {

      that.dbConfig = {
        connectionLimit: 10,
        waitForConnections: true,
        queueLimit: 0,
        connectTimeout: 10000,
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

      await that.setupDatabase();

      that.mysqlPool.on('error', (err) => {
        that.logCriticalDatabaseIssue(`MySQL pool error: ${err?.message ?? err}`);
        console.error('MySQL pool error:', err);
      });

    } else {
      //console.warn('MySQL Pool or configuration is already initialized or incomplete.');
    }
  }


  private async setupDatabase(): Promise<void> {
    await this.checkAndRunMigrations(null);
    await this.execQueryPromise("SET SESSION sql_mode=(SELECT REPLACE(@@sql_mode, 'ONLY_FULL_GROUP_BY', ''))", []);
    await this.execQueryPromise("SET SESSION INTERACTIVE_TIMEOUT=600", []);
    await this.execQueryPromise("SET SESSION WAIT_TIMEOUT=600", []);
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
    const forceReplay = await that.isForceMigrationReplayRequested();

    if (that.hasRunMigrations && !forceReplay) {
      console.log('Migrations already run, skipping...');
      return;
    }
    console.log('🚀 Starting MySQL migrations...');
    console.log('Target database:', that.commonSettings.mysqlDb);
    console.log('Migration directory:', that.migrationDir);
    if (forceReplay) {
      console.log('MySQL force replay requested; every migration file will be attempted');
    }

    try {
      // STEP 1: Ensure database exists using a temporary connection (without database parameter)
      console.log('Step 1: Ensuring database exists...');
      try {
        await new Promise<void>((resolve, reject) => {
          const mysql = that.electronService.mysql;
          const tempConnection = mysql.createConnection({
            host: that.commonSettings.mysqlHost,
            user: that.commonSettings.mysqlUser,
            password: that.cryptoService.decrypt(that.commonSettings.mysqlPassword),
            port: that.commonSettings.mysqlPort
          });
          tempConnection.query(
            `CREATE DATABASE IF NOT EXISTS \`${that.commonSettings.mysqlDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
            (err) => {
              tempConnection.destroy();
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            }
          );
        });
        console.log('✅ Database ensured:', that.commonSettings.mysqlDb);
      } catch (createDbError) {
        console.log('ℹ️ Database creation note:', createDbError.message);
        // Continue - database likely already exists, pool will connect to it
      }

      // STEP 2: Check migration directory
      console.log('Step 3: Checking migration directory...');
      if (!that.electronService.fs.existsSync(that.migrationDir)) {
        console.log('ℹ️ Migration directory not found:', that.migrationDir);
        console.log('✅ No migrations to run - continuing...');
        return;
      }

      console.log('✅ Migration directory exists');

      // STEP 4: Get migration files
      const migrationFiles = that.electronService.fs.readdirSync(that.migrationDir)
        .filter(file => file.endsWith('.sql'))
        .sort(); // Sorts alphabetically: 001.sql, 002.sql, 003.sql

      console.log(`Found ${migrationFiles.length} migration files:`, migrationFiles);

      if (migrationFiles.length === 0) {
        console.log('✅ No migration files found - migrations complete');
        return;
      }

      // STEP 5: Create versions tracking table
      console.log('Step 4: Setting up migration tracking...');
      const createVersionsTable = `
      CREATE TABLE IF NOT EXISTS versions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        version INT NOT NULL UNIQUE,
        filename VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_version (version)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

      await that.execQueryPromise(createVersionsTable, []);
      console.log('✅ Versions tracking table ready');

      // STEP 6: Get already executed migrations — self-healing: if versions table is stale/corrupt, reset it
      let executedResults: any[];
      try {
        if (forceReplay) {
          await that.execQueryPromise('DELETE FROM versions', []);
          executedResults = [];
          console.log('✅ MySQL versions table cleared for force replay');
        } else {
          executedResults = await that.execQueryPromise('SELECT version, filename FROM versions ORDER BY version', []);
        }
      } catch (versionsQueryErr) {
        console.warn('⚠️ Versions table query failed, resetting migration tracking:', versionsQueryErr.message);
        await that.execQueryPromise('DROP TABLE IF EXISTS versions', []);
        await that.execQueryPromise(createVersionsTable, []);
        executedResults = [];
        console.log('✅ Versions table reset — all migrations will re-run');
      }
      const executedVersions = executedResults.map((row: any) => row.version);
      console.log('Previously executed versions:', executedVersions);

      await that.ensureMysqlSchemaCompatibility();

      // STEP 7: Identify pending migrations
      const migrations = migrationFiles
        .map(file => ({
          version: parseInt(file.replace('.sql', ''), 10),
          file: file
        }))
        .filter(migration => {
          if (Number.isNaN(migration.version)) {
            console.warn(`⚠️ Skipping file with invalid version number: ${migration.file}`);
            return false;
          }
          return !executedVersions.includes(migration.version);
        })
        .sort((a, b) => a.version - b.version);

      if (migrations.length === 0) {
        console.log('✅ All migrations already executed');
        that.hasRunMigrations = true;
        await that.clearForceMigrationReplayRequest(forceReplay);
        return;
      }

      console.log(`Step 5: Executing ${migrations.length} pending migrations...`);

      // Execute migrations sequentially.
      // WHY: re-runs should tolerate idempotent DDL conflicts, but they must not
      // mark a migration successful when a real statement failed.
      let successCount = 0;
      let hadUnexpectedFailures = false;

      for (const migration of migrations) {
        console.log(`\n--- Executing Migration ${migration.version}: ${migration.file} ---`);

        try {
          const migrationPath = that.path.join(that.migrationDir, migration.file);

          if (!that.electronService.fs.existsSync(migrationPath)) {
            console.log(`ℹ️ Migration file not found, skipping: ${migrationPath}`);
            continue;
          }

          const migrationSql = that.electronService.fs.readFileSync(migrationPath, 'utf8');
          console.log(`📄 Migration size: ${migrationSql.length} characters`);

          const statements = that.extractMigrationStatements(migrationSql);

          console.log(`🔧 Processing ${statements.length} SQL statements...`);

          let migrationHadUnexpectedFailures = false;

          // Permissive mode: log unexpected errors but keep going so one bad
          // statement can't block later repair statements in the same file.
          for (let i = 0; i < statements.length; i++) {
            const statement = statements[i];
            try {
              await that.execQueryPromise(statement, []);
            } catch (stmtErr) {
              if (that.isExpectedMigrationReplayError(stmtErr)) {
                console.warn(`ℹ️ Migration replay note for ${migration.file}: ${stmtErr.message}`);
                continue;
              }

              hadUnexpectedFailures = true;
              migrationHadUnexpectedFailures = true;
              that.logCriticalDatabaseIssue(`Migration ${migration.file} statement ${i + 1} failed (continuing): ${stmtErr.message}`, 'migration');
              console.error(`❌ Migration ${migration.file} statement ${i + 1} failed (continuing):`, stmtErr.message);
            }
          }

          if (migrationHadUnexpectedFailures) {
            console.error(`❌ Migration ${migration.file} had unexpected failures; leaving it pending for retry`);
            continue;
          }

          // Record migration as completed
          try {
            await that.execQueryPromise(
              'INSERT INTO versions (version, filename) VALUES (?, ?)',
              [migration.version, migration.file]
            );
          } catch (versionErr) {
            if (!that.isExpectedMigrationReplayError(versionErr)) {
              hadUnexpectedFailures = true;
              that.logCriticalDatabaseIssue(`Failed to record migration ${migration.file}: ${versionErr.message}`, 'migration');
              console.error(`❌ Failed to record migration ${migration.file}:`, versionErr.message);
              continue;
            }
          }

          console.log(`✅ Migration ${migration.file} completed (${statements.length} statements)`);
          successCount++;

        } catch (err) {
          hadUnexpectedFailures = true;
          that.logCriticalDatabaseIssue(`Migration ${migration.file} skipped: ${err.message}`, 'migration');
          console.log(`ℹ️ Migration ${migration.file} skipped: ${err.message}`);
        }
      }

      // Final summary
      await that.ensureMysqlSchemaCompatibility();
      console.log(`\n🎯 Migration Summary: ${successCount}/${migrations.length} processed`);
      that.hasRunMigrations = !hadUnexpectedFailures;
      if (hadUnexpectedFailures) {
        console.warn('⚠️ MySQL migrations completed with unexpected failures. Pending migrations will retry later.');
      } else {
        that.migrationAutoRetryCount = 0; // Reset so future DDL errors can trigger re-runs again
        await that.clearForceMigrationReplayRequest(forceReplay);
      }

    } catch (error) {
      // Permissive mode - log and continue, but don't set hasRunMigrations so retry is possible
      console.log('ℹ️ Migration process completed with some skipped items');
    }
  }

  private async isForceMigrationReplayRequested(): Promise<boolean> {
    try {
      return await this.electronService.isForceMigrationReplayRequested();
    } catch (err) {
      console.warn('Could not read force migration replay flag:', err);
      return false;
    }
  }

  private async clearForceMigrationReplayRequest(wasForceReplay: boolean): Promise<void> {
    if (!wasForceReplay) {
      return;
    }

    try {
      await this.electronService.clearForceMigrationReplayRequest();
    } catch (err) {
      console.warn('Could not clear force migration replay flag:', err);
    }
  }

  private async ensureMysqlSchemaCompatibility(): Promise<void> {
    await this.ensureMysqlColumn('app_log', 'log_type', 'ALTER TABLE `app_log` ADD COLUMN `log_type` VARCHAR(20) NULL');
    await this.ensureMysqlColumn('app_log', 'log_message', 'ALTER TABLE `app_log` ADD COLUMN `log_message` TEXT NULL');
    await this.ensureMysqlColumn('app_log', 'instrument_id', 'ALTER TABLE `app_log` ADD COLUMN `instrument_id` VARCHAR(255) NULL');
    await this.ensureMysqlColumn('raw_data', 'instrument_id', 'ALTER TABLE `raw_data` ADD COLUMN `instrument_id` VARCHAR(128) NULL');
    await this.ensureMysqlColumn('orders', 'instrument_id', 'ALTER TABLE `orders` ADD COLUMN `instrument_id` VARCHAR(128) NULL');
    await this.ensureMysqlColumn('orders', 'notes', 'ALTER TABLE `orders` ADD COLUMN `notes` TEXT NULL');
  }

  private async ensureMysqlColumn(tableName: string, columnName: string, alterSql: string): Promise<void> {
    const tableExists = await this.mysqlTableExists(tableName);
    if (!tableExists) {
      return;
    }

    const columnExists = await this.mysqlColumnExists(tableName, columnName);
    if (columnExists) {
      return;
    }

    // WHY: older installations can have stale migration history that says a
    // migration ran even though a later column in that file was never added.
    console.warn(`Repairing missing MySQL column ${tableName}.${columnName}`);
    await this.execQueryPromise(alterSql, []);
  }

  private async mysqlTableExists(tableName: string): Promise<boolean> {
    const rows = await this.execQueryPromise(
      'SELECT COUNT(*) AS table_count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      [this.commonSettings.mysqlDb, tableName]
    );
    return Number(rows?.[0]?.table_count ?? 0) > 0;
  }

  private async mysqlColumnExists(tableName: string, columnName: string): Promise<boolean> {
    const rows = await this.execQueryPromise(
      'SELECT COUNT(*) AS column_count FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      [this.commonSettings.mysqlDb, tableName, columnName]
    );
    return Number(rows?.[0]?.column_count ?? 0) > 0;
  }

  private filterRecordColumns(record: any, allowedColumns: readonly string[]): any {
    const filteredRecord: any = {};

    allowedColumns.forEach((columnName) => {
      if (Object.prototype.hasOwnProperty.call(record, columnName)) {
        filteredRecord[columnName] = record[columnName];
      }
    });

    return filteredRecord;
  }

  private buildInsertQuery(tableName: string, record: any): { query: string; values: any[] } {
    const columns = Object.keys(record);
    const placeholders = columns.map(() => '?').join(',');
    const escapedColumns = columns.map(columnName => `\`${columnName}\``).join(',');

    return {
      query: `INSERT INTO \`${tableName}\` (${escapedColumns}) VALUES (${placeholders})`,
      values: Object.values(record),
    };
  }

  private extractMigrationStatements(sql: string): string[] {
    return sql
      .replace(/\/\*[\s\S]*?\*\//g, '\n')
      .split('\n')
      .filter(line => {
        const trimmedLine = line.trim();
        return trimmedLine.length > 0
          && !trimmedLine.startsWith('--')
          && !trimmedLine.startsWith('//');
      })
      .join('\n')
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0)
      .filter(stmt => stmt.toLowerCase() !== 'delimiter');
  }

  private isExpectedMigrationReplayError(error: any): boolean {
    return DatabaseService.MIGRATION_REPLAY_ERROR_CODES.has(error?.code)
      || DatabaseService.MIGRATION_REPLAY_ERROR_PATTERNS.some(pattern => pattern.test(error?.message ?? ''));
  }

  /**
   * Debug method to check migration system status
   */
  public debugMigrationSystem(): void {
    const that = this;

    console.log('\n=== 🔍 MIGRATION DEBUG INFO ===');
    console.log('Migration directory:', that.migrationDir);
    console.log('Directory exists:', that.electronService.fs.existsSync(that.migrationDir));

    if (that.electronService.fs.existsSync(that.migrationDir)) {
      const files = that.electronService.fs.readdirSync(that.migrationDir);
      console.log('All files in directory:', files);

      const sqlFiles = files.filter(f => f.endsWith('.sql'));
      console.log('SQL migration files:', sqlFiles);

      // Show file sizes
      sqlFiles.forEach(file => {
        const filePath = that.path.join(that.migrationDir, file);
        const stats = that.electronService.fs.statSync(filePath);
        console.log(`  ${file}: ${stats.size} bytes`);
      });
    }

    console.log('\nDatabase configuration:');
    console.log('- Host:', that.commonSettings?.mysqlHost);
    console.log('- User:', that.commonSettings?.mysqlUser);
    console.log('- Database:', that.commonSettings?.mysqlDb);
    console.log('- Port:', that.commonSettings?.mysqlPort);
    console.log('- Pool initialized:', !!that.mysqlPool);
    console.log('- Migrations run flag:', that.hasRunMigrations);

    // Test MySQL connection
    console.log('\n🔌 Testing MySQL connection...');
    that.checkMysqlConnection(null,
      () => {
        console.log('✅ MySQL connection: SUCCESS');

        // Check if versions table exists
        that.execQuery('SHOW TABLES LIKE "versions"', [],
          (results) => {
            if (results.length > 0) {
              console.log('✅ Versions table: EXISTS');

              // Show executed migrations
              that.execQuery('SELECT * FROM versions ORDER BY version', [],
                (versions) => {
                  console.log('📋 Executed migrations:', versions);
                },
                (err) => console.log('❌ Error reading versions:', err.message)
              );
            } else {
              console.log('ℹ️ Versions table: NOT FOUND (will be created during migrations)');
            }
          },
          (err) => console.log('ℹ️ Cannot check versions table:', err.message)
        );
      },
      (err) => console.log('❌ MySQL connection: FAILED -', err.message)
    );
  }

  // Helper method to convert execQuery to Promise-based:
  private execQueryPromise(query: string, data: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      this.execQuery(query, data, resolve, reject);
    });
  }

  private logCriticalDatabaseIssue(
    message: string,
    category: 'database' | 'migration' = 'database',
    instrumentId: string | null = null,
    displayInConsole = true
  ): void {
    this.loggingService.log('error', message, instrumentId, {
      category,
      displayInConsole
    });
  }

  private isSqliteDdlError(err: any): boolean {
    const message = (err?.message ?? '').toString();
    return DatabaseService.SQLITE_DDL_ERROR_PATTERNS.some(pattern => pattern.test(message));
  }

  /**
   * Centralized prompt for both SQLite and MySQL schema-out-of-sync errors.
   * Asks the user whether to re-run migrations now (which restarts the app).
   * Once shown in a session, won't re-show until the user cancels — that
   * prevents stacking dialogs when many queries fail in quick succession.
   */
  private async promptSchemaErrorAndRerunIfConfirmed(source: 'MySQL' | 'SQLite', error: any): Promise<void> {
    if (this.schemaErrorPromptShown) {
      return;
    }
    this.schemaErrorPromptShown = true;

    try {
      const result = await this.electronService.ipcRenderer.invoke('show-confirm-dialog', {
        type: 'warning',
        buttons: ['Cancel', 'Re-run Migrations Now'],
        defaultId: 1,
        cancelId: 0,
        title: `Database Schema Issue (${source})`,
        message: `${source} database schema appears to be out of sync.`,
        detail: `Error: ${error?.message ?? error}\n\nClick "Re-run Migrations Now" to force every ${source} migration file to replay. The application will restart after the replay request is saved.`
      });

      if (result?.response === 1) {
        await this.performForceRerunMigrations(source);
      } else {
        // User cancelled — let the prompt fire again later if more DDL errors come in
        this.schemaErrorPromptShown = false;
      }
    } catch (dialogErr) {
      this.schemaErrorPromptShown = false;
      console.error('Failed to show schema error dialog:', dialogErr);
    }
  }

  /**
   * Shared force-rerun routine used by both the Settings button and the
   * automatic schema-error dialog.
   */
  public async performForceRerunMigrations(source: 'MySQL' | 'SQLite' = 'MySQL'): Promise<void> {
    try {
      await this.resetMysqlMigrations();
    } catch (err) {
      if (source === 'MySQL') {
        this.schemaErrorPromptShown = false;
        await this.electronService.ipcRenderer.invoke('show-confirm-dialog', {
          type: 'error',
          buttons: ['OK'],
          defaultId: 0,
          title: 'MySQL Migration Reset Failed',
          message: 'Could not reset MySQL migration history.',
          detail: `Error: ${err?.message ?? err}\n\nThe application was not restarted because MySQL migrations would be skipped again. Check the MySQL connection and try re-running migrations.`
        });
        throw err;
      }

      console.warn('MySQL migration reset failed while repairing SQLite schema:', err);
    }
    await this.electronService.ipcRenderer.invoke('force-rerun-migrations');
  }

  /**
   * Wrapper around ElectronService.execSqliteQuery that intercepts SQLite
   * DDL errors (missing table / column) and prompts the user to re-run
   * migrations. All renderer-side SQLite traffic should go through this so
   * schema drift surfaces consistently for both databases.
   */
  private execSqlite(sql: string, params: any[] = []): Promise<any> {
    return this.electronService.execSqliteQuery(sql, params).catch((err: any) => {
      if (this.isSqliteDdlError(err)) {
        this.logCriticalDatabaseIssue(`SQLite DDL error: ${err?.message ?? err}`, 'database', null, false);
        this.promptSchemaErrorAndRerunIfConfirmed('SQLite', err).catch(() => {});
      }
      throw err;
    });
  }

  execQuery(query: string, data: any, success: any, errorf: any, callback = null, retryAfterSchemaRepair = true) {
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
          // If the error is DDL-related (missing table/column), trigger a migration re-run.
          // Cap at 2 auto-retries per session to prevent infinite loops if a migration can't fix the issue.
          const isDdlError = this.isMysqlDdlError(queryError);
          if (isDdlError) {
            if (retryAfterSchemaRepair) {
              this.repairMysqlSchemaAndRetryQuery(queryError, query, data, success, errorf, callback);
              return;
            }

            if (this.migrationAutoRetryCount < 2) {
              this.migrationAutoRetryCount++;
              this.hasRunMigrations = false;
              this.logCriticalDatabaseIssue(`DDL error (${queryError.code}), migration re-run attempt ${this.migrationAutoRetryCount}/2. Query: ${query}`, 'migration', null, false);
              this.checkAndRunMigrations(null).catch(e => console.error('Auto-migration re-run failed:', e));
            } else {
              // Self-healing exhausted — prompt the user to repair via force-rerun
              this.logCriticalDatabaseIssue(`DDL error persists after ${this.migrationAutoRetryCount} migration re-runs. Query: ${query} | Error: ${queryError.message}`, 'migration', null, false);
              this.promptSchemaErrorAndRerunIfConfirmed('MySQL', queryError).catch(() => {});
            }
          }
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

  private isMysqlDdlError(error: any): boolean {
    return DatabaseService.DDL_ERROR_CODES.has(error?.code)
      || DatabaseService.DDL_ERROR_PATTERNS.some(pattern => pattern.test(error?.message ?? ''));
  }

  private repairMysqlSchemaAndRetryQuery(queryError: any, query: string, data: any, success: any, errorf: any, callback: any): void {
    // WHY: the first failing query is often log/result traffic racing ahead of
    // migration replay. Repair known schema drift immediately, then retry once
    // before falling back to the migration prompt.
    this.logCriticalDatabaseIssue(`MySQL DDL error; repairing schema before retry. Query: ${query} | Error: ${queryError?.message ?? queryError}`, 'migration', null, false);
    this.ensureMysqlSchemaCompatibility()
      .then(() => {
        this.execQuery(query, data, success, errorf, callback, false);
      })
      .catch((repairError) => {
        this.logCriticalDatabaseIssue(`MySQL schema repair failed: ${repairError?.message ?? repairError}. Retrying query: ${query}`, 'migration', null, false);
        this.execQuery(query, data, success, errorf, callback, false);
      });
  }


  recordTestResults(data: any, success: any, errorf: any) {
    const orderData = { ...data };
    // Ensure instrument_id is set if not already present
    if (!orderData.instrument_id && orderData.machine_used) {
      orderData.instrument_id = orderData.machine_used;
    }

    const handleSQLiteInsert = (mysqlInserted: boolean) => {
      const sqliteRecord = this.filterRecordColumns({
        ...orderData,
        mysql_inserted: mysqlInserted ? 1 : 0,
      }, DatabaseService.SQLITE_ORDER_COLUMNS);
      const sqliteInsert = this.buildInsertQuery('orders', sqliteRecord);
      this.execSqlite(sqliteInsert.query, sqliteInsert.values)
        .then(success)
        .catch(errorf);
    };

    this.checkMysqlConnection(null, () => {
      // MySQL connected
      const mysqlRecord = this.filterRecordColumns(orderData, DatabaseService.MYSQL_ORDER_COLUMNS);
      const mysqlInsert = this.buildInsertQuery('orders', mysqlRecord);
      this.execQuery(mysqlInsert.query, mysqlInsert.values,
        () => handleSQLiteInsert(true),
        (mysqlError) => {
          handleSQLiteInsert(false);
          this.logCriticalDatabaseIssue(`Error inserting into MySQL orders: ${mysqlError?.message ?? mysqlError}`, 'database', orderData.instrument_id);
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

    this.execSqlite(sqliteQuery, [])
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
      // WHY: SQLite has local sync metadata that MySQL should never receive.
      const mysqlRecord = this.filterRecordColumns(record, DatabaseService.MYSQL_ORDER_COLUMNS);
      const mysqlInsert = this.buildInsertQuery('orders', mysqlRecord);

      this.execQuery(mysqlInsert.query, mysqlInsert.values,
        () => this.updateSQLiteAfterMySQLInsert(record),
        (mysqlError: any) => {
          this.logCriticalDatabaseIssue(`Error resyncing order ${record.order_id} to MySQL: ${mysqlError?.message ?? mysqlError}`, 'database', record.instrument_id);
        }
      );
    });

    success('Resync process completed.');
  }


  private updateSQLiteAfterMySQLInsert(record: any) {
    const updateQuery = 'UPDATE orders SET mysql_inserted = 1 WHERE order_id = ?';
    this.execSqlite(updateQuery, [record.order_id])
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

    this.checkMysqlConnection(null, () => {
      // MySQL connected
      that.execQuery(recentRawDataQuery, null, success, errorf);
    }, (err) => {
      // MySQL connection failed, fallback to SQLite
      console.error('MySQL connection error:', err);
      that.execSqlite(recentRawDataQuery, null)
        .then(results => success(results))
        .catch(errorf);
    });
  }

  fetchRecentResults(searchParam: string = ''): Observable<any[]> {
    const subject = new Subject<any[]>();
    const trimmedSearchParam = (searchParam || '').trim();

    let recentResultsQuery = 'SELECT * FROM orders';
    let queryParams = [];

    if (trimmedSearchParam !== '') {
      const searchTerm = `%${trimmedSearchParam}%`;
      const columns = [
        'order_id', 'test_id', 'test_type', 'created_date', 'test_unit',
        'results', 'tested_by', 'analysed_date_time', 'specimen_date_time',
        'authorised_date_time', 'result_accepted_date_time', 'machine_used',
        'test_location', 'test_description', 'notes', 'raw_text', 'added_on',
        'lims_sync_status', 'lims_sync_date_time'
      ];
      const searchConditions = columns.map(col => `${col} LIKE ?`).join(' OR ');
      recentResultsQuery += ` WHERE ${searchConditions}`;
      queryParams = new Array(columns.length).fill(searchTerm);
    }

    recentResultsQuery += ' ORDER BY added_on DESC LIMIT 1000';

    this.execSqlite(recentResultsQuery, queryParams)
      .then(results => {
        subject.next(results);
        subject.complete();
      })
      .catch(error => {
        console.error('Database query error:', error);
        subject.error(error);
        subject.complete();
      });

    return subject.asObservable();
  }

  reSyncRecord(orderId: string): Observable<any> {
    const subject = new Subject<any>();
    const updateQuery = `UPDATE orders SET lims_sync_status = '0', lims_sync_date_time = CURRENT_TIMESTAMP WHERE order_id = ?`;
    this.execQuery(
      updateQuery,
      [orderId],
      (result) => {
        console.log('Record re-synced successfully:', result);
        subject.next(result);
        subject.complete();
      },
      (error) => {
        console.error('Error while re-syncing record:', error);
        subject.error(error);
        subject.complete();
      }
    );
    return subject.asObservable();
  }

  syncLimsStatusToSQLite(success: any, errorf: any) {
    const that = this;

    // Step 1: Get the maximum `lims_sync_date_time` from SQLite
    const sqliteMaxQuery = 'SELECT MAX(lims_sync_date_time) as maxSyncDate FROM orders';

    that.execSqlite(sqliteMaxQuery, [])
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
                return that.execSqlite(sqliteUpdateQuery, [
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


  fetchLastSyncTimes(): Observable<any> {
    const subject = new Subject<any>();
    const query = 'SELECT MAX(lims_sync_date_time) as lastLimsSync, MAX(added_on) as lastResultReceived FROM `orders`';

    this.checkMysqlConnection(null, () => {
      this.execQuery(query, null, (res) => {
        subject.next(res[0]);
        subject.complete();
      }, (err) => {
        subject.error(err);
        subject.complete();
      });
    }, (err) => {
      this.execSqlite(query, null)
        .then(res => {
          subject.next(res[0]);
          subject.complete();
        })
        .catch(error => {
          subject.error(error);
          subject.complete();
        });
    });

    return subject.asObservable();
  }


  // In database.service.ts, replace the recordRawData method with this version:

  // In database.service.ts, update the recordRawData method:

  recordRawData(data, success, errorf) {
    const rawData = { ...data };

    const handleSQLiteInsert = (mysqlInserted: boolean) => {
      const sqliteRecord = this.filterRecordColumns({
        ...rawData,
        mysql_inserted: mysqlInserted ? 1 : 0,
      }, DatabaseService.SQLITE_RAW_DATA_COLUMNS);
      const sqliteInsert = this.buildInsertQuery('raw_data', sqliteRecord);
      this.execSqlite(sqliteInsert.query, sqliteInsert.values)
        .then(success)
        .catch(errorf);
    };

    this.checkMysqlConnection(null, () => {
      // MySQL connected
      const mysqlRecord = this.filterRecordColumns(rawData, DatabaseService.MYSQL_RAW_DATA_COLUMNS);
      const mysqlInsert = this.buildInsertQuery('raw_data', mysqlRecord);
      this.execQuery(mysqlInsert.query, mysqlInsert.values,
        () => handleSQLiteInsert(true),
        (mysqlError) => {
          handleSQLiteInsert(false);
          this.logCriticalDatabaseIssue(`Error inserting into MySQL raw_data: ${mysqlError?.message ?? mysqlError}`, 'database', rawData.instrument_id);
        }
      );
    }, (err) => {
      // MySQL connection failed, insert into SQLite
      console.error('MySQL connection failed, insert into SQLite:', err.message);
      handleSQLiteInsert(false);
    });
  }

  resyncRawDataToMySQL(success: any, errorf: any) {
    const sqliteQuery = 'SELECT * FROM raw_data WHERE mysql_inserted = 0';

    this.execSqlite(sqliteQuery, [])
      .then((records) => {
        if (records.length === 0) {
          success('No raw data records to resync.');
          return;
        }

        this.processResyncRawDataRecords(records, success, errorf);
      })
      .catch((err: any) => {
        errorf('Error fetching raw data records from SQLite:', err);
      });
  }

  private processResyncRawDataRecords(records: any[], success: any, errorf: any) {
    records.forEach((record: any) => {
      const mysqlRecord = this.filterRecordColumns(record, DatabaseService.MYSQL_RAW_DATA_COLUMNS);
      const mysqlInsert = this.buildInsertQuery('raw_data', mysqlRecord);

      this.execQuery(mysqlInsert.query, mysqlInsert.values,
        () => this.updateSQLiteAfterMySQLInsertRawData(record),
        (mysqlError: any) => {
          this.logCriticalDatabaseIssue(`Error resyncing raw_data ${record.id} to MySQL: ${mysqlError?.message ?? mysqlError}`, 'database', record.instrument_id);
        }
      );
    });

    success('Raw data resync process completed.');
  }

  private updateSQLiteAfterMySQLInsertRawData(record: any) {
    const updateQuery = 'UPDATE raw_data SET mysql_inserted = 1 WHERE id = ?';
    this.execSqlite(updateQuery, [record.id])
      .then(() => {
        console.log('Raw data record successfully resynced and updated in SQLite:', record.id);
      })
      .catch((error: any) => {
        console.error('Error updating SQLite after successful MySQL insert for raw data:', error);
      });
  }

  recordConsoleLogs(data: any, success: any, errorf: any) {
    const that = this;
    const placeholders = Object.values(data).map(() => '?').join(',');
    const sqliteQuery = 'INSERT INTO app_log (' + Object.keys(data).join(',') + ') VALUES (' + placeholders + ')';
    const mysqlQuery = 'INSERT INTO app_log (' + Object.keys(data).join(',') + ') VALUES (' + placeholders + ')';

    // Insert into SQLite first
    that.execSqlite(sqliteQuery, Object.values(data))
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
        that.logCriticalDatabaseIssue(`Error inserting into MySQL app_log: ${mysqlError?.message ?? mysqlError}`, 'database', data.instrument_id);
        errorf(mysqlError);
      });
    }, (mysqlError) => {
      //console.error('MySQL connection error:', mysqlError);
    });
  }

  async recordLogBatch(logs: any[]): Promise<void> {
    if (!logs || logs.length === 0) {
      return;
    }

    const sqliteQuery = 'INSERT INTO app_log (log, log_type, log_message, instrument_id, added_on, mysql_inserted) VALUES (?, ?, ?, ?, ?, ?)';

    const sqlitePromises = logs.map(log => {
      const params = [log.message, log.type, log.message, log.instrumentId, log.timestamp, 0];
      return this.execSqlite(sqliteQuery, params).catch(e => {
        console.error('SQLite log insert failed', e);
      });
    });

    await Promise.all(sqlitePromises);
    this.resyncAppLogToMySQL(() => { }, () => { });

  }

  resyncAppLogToMySQL(success: any, errorf: any) {
    const sqliteQuery = 'SELECT * FROM app_log WHERE mysql_inserted = 0';

    this.execSqlite(sqliteQuery, [])
      .then((records) => {
        if (records.length === 0) {
          success('No app log records to resync.');
          return;
        }

        this.processResyncAppLogRecords(records, success, errorf);
      })
      .catch((err: any) => {
        errorf('Error fetching app log records from SQLite:', err);
      });
  }

  private processResyncAppLogRecords(records: any[], success: any, errorf: any) {
    const mysqlQuery = 'INSERT INTO app_log (log, log_type, log_message, instrument_id, added_on) VALUES ?';
    const batches = this.chunkArray(records, DatabaseService.MYSQL_APP_LOG_RESYNC_BATCH_SIZE);
    let batchIndex = 0;

    this.checkMysqlConnection(null, () => {
      const processNextBatch = () => {
        const batch = batches[batchIndex];
        if (!batch) {
          success('App log resync process completed.');
          return;
        }

        batchIndex++;
        const mysqlValues = batch.map(log => [log.log, log.log_type, log.log_message, log.instrument_id, log.added_on]);
        this.execQuery(mysqlQuery, [mysqlValues],
          () => {
            const recordIds = batch.map(r => r.id);
            this.updateSQLiteAfterMySQLInsertAppLog(recordIds);
            processNextBatch();
          },
          (mysqlError) => {
            if (mysqlError) {
              this.logCriticalDatabaseIssue(`Error inserting log batch into MySQL: ${mysqlError?.message ?? mysqlError}`, 'database', batch.find(log => !!log.instrument_id)?.instrument_id ?? null);
            }
            errorf(mysqlError);
          }
        );
      };

      processNextBatch();
    }, () => {
      // Mysql not available
      errorf('MySQL not available');
    });
  }

  private chunkArray<T>(items: T[], batchSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      chunks.push(items.slice(i, i + batchSize));
    }
    return chunks;
  }

  private updateSQLiteAfterMySQLInsertAppLog(recordIds: any[]) {
    const placeholders = recordIds.map(() => '?').join(',');
    const updateQuery = `UPDATE app_log SET mysql_inserted = 1 WHERE id IN (${placeholders})`;
    this.execSqlite(updateQuery, recordIds)
      .then(() => {
        console.log('App log records successfully resynced and updated in SQLite:', recordIds.length);
      })
      .catch((error: any) => {
        console.error('Error updating SQLite after successful MySQL insert for app log:', error);
      });
  }

  fetchRecentLogs(instrumentId: string, limit: number = 200): Observable<any[]> {
    const subject = new Subject<any[]>();
    const query = 'SELECT * FROM app_log WHERE instrument_id = ? ORDER BY id DESC LIMIT ?';
    this.execSqlite(query, [instrumentId, limit])
      .then(rows => {
        // Defensive: ensure rows is an array before mapping
        if (!Array.isArray(rows)) {
          subject.next([]);
          subject.complete();
          return;
        }
        const logs = rows.map(row => ({
          type: row.log_type,
          message: this.formatLogMessage(row),
          instrumentId: row.instrument_id,
          timestamp: new Date(row.added_on)
        }));
        subject.next(logs.reverse());
        subject.complete();
      })
      .catch(err => {
        // Return empty array on error instead of propagating
        subject.next([]);
        subject.complete();
      });
    return subject.asObservable();
  }

  private formatLogMessage(log: any): string {
    const timestamp = this.moment(log.added_on).format('YYYY-MM-DD HH:mm:ss.SSS');
    const logType = log.log_type || 'info';
    // Reverted to old format to restore colors and styling
    const bootstrapClass = {
      success: 'success',
      info: 'info',
      warn: 'warning',
      error: 'danger',
      verbose: 'muted'
    }[logType] || 'info';

    return `<span class="log-time">[${timestamp}]</span> <span class="log-${logType} text-${bootstrapClass}">[${logType}]</span> <span class="log-text">${log.log}</span>`;
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

  public resetMysqlMigrations(): Promise<void> {
    // Use CREATE + DELETE to keep privileges minimal while still repairing a missing tracking table.
    const createVersionsTable = `
      CREATE TABLE IF NOT EXISTS versions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        version INT NOT NULL UNIQUE,
        filename VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_version (version)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    return new Promise((resolve, reject) => {
      this.execQuery(createVersionsTable, [],
        () => {
          this.execQuery('DELETE FROM versions', [],
            () => {
              this.hasRunMigrations = false;
              console.log('MySQL versions table cleared successfully.');
              resolve();
            },
            (err: any) => {
              console.error('Error clearing MySQL versions table:', err);
              reject(err);
            }
          );
        },
        (err: any) => {
          console.error('Error preparing MySQL versions table:', err);
          reject(err);
        }
      );
    });
  }



}
