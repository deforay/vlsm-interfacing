import { describe, expect, it, vi } from 'vitest';
import { ASTMHelperService } from './astm-helper.service';
import { UtilitiesService } from './utilities.service';

describe('ASTMHelperService', () => {
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
});
