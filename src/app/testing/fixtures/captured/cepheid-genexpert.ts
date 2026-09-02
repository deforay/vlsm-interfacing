/**
 * Cepheid GeneXpert (software 5.3 and 6.2), ASTM E1394 over E1381, as
 * captured from laboratories in Zimbabwe and South Sudan. Identifiers,
 * operators and dates are replaced; record layouts, value formats and the
 * framing are as transmitted.
 *
 * What the capture showed:
 * - The H record declares the delimiters as "@^\" rather than "\^&".
 * - One message per test, each in its own session (ENQ ... EOT).
 * - Frames are filled to 240 bytes and cut wherever that falls, so records
 *   are split across ETB continuation frames, often mid-field.
 * - O.3 is whatever the operator typed as the sample ID, sometimes a
 *   patient name. O.5 is "^^^<assay>". O.26 is F.
 * - R.1 is the assay result with a trailing component separator:
 *   "NOT DETECTED^", "DETECTED^", "ERROR^", "INVALID^". For viral load the
 *   number sits in the second component ("^1234.56"), R.5 is copies/mL and
 *   R.6 the reportable range. R.11 is the operator, R.13 the end time.
 * - Further R records carry analyte, Ct and endpoint details; a C record
 *   explains an error as "Error^code^title^description^timestamp".
 */
import { CR, EOT, ENQ, astmFrame } from '../../wire-harness';

export const GENEXPERT_OPERATOR = 'ALBERT MUDUNGWE';
export const GENEXPERT_START_TIME = '20260129114918';
export const GENEXPERT_END_TIME = '20260129115359';
export const GENEXPERT_END_TIME_FORMATTED = '2026-01-29 11:53:59';
const CARTRIDGE = 'Cepheid-1F21001^806911^630912^1113243530^72203^20260825';
export const GENEXPERT_HEADER = 'H|@^\\|GXM-00000000001||MOH - HARARE HOSPITAL LAB - 806911^GeneXpert^6.2|||||Harare Hospital - 80||P|1394-97|20260307161412';

export interface GeneXpertTest {
  sampleId: string;
  patientId?: string;
  assay: 'HIV-1_QUAL 2' | 'HIV-1_VL 2 2' | 'MTB-RIF_ULTRA 2';
  /** "NOT DETECTED", "DETECTED", "ERROR", "INVALID", or a viral load number */
  result: string;
  error?: { code: string; title: string; description: string };
}

function resultRecord(sequence: number, test: string, value: string, unit = '', range = ''): string {
  return `R|${sequence}|${test}|${value}|${unit}|${range}|${range ? 'A' : ''}||F||${GENEXPERT_OPERATOR}|${GENEXPERT_START_TIME}|${GENEXPERT_END_TIME}|${CARTRIDGE}|`;
}

function detail(sequence: number, test: string, value: string): string {
  return `R|${sequence}|${test}|${value}|||`;
}

