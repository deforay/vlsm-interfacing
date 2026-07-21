import { describe, expect, it, vi } from 'vitest';
import { IntelisUsageSyncService } from './intelis-usage-sync.service';

describe('IntelisUsageSyncService', () => {
  const state = {
    configured: true,
    connection: {
      capabilities: { operations: { activityWrite: true, usageStatisticsWrite: true } },
      limits: {
        activity: { maxItems: 1000, maxBodyBytes: 1_048_576 },
        usageStatistics: { maxItems: 500, maxBodyBytes: 1_048_576 }
      }
    }
  };
  const event = {
    event_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    event_type: 'instrument.connected',
    event_category: 'instrument',
    occurred_at: '2026-07-21 08:00:00'
  };
  const summary = {
    aggregate_id: '11111111-2222-4333-8444-555555555555',
    activity_date: '2026-07-21',
    total_tests: 25,
    successful_tests: 23,
    failed_tests: 2,
    revision: 25
  };

  function createService() {
    const database = {
      usageRecorded$: { subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }) },
      fetchPendingIntelisActivity: vi.fn().mockResolvedValue([event]),
      acknowledgeIntelisActivity: vi.fn().mockResolvedValue(undefined),
      fetchPendingIntelisUsageStatistics: vi.fn().mockResolvedValue([summary]),
      acknowledgeIntelisUsageStatistics: vi.fn().mockResolvedValue(undefined)
    };
    const connection = {
      load: vi.fn().mockResolvedValue({ ok: true, data: state }),
      refresh: vi.fn().mockResolvedValue({ ok: true, data: state }),
      submitActivity: vi.fn().mockResolvedValue({
        ok: true,
        data: { status: 'success', stored: 1, duplicates: 0, skipped: 0 }
      }),
      submitUsageStatistics: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          status: 'success', stored: 1, updated: 0, duplicates: 0, stale: 0, rejected: 0,
          summaries: [{ aggregate_id: summary.aggregate_id, revision: 25, outcome: 'stored' }]
        }
      })
    };
    const logging = { logSystemError: vi.fn() };
    const service = new IntelisUsageSyncService(database as any, connection as any, logging as any);
    return { service, database, connection, logging };
  }

  it('acknowledges both queues only after server success', async () => {
    const { service, database } = createService();

    await (service as any).synchronize();

    expect(database.acknowledgeIntelisActivity).toHaveBeenCalledWith([event]);
    expect(database.acknowledgeIntelisUsageStatistics).toHaveBeenCalledWith([
      { aggregate_id: summary.aggregate_id, revision: 25, outcome: 'stored' }
    ]);
  });

  it('leaves a rejected daily summary pending', async () => {
    const { service, database, connection, logging } = createService();
    connection.submitUsageStatistics.mockResolvedValue({
      ok: true,
      data: {
        status: 'success', stored: 0, updated: 0, duplicates: 0, stale: 0, rejected: 1,
        summaries: [{ aggregate_id: summary.aggregate_id, revision: 25, outcome: 'rejected' }]
      }
    });

    const completed = await (service as any).synchronize();

    expect(completed).toBe(false);
    expect(database.acknowledgeIntelisUsageStatistics).toHaveBeenCalledWith([]);
    expect(logging.logSystemError).toHaveBeenCalledOnce();
  });

  it('does not acknowledge activity after a failed request', async () => {
    const { service, database, connection } = createService();
    connection.submitActivity.mockResolvedValue({ ok: false, error: { code: 'request_timeout' } });

    const completed = await (service as any).synchronize();

    expect(completed).toBe(false);
    expect(database.acknowledgeIntelisActivity).not.toHaveBeenCalled();
    expect(connection.submitUsageStatistics).not.toHaveBeenCalled();
  });

  it('does not read queues when the server advertises neither capability', async () => {
    const { service, database, connection } = createService();
    const unsupported = { configured: true, connection: { capabilities: { operations: {} }, limits: {} } };
    connection.load.mockResolvedValue({ ok: true, data: unsupported });
    connection.refresh.mockResolvedValue({ ok: true, data: unsupported });

    expect(await (service as any).synchronize()).toBe(true);
    expect(database.fetchPendingIntelisActivity).not.toHaveBeenCalled();
    expect(database.fetchPendingIntelisUsageStatistics).not.toHaveBeenCalled();
  });
});
