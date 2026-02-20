import { HL7HelperService } from './hl7-helper.service';

describe('HL7HelperService', () => {
  let service: HL7HelperService;

  const utilitiesServiceStub = {
    decodeHtmlEntities: (text: string) => text
  };

  const createObxSegment = (fields: Record<string, string>) => ({
    get: (path: string) => {
      if (!(path in fields)) {
        return null;
      }
      return {
        toString: () => fields[path]
      };
    }
  });

  beforeEach(() => {
    service = new HL7HelperService(utilitiesServiceStub as any);
  });

  it('maps Roche BT OBX-8 flag to Target Not Detected when OBX-5 is empty', () => {
    const obx = createObxSegment({
      'OBX.5.1': '',
      'OBX.8': 'BT^^99ROC',
      'OBX.11': 'F'
    });

    const result = service.processHL7ResultValue(obx, service.getHL7ResultStatusType(obx));

    expect(result.results).toBe('Target Not Detected');
    expect(result.test_unit).toBe('');
    expect(result.notes).toBe('');
  });

  it('maps Roche ND OBX-8 flag to Target Not Detected when OBX-5 is empty', () => {
    const obx = createObxSegment({
      'OBX.5.1': '',
      'OBX.8': 'ND^^99ROC',
      'OBX.11': 'F'
    });

    const result = service.processHL7ResultValue(obx, service.getHL7ResultStatusType(obx));

    expect(result.results).toBe('Target Not Detected');
    expect(result.test_unit).toBe('');
    expect(result.notes).toBe('');
  });

  it('treats Roche Uxx flags in OBX-8 as ERROR status', () => {
    const obx = createObxSegment({
      'OBX.5.1': '',
      'OBX.8.1': 'U06T',
      'OBX.11': 'F'
    });

    expect(service.getHL7ResultStatusType(obx)).toBe('ERROR');
  });

  it('preserves OBX-8 text for ERROR when no OBX-5 value exists', () => {
    const obx = createObxSegment({
      'OBX.5.1': '',
      'OBX.8': 'U06T^Pipetting anomaly detected during sample aspiration.^99ROC',
      'OBX.8.1': 'U06T',
      'OBX.11': 'F'
    });

    const result = service.processHL7ResultValue(obx, service.getHL7ResultStatusType(obx));

    expect(result.results).toBe('Failed');
    expect(result.test_unit).toBe('');
    expect(result.notes).toBe('Pipetting anomaly detected during sample aspiration.');
  });

  it('keeps standard OBX-5 result path unchanged', () => {
    const obx = createObxSegment({
      'OBX.5.1': '1250',
      'OBX.6.1': 'copies/mL',
      'OBX.11': 'F'
    });

    const result = service.processHL7ResultValue(obx, service.getHL7ResultStatusType(obx));

    expect(result.results).toBe('1250');
    expect(result.test_unit).toBe('copies/mL');
    expect(result.notes).toBe('');
  });
});
