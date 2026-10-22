import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseService } from './database.service';

/**
 * A database behind the code is repaired without a restart when it can be,
 * and the app restarts only when that does not work.
 */
describe('repairing database schema drift', () => {
  const noSuchColumn = () => Object.assign(new Error('SQLITE_ERROR: table orders has no column named lis_status'), { code: 'SQLITE_ERROR' });

  const createService = (options: { replayOk?: boolean; lastRepair?: number } = {}) => {
    // The constructor starts configuration subscriptions. These tests need
    // only the repair path, so the fields it uses are set by hand.
    const service = Object.create(DatabaseService.prototype) as any;
    service.restartRequested = false;
    service.restartRequiredSubject = new BehaviorSubject<boolean>(false);
    service.restartRequired$ = service.restartRequiredSubject.asObservable();
    service.sqliteReplayCount = 0;
    service.sqliteReplay = null;
    service.loggingService = { log: vi.fn() };
    service.store = { get: vi.fn(() => options.lastRepair ?? 0) };
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'replay-sqlite-migrations') return { ok: options.replayOk ?? true };
      return { response: 0 };
    });
    service.electronService = { ipcRenderer: { invoke }, execSqliteQuery: vi.fn() };
    return { service, invoke, query: service.electronService.execSqliteQuery as ReturnType<typeof vi.fn> };
  };

  it('repairs without a restart and runs the query that found the drift again', async () => {
    const { service, invoke, query } = createService();
    query.mockRejectedValueOnce(noSuchColumn()).mockResolvedValueOnce([{ id: 1 }]);

    await expect(service.execSqlite('SELECT lis_status FROM orders', [])).resolves.toEqual([{ id: 1 }]);

    expect(invoke).toHaveBeenCalledWith('replay-sqlite-migrations');
    expect(invoke).not.toHaveBeenCalledWith('force-rerun-migrations');
    expect(query).toHaveBeenCalledTimes(2);
    expect(service.restartRequiredSubject.value).toBe(false);
  });

  it('shares one repair among queries that fail at the same moment', async () => {
    const { service, invoke, query } = createService();
    query
      .mockRejectedValueOnce(noSuchColumn())
      .mockRejectedValueOnce(noSuchColumn())
      .mockResolvedValue([]);

    await Promise.all([service.execSqlite('SELECT 1', []), service.execSqlite('SELECT 2', [])]);

    expect(invoke.mock.calls.filter(([channel]) => channel === 'replay-sqlite-migrations')).toHaveLength(1);
  });

  it('asks for a restart when the repair does not apply every migration', async () => {
    const { service, query } = createService({ replayOk: false });
    query.mockRejectedValue(noSuchColumn());

    await expect(service.execSqlite('SELECT lis_status FROM orders', [])).rejects.toThrow(/no column/);

    expect(await firstValueFrom(service.restartRequired$)).toBe(true);
  });

  it('asks for a restart when the query still fails after a repair', async () => {
    const { service, query } = createService({ replayOk: true });
    query.mockRejectedValue(noSuchColumn());

    await expect(service.execSqlite('SELECT lis_status FROM orders', [])).rejects.toThrow(/no column/);

    expect(query).toHaveBeenCalledTimes(2);
    expect(service.restartRequiredSubject.value).toBe(true);
  });

  it('does not repair or restart for an error that is not schema drift', async () => {
    const { service, invoke, query } = createService();
    query.mockRejectedValue(new Error('SQLITE_BUSY: database is locked'));

    await expect(service.execSqlite('SELECT 1', [])).rejects.toThrow(/locked/);

    expect(invoke).not.toHaveBeenCalled();
    expect(service.restartRequiredSubject.value).toBe(false);
  });

  it('sends the operator to support instead of restarting again soon after a repair restart', async () => {
    const { service, invoke, query } = createService({ replayOk: false, lastRepair: Date.now() - 60_000 });
    query.mockRejectedValue(noSuchColumn());

    await expect(service.execSqlite('SELECT lis_status FROM orders', [])).rejects.toThrow();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('show-confirm-dialog', expect.objectContaining({
      title: 'Database Needs Attention',
      detail: expect.stringContaining('Open Logs Folder')
    })));

    expect(service.restartRequiredSubject.value).toBe(false);
  });
});

/**
 * The same repair for MySQL. Errors cross IPC as messages, without a code, so
 * the tests use messages only.
 */
