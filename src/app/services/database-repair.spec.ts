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
      title: 'Database Needs Attention'
    })));

    expect(service.restartRequiredSubject.value).toBe(false);
  });
});
