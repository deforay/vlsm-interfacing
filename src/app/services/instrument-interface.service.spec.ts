import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstrumentInterfaceService } from './instrument-interface.service';
import { HL7HelperService } from './hl7-helper.service';
import { ASTMHelperService } from './astm-helper.service';
import { UtilitiesService } from './utilities.service';

describe('InstrumentInterfaceService HL7 streams', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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
      connectionStack: new Map<string, any>(),
      disconnect: vi.fn()
    };
    const utilitiesService = {
      hex2ascii: (hex: string) => Buffer.from(hex, 'hex').toString('binary'),
      logger: vi.fn()
    };
    const astmHelper = {
      clearInstrumentBuffer: vi.fn()
    };
    const service = new InstrumentInterfaceService(
      dbService as any,
      tcpService as any,
      utilitiesService as any,
      {} as any,
      astmHelper as any
    );

    return { service, dbService, tcpService, astmHelper };
  };

  const createParsingService = (persistenceSucceeds: boolean) => {
    const loggingService = { log: vi.fn() };
    const utilities = new UtilitiesService(null, null, loggingService as any);
    const dbService = {
      recordTestResults: vi.fn((_data, success, failure) => {
        if (persistenceSucceeds) success({ lastID: 1 });
        else failure(new Error('database write failed'));
      }),
      recordTelemetryEvent: vi.fn().mockResolvedValue(true)
    };
    const hl7Helper = new HL7HelperService(utilities);
    const astmHelper = new ASTMHelperService(utilities);
    const service = new InstrumentInterfaceService(
      dbService as any,
      { connectionStack: new Map() } as any,
      utilities,
      hl7Helper,
      astmHelper
    );

    return { service, dbService };
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

  it('discards an oversized incomplete HL7 frame', () => {
    const { service, tcpService } = createService();
    const key = '10.0.0.1:5001:tcpserver:hl7';
    const instrument = createConnection('ANALYZER-A');
    tcpService.connectionStack.set(key, instrument);
    const maximumBytes = InstrumentInterfaceService.MAX_INCOMPLETE_HL7_BYTES;

    service.handleTCPResponse(key, Buffer.from(`MSH|^~\\&|A|LAB|${'X'.repeat(maximumBytes)}`));

    expect((service as any).hl7ReceiveBuffers.has('ANALYZER-A')).toBe(false);
    expect(instrument.transmissionStatusSubject.value).toBe(false);
  });

  it('discards an inactive incomplete HL7 frame', () => {
    vi.useFakeTimers();
    const { service, tcpService } = createService();
    const key = '10.0.0.1:5001:tcpserver:hl7';
    const instrument = createConnection('ANALYZER-A');
    tcpService.connectionStack.set(key, instrument);

    service.handleTCPResponse(key, Buffer.from('MSH|^~\\&|A|LAB|PARTIAL'));
    vi.advanceTimersByTime(InstrumentInterfaceService.HL7_BUFFER_INACTIVITY_TIMEOUT_MS);

    expect((service as any).hl7ReceiveBuffers.has('ANALYZER-A')).toBe(false);
    expect(instrument.transmissionStatusSubject.value).toBe(false);
  });

  it('clears incomplete protocol state when an instrument disconnects', () => {
    const { service, tcpService, astmHelper } = createService();
    const key = '10.0.0.1:5001:tcpserver:hl7';
    tcpService.connectionStack.set(key, createConnection('ANALYZER-A'));
    service.handleTCPResponse(key, Buffer.from('MSH|^~\\&|A|LAB|PARTIAL'));

    service.disconnect({
      connectionParams: {
        instrumentId: 'ANALYZER-A',
        host: '10.0.0.1',
        port: 5001
      }
    });

    expect((service as any).hl7ReceiveBuffers.has('ANALYZER-A')).toBe(false);
    expect(astmHelper.clearInstrumentBuffer).toHaveBeenCalledWith('ANALYZER-A');
    expect(tcpService.disconnect).toHaveBeenCalledOnce();
  });

  it('reports successful persistence after parsing a stored HL7 result', async () => {
    const { service, dbService } = createParsingService(true);
    const rawMessage = [
      'MSH|^~\\&|ANALYZER|LAB001|LIS|LAB001|20260714113000||OUL^R22|MSG-001|P|2.5.1',
      'SPM|1|SAMPLE-001',
      'OBR|1|||HIVVL^HIV Viral Load',
      'OBX|1|ST|HIVVL^HIV Viral Load|1|1250|copies/mL|||||F|||||TECH-1|||20260714113000'
    ].join('\r');

    const outcomes = await service.processHL7Data(createConnection('ANALYZER-A') as any, rawMessage);

    expect(outcomes).toEqual([true]);
    expect(dbService.recordTestResults).toHaveBeenCalledOnce();
  });

  it('reports persistence failure after parsing a stored HL7 result', async () => {
    const { service, dbService } = createParsingService(false);
    const rawMessage = [
      'MSH|^~\\&|ANALYZER|LAB001|LIS|LAB001|20260714113000||OUL^R22|MSG-002|P|2.5.1',
      'SPM|1|SAMPLE-002',
      'OBR|1|||HIVVL^HIV Viral Load',
      'OBX|1|ST|HIVVL^HIV Viral Load|1|Failed|||||||X'
    ].join('\r');

    const outcomes = await service.processHL7Data(createConnection('ANALYZER-A') as any, rawMessage);

    expect(outcomes).toEqual([false]);
    expect(dbService.recordTelemetryEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'test.processing_failed',
      instrumentId: 'ANALYZER-A',
      testType: 'HIV Viral Load',
      outcome: 'failed',
      failureCode: 'result_persistence_failed'
    }));
    expect(dbService.recordTelemetryEvent.mock.calls[0][0]).not.toHaveProperty('orderId');
    expect(dbService.recordTelemetryEvent.mock.calls[0][0]).not.toHaveProperty('result');
  });
});
