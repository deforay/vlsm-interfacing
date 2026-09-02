/**
 * HL7 v2 OUL^R22 result messages shaped like the analyzers this tool is
 * deployed against. Segment layouts follow each vendor's LIS specification;
 * values are synthetic. Replace or extend with captured transmissions from the
 * raw_data table when they are available.
 */
import { CR, hl7Segment } from '../wire-harness';

export const RUN_DATE = '20260714113000';
export const RUN_DATE_FORMATTED = '2026-07-14 11:30:00';

export function msh(sendingApplication: string, messageId: string, options: {
  version?: string;
  characterSet?: string;
  profile?: string;
} = {}): string {
  return hl7Segment('MSH', {
    1: '^~\\&',
    2: sendingApplication,
    3: 'LAB001',
    4: 'LIS',
    5: 'LAB001',
    6: RUN_DATE,
    8: 'OUL^R22^OUL_R22',
    9: messageId,
    10: 'P',
    11: options.version ?? '2.5.1',
    14: 'NE',
    15: 'AL',
    17: options.characterSet ?? 'UNICODE UTF-8',
    20: options.profile ?? ''
  });
}

export function obx(setId: number, fields: Record<number, string>): string {
  return hl7Segment('OBX', { 1: String(setId), ...fields });
}

export const message = (segments: string[]) => segments.join(CR);

/** Generic analyzer: SPM.2 carries the sample ID, OBX.4 matches the SPM set ID. */
export const GENERIC_HIV_VL = message([
  msh('GeneXpert', 'MSG-GX-001'),
  'SPM|1|SAMPLE-GX-001||PLAS',
  'OBR|1|||HIVVL^HIV-1 Viral Load',
  obx(1, { 2: 'ST', 3: 'HIVVL^HIV-1 Viral Load', 4: '1', 5: '1250', 6: 'copies/mL', 11: 'F', 16: 'TECH-1', 19: RUN_DATE })
]);

/** Generic analyzer batch: three samples in one message. */
export const GENERIC_BATCH = message([
  msh('GeneXpert', 'MSG-GX-BATCH'),
  'SPM|1|SAMPLE-B-001',
  'OBR|1|||HIVVL^HIV-1 Viral Load',
  obx(1, { 2: 'ST', 3: 'HIVVL^HIV-1 Viral Load', 4: '1', 5: '820', 6: 'copies/mL', 11: 'F', 19: RUN_DATE }),
  'SPM|2|SAMPLE-B-002',
  'OBR|2|||HIVVL^HIV-1 Viral Load',
  obx(2, { 2: 'ST', 3: 'HIVVL^HIV-1 Viral Load', 4: '2', 5: 'Target Not Detected', 6: 'copies/mL', 11: 'F', 19: RUN_DATE }),
  'SPM|3|SAMPLE-B-003',
  'OBR|3|||HIVVL^HIV-1 Viral Load',
  obx(3, { 2: 'ST', 3: 'HIVVL^HIV-1 Viral Load', 4: '3', 5: '15400', 6: 'copies/mL', 11: 'F', 19: RUN_DATE })
]);

/** Roche cobas 6800/8800: result in the OBX whose OBX.4 is 1/2, sample ID suffixed &ROCHE. */
export function roche6800(sampleId: string, messageId: string, resultFields: Record<number, string>): string {
  return message([
    msh('cobas 6800/8800', messageId, { profile: 'LAB-27^ROCHE' }),
    `SPM|1|${sampleId}&ROCHE||PLAS^^HL70487`,
    `SAC|||${sampleId}`,
    'OBR|1|||70241-5^HIV-1 RNA^LN',
    obx(1, { 2: 'ST', 3: '70241-5^HIV1^LN', 4: '1/2', 6: 'copies/mL^^UCUM', 11: 'F', 16: 'TECH-1', 19: RUN_DATE, ...resultFields }),
    obx(2, { 2: 'ST', 3: '70241-5^HIV1^LN', 4: '2/2', 5: '3.10', 6: 'Log10', 11: 'F', 19: RUN_DATE })
  ]);
}

export const ROCHE_6800_QUANTIFIED = roche6800('SAMPLE-6800-001', 'MSG-6800-001', { 5: '1250' });
export const ROCHE_6800_BELOW_RANGE = roche6800('SAMPLE-6800-002', 'MSG-6800-002', { 5: '<20' });
export const ROCHE_6800_TARGET_NOT_DETECTED_FLAG = roche6800('SAMPLE-6800-003', 'MSG-6800-003', { 5: '', 8: 'BT^^99ROC' });
export const ROCHE_6800_ABOVE_RANGE = roche6800('SAMPLE-6800-004', 'MSG-6800-004', { 5: '> Titer max' });
export const ROCHE_6800_INSTRUMENT_ERROR = roche6800('SAMPLE-6800-005', 'MSG-6800-005', { 5: '', 8: 'U06T^Clot detected^99ROC', 11: 'X' });
export const ROCHE_6800_TITER = roche6800('SAMPLE-6800-006', 'MSG-6800-006', { 5: 'Titer' });

