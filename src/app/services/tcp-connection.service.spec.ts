import { describe, expect, it, vi } from 'vitest';
import { TcpConnectionService } from './tcp-connection.service';

describe('TcpConnectionService usage statistics', () => {
  const connectionParams = {
    host: '192.0.2.10',
    port: 3120,
    connectionMode: 'tcpclient',
    connectionProtocol: 'hl7',
    instrumentId: 'instrument-1',
    machineType: 'analyzer',
    labName: 'Lab',
    interfaceAutoConnect: 'yes'
  } as any;

  function createService() {
    const utilitiesService = { logger: vi.fn() };
    const databaseService = {
      recordTelemetryEvent: vi.fn().mockResolvedValue(true)
    };
    const service = new TcpConnectionService(
      { net: {} } as any,
      utilitiesService as any,
      databaseService as any
    );
    return { service: service as any, databaseService, utilitiesService };
  }

  it('records one failure for all retries in the same outage', () => {
    const { service, databaseService } = createService();

    service.recordConnectionAttempt(connectionParams);
    service.recordConnectionFailure(connectionParams, 'ETIMEDOUT');
    expect(service.recordConnectionAttempt(connectionParams)).toBe(false);
    expect(service.recordConnectionFailure(connectionParams, 'ETIMEDOUT')).toBe(false);
    expect(service.recordConnectionFailure(connectionParams, 'ECONNREFUSED')).toBe(false);

    expect(databaseService.recordTelemetryEvent).toHaveBeenCalledTimes(2);
    expect(databaseService.recordTelemetryEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      eventType: 'instrument.connection_attempted'
    }));
    expect(databaseService.recordTelemetryEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      eventType: 'instrument.connection_failed',
      failureCode: 'ETIMEDOUT'
    }));
  });

  it('reports whether an outage should produce an operational log', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T00:00:00Z'));
    const { service } = createService();

    expect(service.recordConnectionFailure(connectionParams, 'ETIMEDOUT')).toBe(true);
    expect(service.recordConnectionFailure(connectionParams, 'ETIMEDOUT')).toBe(false);
    vi.setSystemTime(new Date('2026-07-20T00:15:00Z'));
    expect(service.recordConnectionFailure(connectionParams, 'ETIMEDOUT')).toBe(true);
    expect(service.recordConnectionFailure(connectionParams, 'ETIMEDOUT')).toBe(false);
    service.recordConnectionSuccess(connectionParams);
    expect(service.recordConnectionFailure(connectionParams, 'ETIMEDOUT')).toBe(true);
    vi.useRealTimers();
  });

  it('logs only the first error and retry schedule during an outage', () => {
    vi.useFakeTimers();
    const { service, utilitiesService } = createService();
    const connectionState = {
      instrumentId: connectionParams.instrumentId,
      statusSubject: { next: vi.fn() },
      connectionAttemptStatusSubject: { next: vi.fn() },
      reconnectAttempts: 0,
      pendingReconnectTimer: null
    };

    service._handleClientConnectionIssue(
      connectionState,
      connectionParams,
      'Connection timed out',
      true,
      'ETIMEDOUT'
    );
    service._handleClientConnectionIssue(
      connectionState,
      connectionParams,
      'Connection timed out',
      true,
      'ETIMEDOUT'
    );

    expect(utilitiesService.logger).toHaveBeenCalledTimes(2);
    expect(utilitiesService.logger).toHaveBeenNthCalledWith(
      1,
      'error',
      'Connection timed out',
      connectionParams.instrumentId
    );
    expect(utilitiesService.logger).toHaveBeenNthCalledWith(
      2,
      'info',
      expect.stringContaining('Will retry connection'),
      connectionParams.instrumentId
    );
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('records a new outage only after connectivity has recovered', () => {
    const { service, databaseService } = createService();

    service.recordConnectionFailure(connectionParams, 'ETIMEDOUT');
    service.recordConnectionSuccess(connectionParams);
    service.recordConnectionFailure(connectionParams, 'ETIMEDOUT');

    expect(databaseService.recordTelemetryEvent).toHaveBeenCalledTimes(3);
    expect(databaseService.recordTelemetryEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      eventType: 'instrument.connected',
      outcome: 'success'
    }));
    expect(databaseService.recordTelemetryEvent).toHaveBeenNthCalledWith(3, expect.objectContaining({
      eventType: 'instrument.connection_failed'
    }));
  });
});