describe('repairing MySQL schema drift', () => {
  const noSuchTable = () => new Error("Error invoking remote method 'mysql-query': Error: Table 'interfacing.telemetry_events' doesn't exist");
  const duplicateColumn = () => new Error("Error invoking remote method 'mysql-query': Error: Duplicate column name 'ingestion_id'");

  const createService = () => {
    const service = Object.create(DatabaseService.prototype) as any;
    service.restartRequested = false;
    service.restartRequiredSubject = new BehaviorSubject<boolean>(false);
    service.migrationAutoRetryCount = 0;
    service.mysqlReplay = null;
    service.hasRunMigrations = true;
    service.loggingService = { log: vi.fn() };
    service.store = { get: vi.fn(() => 0) };
    service.commonSettings = { mysqlDb: 'interfacing' };
    const query = vi.fn();
    service.mysqlPool = {
      getConnection: (callback: any) => callback(null, {
        release: vi.fn(),
        query: (options: any, data: any, done: any) => {
          Promise.resolve(query(options.sql, data)).then(rows => done(null, rows), error => done(error));
        }
      })
    };
    const replay = vi.spyOn(service, 'checkAndRunMigrations').mockImplementation(async () => {
      service.hasRunMigrations = true;
    });
    const run = (sql: string) => new Promise((resolve, reject) => service.execQuery(sql, [], resolve, reject));
    return { service, query, replay, run };
  };

  it('replays every migration when a table is missing, then runs the query again', async () => {
    const { service, query, replay, run } = createService();
    query.mockRejectedValueOnce(noSuchTable()).mockResolvedValueOnce({ affectedRows: 1 });

    await expect(run('INSERT INTO telemetry_events VALUES (?)')).resolves.toEqual({ affectedRows: 1 });

    expect(replay).toHaveBeenCalledWith(null, true);
    expect(service.restartRequiredSubject.value).toBe(false);
  });

  it('shares one replay among queries that fail at the same moment', async () => {
    const { query, replay, run } = createService();
    query
      .mockRejectedValueOnce(noSuchTable())
      .mockRejectedValueOnce(noSuchTable())
      .mockResolvedValue({});

    await Promise.all([run('INSERT 1'), run('INSERT 2')]);

    expect(replay).toHaveBeenCalledTimes(1);
  });

  it('asks for a restart when the query still fails after the replay', async () => {
    const { service, query, replay, run } = createService();
    query.mockRejectedValue(noSuchTable());

    await expect(run('INSERT INTO telemetry_events VALUES (?)')).rejects.toThrow(/doesn't exist/);

    expect(replay).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
    expect(service.restartRequiredSubject.value).toBe(true);
  });

  it('does not repair or restart for an error that is not schema drift', async () => {
    const { service, query, replay, run } = createService();
    query.mockRejectedValue(new Error('Lock wait timeout exceeded'));

    await expect(run('INSERT 1')).rejects.toThrow(/Lock wait/);

    expect(replay).not.toHaveBeenCalled();
    expect(service.restartRequiredSubject.value).toBe(false);
  });

  it('accepts a column that another repair added after the check', async () => {
    const { service, query } = createService();
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('INFORMATION_SCHEMA.TABLES')) return [{ table_count: 1 }];
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return [{ column_count: 0 }];
      throw duplicateColumn();
    });

    await expect(service.ensureMysqlColumn('orders', 'ingestion_id', 'ALTER TABLE `orders` ADD COLUMN `ingestion_id` VARCHAR(36) NULL')).resolves.toBeUndefined();
  });

  it('does not start a repair from inside the repair', async () => {
    const { service, query, replay } = createService();
    query.mockRejectedValue(noSuchTable());

    await expect(service.execMigrationQuery('ALTER TABLE telemetry_events ADD COLUMN x INT', [])).rejects.toThrow(/doesn't exist/);

    expect(replay).not.toHaveBeenCalled();
  });

  it('runs migration files that versions already records when replaying all', async () => {
    const { service, query, replay } = createService();
    replay.mockRestore();
    service.hasRunMigrations = false;
    service.migrationDir = '/migrations';
    service.path = { join: (...parts: string[]) => parts.join('/') };
    service.cryptoService = { decrypt: (value: string) => value };
    service.electronService = {
      isForceMigrationReplayRequested: vi.fn(async () => false),
      clearForceMigrationReplayRequest: vi.fn(),
      mysql: { createConnection: () => ({ query: (_sql: string, done: any) => done(null), destroy: vi.fn() }) },
      fs: {
        existsSync: () => true,
        readdirSync: () => ['008.sql'],
        readFileSync: () => 'CREATE TABLE IF NOT EXISTS `telemetry_events` (`id` INT);'
      }
    };
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT version')) return [{ version: 8, filename: '008.sql' }];
      if (sql.includes('INFORMATION_SCHEMA')) return [{ table_count: 0 }];
      if (sql.startsWith('INSERT INTO versions')) throw new Error("Duplicate entry '8' for key 'version'");
      return [];
    });

    await service.checkAndRunMigrations(null, true);

    expect(query.mock.calls.map(([sql]) => sql)).toContain('CREATE TABLE IF NOT EXISTS `telemetry_events` (`id` INT)');
    expect(service.hasRunMigrations).toBe(true);
  });
});
