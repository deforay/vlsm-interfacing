/**
 * ASTM E1394 record sets shaped like the analyzers this tool is deployed
 * against. Field positions follow each vendor's LIS specification; values are
 * synthetic. Replace or extend with captured transmissions from the raw_data
 * table when they are available.
 */
import { astmRecord } from '../wire-harness';

export const RUN_DATE = '20260714113000';
export const RUN_DATE_FORMATTED = '2026-07-14 11:30:00';

/** O record: specimen IDs in O.3/O.4, test in O.5, report type in O.26. */
export function orderRecord(sequence: number, specimenId: string, testId: string, options: {
  instrumentSpecimenId?: string;
  status?: string;
} = {}): string {
  return astmRecord('O', {
    1: String(sequence),
    2: specimenId,
    3: options.instrumentSpecimenId ?? '',
    4: testId,
    5: 'R',
    25: options.status ?? 'F'
  });
}

/** R record: test in R.3, value in R.4, units in R.5, operator in R.11, time in R.13. */
export function resultRecord(sequence: number, testId: string, value: string, unit: string, options: {
  tester?: string;
  date?: string;
} = {}): string {
  return astmRecord('R', {
    1: String(sequence),
    2: testId,
    3: value,
    4: unit,
    8: 'F',
    10: options.tester ?? 'TECH-1',
    12: options.date ?? RUN_DATE
  });
}

export const ABBOTT_M2000_HEADER = `H|\\^&|||m2000^8.20^Abbott|||||||P|1|${RUN_DATE}`;
export const GENEXPERT_HEADER = `H|\\^&|||GeneXpert^6.4|||||LIS||P|1394-97|${RUN_DATE}`;
export const TERMINATOR = 'L|1|N';

/** Abbott m2000 RealTime HIV-1 quantitative result. */
export const ABBOTT_M2000_HIV_VL = [
  ABBOTT_M2000_HEADER,
  'P|1',
  orderRecord(1, 'SAMPLE-M2000-001', '^^^HIV1RNA'),
  resultRecord(1, '^^^HIV1RNA', '1250', 'copies/mL'),
  TERMINATOR
];

/** Cepheid GeneXpert HIV-1 viral load with an undetectable outcome. */
export const GENEXPERT_HIV_VL_NOT_DETECTED = [
  GENEXPERT_HEADER,
  'P|1',
  orderRecord(1, 'SAMPLE-GX-001', '^^^HIV-1 VL', { instrumentSpecimenId: 'GX-RUN-77' }),
  resultRecord(1, '^^^HIV-1 VL', 'Target Not Detected', 'copies/mL', { tester: 'TECH-2' }),
  TERMINATOR
];

/** Batch upload: one header, several patients. */
export const ABBOTT_M2000_BATCH = [
  ABBOTT_M2000_HEADER,
  'P|1',
  orderRecord(1, 'SAMPLE-BATCH-001', '^^^HIV1RNA'),
  resultRecord(1, '^^^HIV1RNA', '820', 'copies/mL'),
  'P|2',
  orderRecord(1, 'SAMPLE-BATCH-002', '^^^HIV1RNA'),
  resultRecord(1, '^^^HIV1RNA', 'Target Not Detected', 'copies/mL'),
  'P|3',
  orderRecord(1, 'SAMPLE-BATCH-003', '^^^HIV1RNA', { status: 'P' }),
  resultRecord(1, '^^^HIV1RNA', '15400', 'copies/mL'),
  TERMINATOR
];

/** An order the analyzer could not complete: no R record follows. */
export const ABBOTT_M2000_NO_RESULT = [
  ABBOTT_M2000_HEADER,
  'P|1',
  orderRecord(1, 'SAMPLE-M2000-ERR', '^^^HIV1RNA', { status: 'X' }),
  TERMINATOR
];

/** Result whose value is HTML-encoded by the analyzer middleware. */
export const ABBOTT_M2000_ENCODED_VALUE = [
  ABBOTT_M2000_HEADER,
  'P|1',
  orderRecord(1, 'SAMPLE-M2000-LOW', '^^^HIV1RNA'),
  resultRecord(1, '^^^HIV1RNA', '&lt;40', 'copies/mL'),
  TERMINATOR
];

/** A record long enough to need ETB continuation across frames. */
export const ABBOTT_M2000_LONG_COMMENT = [
  ABBOTT_M2000_HEADER,
  'P|1',
  orderRecord(1, 'SAMPLE-M2000-LONG', '^^^HIV1RNA'),
  resultRecord(1, '^^^HIV1RNA', '98765', 'copies/mL'),
  `C|1|I|${'Reagent lot 12345678 within expiry; calibration verified; '.repeat(6)}|G`,
  TERMINATOR
];