/** Roche cobas 5800: single OBX per sample, OBX.4 carries the sample set ID. */
export const ROCHE_5800_QUANTIFIED = message([
  msh('cobas 5800', 'MSG-5800-001', { profile: 'LAB-27^ROCHE' }),
  'SPM|1|SAMPLE-5800-001&ROCHE||PLAS^^HL70487',
  'OBR|1|||70241-5^HIV-1 RNA^LN',
  obx(1, { 2: 'ST', 3: '70241-5^HIV1^LN', 4: '1', 5: '3400', 6: 'copies/mL^^UCUM', 11: 'F', 16: 'TECH-3', 19: RUN_DATE })
]);

/** Roche cobas 5800: instrument flag with no numeric value. */
export const ROCHE_5800_NOT_DETECTED_FLAG = message([
  msh('cobas 5800', 'MSG-5800-002', { profile: 'LAB-27^ROCHE' }),
  'SPM|1|SAMPLE-5800-002&ROCHE||PLAS^^HL70487',
  'OBR|1|||70241-5^HIV-1 RNA^LN',
  obx(1, { 2: 'ST', 3: '70241-5^HIV1^LN', 4: '1', 5: '', 8: 'ND^^99ROC', 11: 'F', 19: RUN_DATE })
]);

/** Abbott Alinity m: sample ID in SPM.3, first OBX carries the result. */
export const ALINITY_M_QUANTIFIED = message([
  msh('Alinity m', 'MSG-ALM-001'),
  'SPM|1|RACK-7^3|SAMPLE-ALM-001||PLAS',
  'OBR|1|||HIV1RNA^HIV-1 Viral Load',
  obx(1, { 2: 'ST', 3: 'HIV1RNA^HIV-1 Viral Load', 4: '1', 5: '5600', 6: 'copies/mL', 11: 'F', 16: 'TECH-4', 19: RUN_DATE }),
  obx(2, { 2: 'DR', 3: 'RunTimeRange', 4: '1', 5: `${RUN_DATE}^${RUN_DATE}`, 11: 'F' })
]);

/** Result the analyzer marked as still running. */
export const GENERIC_INCOMPLETE = message([
  msh('GeneXpert', 'MSG-GX-INC'),
  'SPM|1|SAMPLE-GX-INC',
  'OBR|1|||HIVVL^HIV-1 Viral Load',
  obx(1, { 2: 'ST', 3: 'HIVVL^HIV-1 Viral Load', 4: '1', 5: 'In progress', 6: '', 11: 'I', 19: RUN_DATE })
]);

/** Result the analyzer rejected. */
export const GENERIC_ERROR = message([
  msh('GeneXpert', 'MSG-GX-ERR'),
  'SPM|1|SAMPLE-GX-ERR',
  'OBR|1|||HIVVL^HIV-1 Viral Load',
  obx(1, { 2: 'ST', 3: 'HIVVL^HIV-1 Viral Load', 4: '1', 5: 'Error 2008: Probe check failed', 6: '', 11: 'X', 19: RUN_DATE })
]);

/** Value HTML-encoded by middleware. */
export const GENERIC_ENCODED_VALUE = message([
  msh('GeneXpert', 'MSG-GX-ENC'),
  'SPM|1|SAMPLE-GX-ENC',
  'OBR|1|||HIVVL^HIV-1 Viral Load',
  obx(1, { 2: 'ST', 3: 'HIVVL^HIV-1 Viral Load', 4: '1', 5: '&lt;40', 6: 'copies/mL', 11: 'F', 19: RUN_DATE })
]);

/** Operator recorded on OBR.34 rather than OBX.16. */
export const GENERIC_TESTER_ON_OBR = message([
  msh('GeneXpert', 'MSG-GX-OBR'),
  'SPM|1|SAMPLE-GX-OBR',
  hl7Segment('OBR', { 1: '1', 4: 'HIVVL^HIV-1 Viral Load', 34: 'TECH-OBR' }),
  obx(1, { 2: 'ST', 3: 'HIVVL^HIV-1 Viral Load', 4: '1', 5: '77', 6: 'copies/mL', 11: 'F', 19: RUN_DATE })
]);

/** Message with no specimen: cannot be attributed to a sample. */
export const MISSING_SPM = message([
  msh('GeneXpert', 'MSG-GX-NOSPM'),
  'OBR|1|||HIVVL^HIV-1 Viral Load',
  obx(1, { 2: 'ST', 3: 'HIVVL^HIV-1 Viral Load', 4: '1', 5: '1250', 6: 'copies/mL', 11: 'F' })
]);

/** Message with a specimen but no observation. */
export const MISSING_OBX = message([
  msh('GeneXpert', 'MSG-GX-NOOBX'),
  'SPM|1|SAMPLE-GX-NOOBX',
  'OBR|1|||HIVVL^HIV-1 Viral Load'
]);