export function genexpertMessage(test: GeneXpertTest): string[] {
  const records = [
    GENEXPERT_HEADER,
    `P|1|||${test.patientId ?? test.sampleId}|^^^^|||||||||||||||||||||||||||||`,
    `O|1|${test.sampleId}||^^^${test.assay}|R|${GENEXPERT_START_TIME}|||||||||ORH||||||||||F`
  ];
  const outcome = test.result;
  if (test.assay === 'HIV-1_VL 2 2') {
    const numeric = /^\d/.test(outcome);
    records.push(
      resultRecord(1, `^^^${test.assay}^Xpert_HIV-1 Viral Load^2^^`, numeric ? `^${outcome}` : `${outcome}^`, 'copies/mL', '40.00 to 10000000.00'),
      resultRecord(2, `^^^${test.assay}^Xpert_HIV-1 Viral Load^2^^LOG`, numeric ? `^${Math.log10(Number(outcome)).toFixed(2)}` : '^', 'copies/mL', '1.60 to 7.00'),
      detail(3, `^^^${test.assay}^^^HIV-1^`, numeric ? 'POS^' : 'NEG^'),
      detail(4, `^^^${test.assay}^^^HIV-1^Ct`, numeric ? '^26.4' : '^0.0'),
      detail(5, `^^^${test.assay}^^^HIV-1^EndPt`, numeric ? '^312.0' : '^-7.0'),
      detail(6, `^^^${test.assay}^^^HIV-1^Delta Ct`, '^'),
      detail(7, `^^^${test.assay}^^^IQS-H^`, 'PASS^'),
      detail(8, `^^^${test.assay}^^^IQS-H^Ct`, '^23.7'),
      detail(9, `^^^${test.assay}^^^IQS-H^EndPt`, '^268.0'),
      detail(10, `^^^${test.assay}^^^IQS-L^`, 'PASS^'),
      detail(11, `^^^${test.assay}^^^IQS-L^Ct`, '^33.4'),
      detail(12, `^^^${test.assay}^^^IQS-L^EndPt`, '^478.0')
    );
  } else {
    const assayName = test.assay === 'MTB-RIF_ULTRA 2' ? 'Xpert MTB-RIF Ultra^4^MTB^' : 'Xpert_HIV-1 Qual^2^HIV-1^';
    const analyte = test.assay === 'MTB-RIF_ULTRA 2' ? 'MTB' : 'HIV-1';
    const failed = outcome === 'ERROR' || outcome === 'INVALID';
    records.push(resultRecord(1, `^${test.assay}^^^${assayName}`, `${outcome}^`));
    if (test.error) {
      records.push(`C|1|I|Error^${test.error.code}^${test.error.title}^${test.error.description}^${GENEXPERT_END_TIME}|N`);
    }
    records.push(
      detail(2, `^^^${test.assay}^^^SPC^`, failed ? 'NO RESULT^' : 'PASS^'),
      detail(3, `^^^${test.assay}^^^SPC^Ct`, failed ? '^0.0' : '^34.3'),
      detail(4, `^^^${test.assay}^^^SPC^EndPt`, failed ? '^0.0' : '^231.0'),
      detail(5, `^^^${test.assay}^^^${analyte}^`, failed ? 'NO RESULT^' : outcome === 'DETECTED' ? 'POS^' : 'NEG^'),
      detail(6, `^^^${test.assay}^^^${analyte}^Ct`, outcome === 'DETECTED' ? '^24.8' : '^0.0'),
      detail(7, `^^^${test.assay}^^^${analyte}^EndPt`, outcome === 'DETECTED' ? '^446.0' : '^0.0'),
      resultRecord(8, `^${test.assay}^^^${assayName.replace(/\^[^^]*\^$/, '^QC^')}`, failed ? `${outcome}^` : '^')
    );
    if (test.error) {
      records.push(`C|1|I|Error^${test.error.code}^${test.error.title}^${test.error.description}^${GENEXPERT_END_TIME}|N`);
    }
    records.push(
      detail(9, `^^^${test.assay}^^^QC-1^`, failed ? 'NO RESULT^' : 'NEG^'),
      detail(10, `^^^${test.assay}^^^QC-1^Ct`, '^0.0'),
      detail(11, `^^^${test.assay}^^^QC-1^EndPt`, '^0.0'),
      detail(12, `^^^${test.assay}^^^QC-2^`, failed ? 'NO RESULT^' : 'NEG^'),
      detail(13, `^^^${test.assay}^^^QC-2^Ct`, '^0.0'),
      detail(14, `^^^${test.assay}^^^QC-2^EndPt`, '^0.0')
    );
  }
  records.push('L|1|N');
  return records;
}

/**
 * Frames a message the way the GeneXpert does: the records, each ending in
 * CR, form one stream cut into 240-byte bodies. Every frame but the last ends
 * in ETB; the last ends in ETX.
 */
export function genexpertFrames(records: string[], maxBody = 240): string[] {
  const stream = records.map(record => record + CR).join('');
  const frames: string[] = [];
  for (let offset = 0, frameNumber = 1; offset < stream.length; offset += maxBody, frameNumber = (frameNumber + 1) % 8) {
    const body = stream.slice(offset, offset + maxBody);
    const last = offset + maxBody >= stream.length;
    frames.push(astmFrame(frameNumber, body, { terminator: last ? 'ETX' : 'ETB' }));
  }
  return frames;
}

export function genexpertSession(test: GeneXpertTest): string {
  return ENQ + genexpertFrames(genexpertMessage(test)).join('') + EOT;
}

export const GENEXPERT_TESTS: GeneXpertTest[] = [
  { sampleId: 'EID26000576U', assay: 'HIV-1_QUAL 2', result: 'DETECTED' },
  { sampleId: 'EID26000580O', assay: 'HIV-1_QUAL 2', result: 'NOT DETECTED' },
  { sampleId: 'VALERIAH M', assay: 'HIV-1_QUAL 2', result: 'ERROR', error: { code: '2097', title: 'Operation terminated', description: 'Error 2097: Assay-Specific Termination Error #2: 46, 7, 1, 0' } },
  { sampleId: 'bp26-00064', assay: 'HIV-1_VL 2 2', result: 'NOT DETECTED' },
  { sampleId: 'bp26-00065', assay: 'HIV-1_VL 2 2', result: '1234.56' },
  { sampleId: 'sp26-00147', assay: 'MTB-RIF_ULTRA 2', result: 'NOT DETECTED' }
];
