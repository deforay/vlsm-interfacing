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
    expect(service.execSqlite.mock.calls[0][1].at(-1)).toBe(1);
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

  it('documents the current interruption window after a successful MySQL insert', async () => {
    const service = createService();
    const sqliteFailure = new Error('local disk unavailable');
    service.checkMysqlConnection = vi.fn((_params, success) => success());
    service.execQuery = vi.fn((_query, _values, success) => success({ insertId: 1 }));
    service.execSqlite = vi.fn().mockRejectedValue(sqliteFailure);

    const receivedError = await new Promise<Error>((resolve) => {
      service.recordTestResults(sampleResult, vi.fn(), resolve);
    });

    // This characterization is intentionally expected to change when Batch 2
    // makes local durability the first persistence boundary.
    expect(service.execQuery).toHaveBeenCalledOnce();
    expect(receivedError).toBe(sqliteFailure);
  });

  it.fails('persists locally before attempting MySQL replication', async () => {
    const service = createService();
    service.checkMysqlConnection = vi.fn((_params, success) => success());
    service.execQuery = vi.fn((_query, _values, success) => success({ insertId: 1 }));
    service.execSqlite = vi.fn().mockResolvedValue({ lastID: 1 });

    await new Promise<void>((resolve, reject) => {
      service.recordTestResults(sampleResult, resolve, reject);
    });

    // WHY: local-first ordering closes the crash window documented above.
    // Batch 2 will change the implementation and convert this to a normal test.
    expect(service.execSqlite.mock.invocationCallOrder[0])
      .toBeLessThan(service.execQuery.mock.invocationCallOrder[0]);
  });

  it.fails('does not replicate the same pending row twice after a local status-update failure', async () => {
    const service = createService();
    const pendingRecord = { ...sampleResult, id: 42, instrument_id: 'ANALYZER-1', mysql_inserted: 0 };
    service.checkMysqlConnection = vi.fn((_params, success) => success());
    service.execQuery = vi.fn((_query, _values, success) => success({ affectedRows: 1 }));
    service.execSqlite = vi.fn((query: string) => {
      if (query.startsWith('SELECT')) return Promise.resolve([pendingRecord]);
      return Promise.reject(new Error('status update interrupted'));
    });

    const resync = () => new Promise<void>((resolve, reject) => {
      service.resyncTestResultsToMySQL(() => resolve(), reject);
    });
    await resync();
    await resync();

    // WHY: a remote insert must be safe to retry even if the local replicated
    // flag could not be updated. Batch 2 will add a stable ingestion identity.
    expect(service.execQuery).toHaveBeenCalledOnce();
  });
});
