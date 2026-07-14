import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { InstrumentInterfaceService } from './instrument-interface.service';

describe('InstrumentInterfaceService HL7 streams', () => {
  const createConnection = (instrumentId: string) => ({
    connectionProtocol: 'hl7',
    instrumentId,
    machineType: 'generic',
    labName: 'LAB001',
    statusSubject: new BehaviorSubject(false),
    connectionAttemptStatusSubject: new BehaviorSubject(false),
    transmissionStatusSubject: new BehaviorSubject(false),
    errorOccurred: false,
    reconnectAttempts: 0
  });

  const createService = () => {
    const dbService = {
      recordRawData: vi.fn((_data, success) => success())
    };
    const tcpService = {
      connectionStack: new Map<string, any>()
    };
    const utilitiesService = {
      hex2ascii: (hex: string) => Buffer.from(hex, 'hex').toString('binary'),
      logger: vi.fn()
    };
    const service = new InstrumentInterfaceService(
      dbService as any,
      tcpService as any,
      utilitiesService as any,
      {} as any,
      {} as any
    );

    return { service, dbService, tcpService };
  };

  it('does not mix fragmented HL7 messages from concurrent instruments', () => {
    const { service, dbService, tcpService } = createService();
    const keyA = '10.0.0.1:5001:tcpserver:hl7';
    const keyB = '10.0.0.2:5002:tcpserver:hl7';
    tcpService.connectionStack.set(keyA, createConnection('ANALYZER-A'));
    tcpService.connectionStack.set(keyB, createConnection('ANALYZER-B'));
    const processSpy = vi.spyOn(service, 'processHL7Data').mockImplementation(() => undefined);

    service.handleTCPResponse(keyA, Buffer.from('MSH|^~\\&|A|LAB|'));
    service.handleTCPResponse(keyB, Buffer.from('MSH|^~\\&|B|LAB|RESULT-B\x1c'));
    service.handleTCPResponse(keyA, Buffer.from('RESULT-A\x1c'));

    expect(processSpy).toHaveBeenCalledTimes(2);
    expect(processSpy.mock.calls[0][1]).toContain('RESULT-B');
    expect(processSpy.mock.calls[0][1]).not.toContain('|A|LAB|');
    expect(processSpy.mock.calls[1][1]).toContain('RESULT-A');
    expect(processSpy.mock.calls[1][1]).not.toContain('|B|LAB|');

    const rawMessages = dbService.recordRawData.mock.calls.map(call => call[0].data);
    expect(rawMessages[0]).toContain('RESULT-B');
    expect(rawMessages[0]).not.toContain('|A|LAB|');
    expect(rawMessages[1]).toContain('RESULT-A');
    expect(rawMessages[1]).not.toContain('|B|LAB|');
  });

  it('keeps an incomplete HL7 frame buffered without parsing or persistence', () => {
    const { service, dbService, tcpService } = createService();
    const key = '10.0.0.1:5001:tcpserver:hl7';
    tcpService.connectionStack.set(key, createConnection('ANALYZER-A'));
    const processSpy = vi.spyOn(service, 'processHL7Data').mockImplementation(() => undefined);

    service.handleTCPResponse(key, Buffer.from('MSH|^~\\&|A|LAB|PARTIAL'));

    expect(processSpy).not.toHaveBeenCalled();
    expect(dbService.recordRawData).not.toHaveBeenCalled();
  });

  it('isolates a malformed completed frame from the following transmission', () => {
    const { service, tcpService } = createService();
    const key = '10.0.0.1:5001:tcpserver:hl7';
    tcpService.connectionStack.set(key, createConnection('ANALYZER-A'));
    const processSpy = vi.spyOn(service, 'processHL7Data').mockImplementation(() => undefined);

    service.handleTCPResponse(key, Buffer.from('NOT-HL7\x1c'));
    service.handleTCPResponse(key, Buffer.from('MSH|^~\\&|A|LAB|VALID\x1c'));

    expect(processSpy).toHaveBeenCalledTimes(2);
    expect(processSpy.mock.calls[1][1]).not.toContain('NOT-HL7');
  });

  it.fails('discards an oversized incomplete HL7 frame', () => {
    const { service, tcpService } = createService();
    const key = '10.0.0.1:5001:tcpserver:hl7';
    const instrument = createConnection('ANALYZER-A');
    tcpService.connectionStack.set(key, instrument);

    service.handleTCPResponse(key, Buffer.from(`MSH|^~\\&|A|LAB|${'X'.repeat(2 * 1024 * 1024)}`));

    // WHY: an analyzer that never sends FS must not grow renderer memory
    // without bound. Batch 2 will introduce a documented protocol limit.
    expect((service as any).hl7ReceiveBuffers.has('ANALYZER-A')).toBe(false);
  });
});
