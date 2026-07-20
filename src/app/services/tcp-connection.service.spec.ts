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
    const databaseService = {
      recordTelemetryEvent: vi.fn().mockResolvedValue(true)
    };
    const service = new TcpConnectionService(
      { net: {} } as any,
      { logger: vi.fn() } as any,
      databaseService as any
    );
    return { service: service as any, databaseService };
  }

  it('records one failure for all retries in the same outage', () => {
    const { service, databaseService } = createService();

    service.recordConnectionAttempt(connectionParams);
    service.recordConnectionFailure(connectionParams, 'ETIMEDOUT');
    service.recordConnectionAttempt(connectionParams);
    service.recordConnectionFailure(connectionParams, 'ETIMEDOUT');
    service.recordConnectionFailure(connectionParams, 'ECONNREFUSED');

    expect(databaseService.recordTelemetryEvent).toHaveBeenCalledTimes(2);
    expect(databaseService.recordTelemetryEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      eventType: 'instrument.connection_attempted'
    }));
    expect(databaseService.recordTelemetryEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      eventType: 'instrument.connection_failed',
      failureCode: 'ETIMEDOUT'
    }));
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
