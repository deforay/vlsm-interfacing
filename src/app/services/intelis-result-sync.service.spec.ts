import { describe, expect, it, vi } from 'vitest';
import { IntelisResultSyncService } from './intelis-result-sync.service';

describe('IntelisResultSyncService', () => {
  const connectionState = {
    configured: true,
    connection: {
      capabilities: { operations: { resultsWrite: true } },
      limits: { results: { maxItems: 500, maxBodyBytes: 2_097_152 } }
    }
  };
  const pendingRow = {
    id: 7,
    order_id: 'SAMPLE-007',
    test_id: 'SAMPLE-007',
    results: '1250',
    test_unit: 'cp/mL',
    machine_used: 'ANALYZER-1'
  };

  function createService(submission: any) {
    const database = {
      resultRecorded$: { subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }) },
      fetchPendingIntelisResults: vi.fn().mockResolvedValue({
        rows: [pendingRow],
        hasMore: false,
        oversizedResultCount: 0
      }),
      applyIntelisResultAcknowledgements: vi.fn().mockResolvedValue(undefined),
      recordTelemetryEvent: vi.fn().mockResolvedValue(true),
      resyncTestResultsToMySQL: vi.fn(),
      resyncIntelisStatusesToMySQL: vi.fn()
    };
    const connection = {
      load: vi.fn().mockResolvedValue({ ok: true, data: connectionState }),
      refresh: vi.fn().mockResolvedValue({ ok: true, data: connectionState }),
      submitResults: vi.fn().mockResolvedValue(submission)
    };
    const logging = { logSystemError: vi.fn() };
    const service = new IntelisResultSyncService(database as any, connection as any, logging as any);
    return { service, database, connection, logging };
  }

  it('stores each explicit server acknowledgement after a successful batch', async () => {
    const acknowledgement = {
      id: 7,
      outcome: 'accepted',
      limsSyncStatus: 1,
      reason: 'updated'
    };
    const { service, database, connection } = createService({
      ok: true,
      data: { status: 'success', imported: 1, results: [acknowledgement] }
    });

    await (service as any).synchronize();

    expect(connection.submitResults).toHaveBeenCalledWith([pendingRow]);
    expect(database.applyIntelisResultAcknowledgements).toHaveBeenCalledWith([acknowledgement]);
    expect(database.resyncTestResultsToMySQL).toHaveBeenCalledOnce();
  });

  it('leaves local rows pending when submission fails', async () => {
    const { service, database, logging } = createService({
      ok: false,
      error: { code: 'request_timeout', message: 'Timed out' }
    });

    const completed = await (service as any).synchronize();

    expect(completed).toBe(false);
    expect(database.applyIntelisResultAcknowledgements).not.toHaveBeenCalled();
    expect(logging.logSystemError).toHaveBeenCalledOnce();
  });

  it('requests a retry when the server leaves a row pending', async () => {
    const acknowledgement = {
      id: 7,
      outcome: 'retry',
      limsSyncStatus: 0,
      reason: 'update_failed'
    };
    const { service, database } = createService({
      ok: true,
      data: { status: 'success', imported: 0, results: [acknowledgement] }
    });

    const completed = await (service as any).synchronize();

    expect(completed).toBe(false);
    expect(database.applyIntelisResultAcknowledgements).toHaveBeenCalledWith([acknowledgement]);
  });

  it('does nothing when the server does not advertise resultsWrite', async () => {
    const { service, database, connection } = createService({ ok: true });
    connection.load.mockResolvedValue({
      ok: true,
      data: {
        configured: true,
        connection: { capabilities: { operations: { resultsWrite: false } }, limits: {} }
      }
    });
    connection.refresh.mockResolvedValue({
      ok: true,
      data: {
        configured: true,
        connection: { capabilities: { operations: { resultsWrite: false } }, limits: {} }
      }
    });

    const completed = await (service as any).synchronize();

    expect(completed).toBe(true);
    expect(database.fetchPendingIntelisResults).not.toHaveBeenCalled();
    expect(connection.submitResults).not.toHaveBeenCalled();
  });
});
