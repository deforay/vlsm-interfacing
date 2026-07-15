import { firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseService } from './database.service';

describe('DatabaseService result durability', () => {
  const createService = () => {
    // The constructor starts configuration subscriptions. These focused tests
    // exercise the persistence decision without starting the application runtime.
    const service = Object.create(DatabaseService.prototype) as DatabaseService;
    return service as any;
  };

  const sampleResult = {
    order_id: 'SAMPLE-001',
    test_id: 'VL',
    test_type: 'HIVVL',
    results: '1250',
    machine_used: 'ANALYZER-1'
  };

  it('stores a pending SQLite copy when MySQL is unavailable', async () => {
    const service = createService();
    service.checkMysqlConnection = vi.fn((_params, _success, failure) => failure(new Error('offline')));
    service.execSqlite = vi.fn().mockResolvedValue({ lastID: 1 });

    await new Promise<void>((resolve, reject) => {
      service.recordTestResults(sampleResult, () => resolve(), reject);
    });

    const [query, values] = service.execSqlite.mock.calls[0];
    expect(query).toContain('`instrument_id`');
    expect(query).toContain('`mysql_inserted`');
    expect(values).toContain('ANALYZER-1');
    expect(values.at(-1)).toBe(0);
  });

  it('marks the SQLite copy replicated only after MySQL succeeds', async () => {
    const service = createService();
    service.checkMysqlConnection = vi.fn((_params, success) => success());
    service.execQuery = vi.fn((_query, _values, success) => success({ insertId: 1 }));
    service.execSqlite = vi.fn().mockResolvedValue({ lastID: 1 });

    await new Promise<void>((resolve, reject) => {
      service.recordTestResults(sampleResult, () => resolve(), reject);
    });

    expect(service.execQuery).toHaveBeenCalledOnce();
    expect(service.execQuery.mock.calls[0][0]).toContain('ON DUPLICATE KEY UPDATE');
    const localInsertValues = service.execSqlite.mock.calls[0][1];
    const ingestionId = localInsertValues.find(
      value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value)
    );
    expect(ingestionId).toBeTruthy();
    expect(service.execQuery.mock.calls[0][1]).toContain(ingestionId);
    expect(localInsertValues.at(-1)).toBe(0);
    expect(service.execSqlite.mock.calls[1]).toEqual([
      'UPDATE orders SET mysql_inserted = 1 WHERE id IN (?)',
      [1]
    ]);
  });

  it('falls back to a pending local copy when the MySQL insert fails', async () => {
    const service = createService();
    service.checkMysqlConnection = vi.fn((_params, success) => success());
    service.execQuery = vi.fn((_query, _values, _success, failure) => failure(new Error('write failed')));
    service.execSqlite = vi.fn().mockResolvedValue({ lastID: 1 });
    service.logCriticalDatabaseIssue = vi.fn();

    await new Promise<void>((resolve, reject) => {
      service.recordTestResults(sampleResult, () => resolve(), reject);
    });

    expect(service.execSqlite).toHaveBeenCalledOnce();
    expect(service.execSqlite.mock.calls[0][1].at(-1)).toBe(0);
  });

  it('does not attempt MySQL when the local durability write fails', async () => {
    const service = createService();
    const sqliteFailure = new Error('local disk unavailable');
    service.checkMysqlConnection = vi.fn((_params, success) => success());
    service.execQuery = vi.fn((_query, _values, success) => success({ insertId: 1 }));
    service.execSqlite = vi.fn().mockRejectedValue(sqliteFailure);

    const receivedError = await new Promise<Error>((resolve) => {
      service.recordTestResults(sampleResult, vi.fn(), resolve);
    });

    expect(service.execQuery).not.toHaveBeenCalled();
    expect(receivedError).toBe(sqliteFailure);
  });

  it('persists locally before attempting MySQL replication', async () => {
    const service = createService();
    service.checkMysqlConnection = vi.fn((_params, success) => success());
    service.execQuery = vi.fn((_query, _values, success) => success({ insertId: 1 }));
    service.execSqlite = vi.fn().mockResolvedValue({ lastID: 1 });

    await new Promise<void>((resolve, reject) => {
      service.recordTestResults(sampleResult, resolve, reject);
    });

    // WHY: local-first ordering closes the crash window between databases.
    expect(service.execSqlite.mock.invocationCallOrder[0])
      .toBeLessThan(service.execQuery.mock.invocationCallOrder[0]);
  });

  it('retries a pending row with the same idempotency identity', async () => {
    const service = createService();
    const pendingRecord = {
      ...sampleResult,
      id: 42,
      instrument_id: 'ANALYZER-1',
      ingestion_id: 'stable-ingestion-id',
      mysql_inserted: 0
    };
    const remotelyStoredIds = new Set<string>();
    service.checkMysqlConnection = vi.fn((_params, success) => success());
    service.execQuery = vi.fn((_query, values, success) => {
      remotelyStoredIds.add(values[0][0].find(value => value === 'stable-ingestion-id'));
      success({ affectedRows: 1 });
    });
    service.execSqlite = vi.fn((query: string) => {
      if (query.startsWith('SELECT')) return Promise.resolve([pendingRecord]);
      return Promise.reject(new Error('status update interrupted'));
    });

    const resync = () => new Promise<void>((resolve, reject) => {
      service.resyncTestResultsToMySQL(() => resolve(), reject);
    });
    await resync();
    await resync();

    expect(service.execQuery).toHaveBeenCalledTimes(2);
    expect(service.execQuery.mock.calls[0][0]).toContain('ON DUPLICATE KEY UPDATE');
    expect(remotelyStoredIds).toEqual(new Set(['stable-ingestion-id']));
  });
});

describe('DatabaseService log display', () => {
  it('returns stored logs as structured plain text', async () => {
    const service = Object.create(DatabaseService.prototype) as any;
    service.execSqlite = vi.fn().mockResolvedValue([{
      id: 7,
      instrument_id: 'ANALYZER-1',
      added_on: '2026-07-15T12:15:11.830Z',
      log_type: 'error',
      log: 'Connection timed out'
    }]);

    const entries = await firstValueFrom(
      service.fetchRecentLogs('ANALYZER-1') as ReturnType<DatabaseService['fetchRecentLogs']>
    );
    const [entry] = entries;

    expect(entry).toMatchObject({
      type: 'error',
      message: 'Connection timed out',
      instrumentId: 'ANALYZER-1'
    });
    expect(entry.timestamp).toEqual(new Date('2026-07-15T12:15:11.830Z'));
  });
});
