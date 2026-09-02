import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASTMHelperService } from './astm-helper.service';
import { UtilitiesService } from './utilities.service';

describe('ASTMHelperService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const createService = () => {
    const utilities = new UtilitiesService(null, null, {
      log: vi.fn()
    } as any);

    return new ASTMHelperService(utilities);
  };

  it('frames an outbound order with a valid checksum and EOT marker', () => {
    const service = createService();
    const message = service.generateASTMMessageForOrder({
      test_location: 'LAB001',
      order_id: 'SAMPLE-001',
      test_id: 'VL',
      test_type: 'HIVVL'
    });

    const framed = service.frameASTMMessage(message, 'ANALYZER-1');
    const checksum = framed.slice(-5, -3);

    expect(framed.startsWith('\x021H|')).toBe(true);
    expect(framed.endsWith('\r\n\x04')).toBe(true);
    expect(checksum).toBe(service.calculateChecksum(framed));
  });

  it('numbers outbound frames 1 to 7 then 0 and restarts at 1 after EOT', () => {
    const service = createService();
    const numbers = Array.from({ length: 9 }, () => service.getAndUpdateSequenceNumber('ANALYZER-1'));

    expect(numbers).toEqual(['1', '2', '3', '4', '5', '6', '7', '0', '1']);

    service.frameASTMMessage('H|\\^&\r', 'ANALYZER-1');
    const nextMessage = service.frameASTMMessage('H|\\^&\r', 'ANALYZER-1');
    expect(nextMessage.startsWith('\x021H|')).toBe(true);
  });

  it('checksums an ETB frame through the ETB byte', () => {
    const service = createService();
    const etxFrame = '\x021H|\\^&\r\x03';
    const etbFrame = '\x021H|\\^&\r\x17';

    expect(service.calculateChecksum(etxFrame)).toBe(service.calculateChecksum(etxFrame + 'XX\r\n\x04'));
    expect(service.calculateChecksum(etbFrame)).toBe(service.calculateChecksum(etbFrame + 'XX\r\n'));
    expect(service.calculateChecksum(etbFrame)).not.toBe(service.calculateChecksum(etxFrame));
  });

  it('tokenizes control bytes, frames and unframed text from the inbound stream', () => {
    const service = createService();
    const body = '\x021H|\\^&|||LAB001\r\x03';
    const checksum = service.calculateChecksum(body);
    const stream = `\x05${body}${checksum}\r\n${body}00\r\n${body}${checksum.toLowerCase()}\x17LOOSE\x04\x02`;

    const { tokens, remainder } = service.extractASTMFrames(stream);

    expect(tokens.map(token => token.kind)).toEqual(['control', 'frame', 'frame', 'frame', 'unframed', 'control']);
    expect(tokens[0].text).toBe('\x05');
    expect(tokens[1]).toMatchObject({ valid: true, expected: checksum, received: checksum });
    expect(tokens[2]).toMatchObject({ valid: false, expected: checksum, received: '00' });
    expect(tokens[3]).toMatchObject({ valid: true });
    expect(tokens[4].text).toBe('\x17LOOSE');
    expect(tokens[5].text).toBe('\x04');
    expect(remainder).toBe('\x02');
  });

  it('holds back a frame until its checksum characters have arrived', () => {
    const service = createService();
    const body = '\x021H|\\^&|||LAB001\r\x03';
    const checksum = service.calculateChecksum(body);

    expect(service.extractASTMFrames(body + checksum.charAt(0))).toEqual({ tokens: [], remainder: body + checksum.charAt(0) });
    expect(service.extractASTMFrames(body + checksum).tokens).toHaveLength(1);
    expect(service.extractASTMFrames('\r\n' + body + checksum + '\r').remainder).toBe('');
  });

  it('keeps concurrent instrument transmissions isolated until EOT', () => {
    const service = createService();
    const instrumentA = { instrumentId: 'ANALYZER-A' };
    const instrumentB = { instrumentId: 'ANALYZER-B' };
    const payloadA = 'H|\\^&|||LAB001\rO|1|SAMPLE-A||^^^HIVVL\rR|1|^^^HIVVL|1250|copies/mL\r';
    const payloadB = 'H|\\^&|||LAB001\rO|1|SAMPLE-B||^^^HIVVL\rR|1|^^^HIVVL|Target Not Detected|\r';

    service.appendASTMChunk(instrumentA, payloadA, 'astm-nonchecksum', service.processASTMText(payloadA));
    service.appendASTMChunk(instrumentB, payloadB, 'astm-nonchecksum', service.processASTMText(payloadB));

    const resultB = service.appendASTMChunk(
      instrumentB,
      '\x04',
      'astm-nonchecksum',
      service.processASTMText('\x04')
    );
    const resultA = service.appendASTMChunk(
      instrumentA,
      '\x04',
      'astm-nonchecksum',
      service.processASTMText('\x04')
    );

    expect(resultA.rawData).toContain('SAMPLE-A');
    expect(resultA.rawData).not.toContain('SAMPLE-B');
    expect(resultB.rawData).toContain('SAMPLE-B');
    expect(resultB.rawData).not.toContain('SAMPLE-A');
  });

  it('extracts a complete result from a representative ASTM transmission', () => {
    const service = createService();
    const instrument = { instrumentId: 'ANALYZER-1' };
    const payload = [
      'H|\\^&|||LAB001',
      'P|1',
      'O|1|SAMPLE-001||^^^HIVVL|||||||||||||||||||||F',
      'R|1|^^^HIVVL|1250|copies/mL||||||TECH-1||20260714113000',
      'L|1|N',
      ''
    ].join('\r');

    service.appendASTMChunk(instrument, payload, 'astm-nonchecksum', service.processASTMText(payload));
    const result = service.appendASTMChunk(
      instrument,
      '\x04',
      'astm-nonchecksum',
      service.processASTMText('\x04')
    );

    expect(result.completed).toBe(true);
    expect(result.sampleResults).toHaveLength(1);
    expect(result.sampleResults?.[0]).toMatchObject({
      order_id: 'SAMPLE-001',
      test_id: 'SAMPLE-001',
      test_type: 'HIVVL',
      results: '1250',
      test_unit: 'copies/mL'
    });
  });

  it('uses ASTM specimen fields instead of the O-record sequence number', () => {
    const service = createService();
    const data = service.getASTMDataBlock([
      'O|7|PRIMARY-001|ANALYZER-001|^^^HIVVL',
      'R|1|^^^HIVVL|1250|copies/mL'
    ]);

    const result = service.extractSampleResultFromASTM(data, '');

    expect(result).toMatchObject({
      order_id: 'PRIMARY-001',
      test_id: 'ANALYZER-001'
    });
    expect(result.test_id).not.toBe('7');
  });

  it('falls back to the primary specimen ID when the instrument ID is absent', () => {
    const service = createService();
    const data = service.getASTMDataBlock([
      'O|1|PRIMARY-002||^^^HIVVL',
      'R|1|^^^HIVVL|1250|copies/mL'
    ]);

    const result = service.extractSampleResultFromASTM(data, '');

    expect(result).toMatchObject({
      order_id: 'PRIMARY-002',
      test_id: 'PRIMARY-002'
    });
    expect(result.test_id).not.toBe('1');
  });

  it('does not emit a result before an incomplete transmission receives EOT', () => {
    const service = createService();
    const instrument = { instrumentId: 'ANALYZER-1' };
    const partialPayload = 'H|\\^&|||LAB001\rO|1|SAMPLE-001||^^^HIVVL\r';

    const result = service.appendASTMChunk(
      instrument,
      partialPayload,
      'astm-nonchecksum',
      service.processASTMText(partialPayload)
    );

    expect(result).toEqual({ completed: false });
    service.clearInstrumentBuffer('ANALYZER-1');
  });

  it('completes malformed ASTM payloads without inventing sample results', () => {
    const service = createService();
    const instrument = { instrumentId: 'ANALYZER-1' };
    const malformedPayload = 'H|\\^&|||LAB001\rR|1|^^^HIVVL|1250|copies/mL\r';

    service.appendASTMChunk(
      instrument,
      malformedPayload,
      'astm-nonchecksum',
      service.processASTMText(malformedPayload)
    );
    const result = service.appendASTMChunk(
      instrument,
      '\x04',
      'astm-nonchecksum',
      service.processASTMText('\x04')
    );

    expect(result.completed).toBe(true);
    expect(result.sampleResults).toEqual([]);
  });

  it('discards an oversized incomplete ASTM transmission', () => {
    const service = createService();
    const transmissionStatusSubject = new BehaviorSubject(true);
    const instrument = { instrumentId: 'ANALYZER-1', transmissionStatusSubject };
    const maximumBytes = ASTMHelperService.MAX_INCOMPLETE_BUFFER_BYTES;
    const payload = `H|\\^&|||LAB001\r${'X'.repeat(maximumBytes)}`;

    const result = service.appendASTMChunk(
      instrument,
      payload,
      'astm-nonchecksum',
      service.processASTMText(payload)
    );

    expect(result).toEqual({ completed: false, discarded: true });
    expect((service as any).astmBuffers.has('ANALYZER-1')).toBe(false);
    expect(transmissionStatusSubject.value).toBe(false);
  });

  it('discards an inactive incomplete ASTM transmission', () => {
    vi.useFakeTimers();
    const service = createService();
    const transmissionStatusSubject = new BehaviorSubject(true);
    const instrument = { instrumentId: 'ANALYZER-1', transmissionStatusSubject };
    const payload = 'H|\\^&|||LAB001\rO|1|SAMPLE-001||^^^HIVVL\r';

    service.appendASTMChunk(
      instrument,
      payload,
      'astm-nonchecksum',
      service.processASTMText(payload)
    );
    vi.advanceTimersByTime(ASTMHelperService.BUFFER_INACTIVITY_TIMEOUT_MS);

    expect((service as any).astmBuffers.has('ANALYZER-1')).toBe(false);
    expect(transmissionStatusSubject.value).toBe(false);
  });
});
