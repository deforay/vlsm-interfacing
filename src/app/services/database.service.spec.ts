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
});
