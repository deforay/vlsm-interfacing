/**
 * Abbott m2000 RealTime HIV-1, ASTM E1394 over E1381, as captured from a
 * production laboratory (software 8.1.9.0). Identifiers, serials, run names
 * and dates are replaced; every field position, value format and control
 * byte is as transmitted.
 *
 * What the capture showed:
 * - One E1381 session carries a whole run: ENQ, then for every sample a full
 *   H P O R R R L message, then a single EOT. Around 96 samples per run.
 * - One record per frame, never ETB. Frame numbers run 1..7,0 continuously
 *   across the messages of a session. Every frame carries a valid checksum.
 * - R.1 is the final result (test id suffix ^F), R.2 the interpretation
 *   (^I) and R.3 the cycle number (^P). Values: "Not detected", "< 40", or
 *   a number, unit "Copies / mL".
 * - A failed order has O.26 = X, no R records, and a C record with the
 *   analyzer's error text.
 * - Controls appear as ordinary orders with IDs HIV_NEG, HIV_LOPOS, HIV_HIPOS.
 * - Between runs the analyzer opens and closes empty sessions (ENQ EOT), and
 *   an occasional NUL byte precedes ENQ.
 */
import { CR, EOT, ENQ, astmFrame } from '../../wire-harness';

export const M2000_SERIAL = '275000001';
export const M2000_HEADER = `H|\\^&|||m2000^8.1.9.0^${M2000_SERIAL}^H1P1O1R1C1L1|||||||P|1|20260112122248`;
export const M2000_RUN = 'HIV120126A';
export const M2000_OPERATOR = 'admin^Administrator';
export const M2000_RESULT_TIME = '20260112122150';
export const M2000_RESULT_TIME_FORMATTED = '2026-01-12 12:21:50';
const TEST = '^^^HIV0.6ml^HIV0.6ml';
const ASSAY_LOT = '395139^10004558';

export interface M2000Sample {
  specimenId: string;
  well: string;
  /** Final result as the analyzer prints it: "Not detected", "< 40", "1250" */
  result?: string;
  interpretation?: string;
  cycleNumber?: string;
  /** Present for a failed order instead of results */
  error?: string;
}

/** The H..L message for one sample, one record per entry. */
export function m2000Message(sample: M2000Sample): string[] {
  const order = `O|1|${sample.specimenId}|${sample.specimenId}^${M2000_RUN}^${sample.well}|${TEST}|||||||||||||||||||||${sample.error ? 'X' : 'F'}`;
  const records = [M2000_HEADER, 'P|1', order];
  if (sample.error) {
    records.push(`C|1|I|${sample.error}|I`);
  } else {
    records.push(
      `R|1|${TEST}^${ASSAY_LOT}^^F|${sample.result}|Copies / mL||||F||${M2000_OPERATOR}||${M2000_RESULT_TIME}|${M2000_SERIAL}`,
      `R|2|${TEST}^${ASSAY_LOT}^^I|${sample.interpretation ?? (sample.result === 'Not detected' ? 'Target not detected' : 'Detected')}|||||F||${M2000_OPERATOR}||${M2000_RESULT_TIME}|${M2000_SERIAL}`,
      `R|3|${TEST}^${ASSAY_LOT}^^P|${sample.cycleNumber ?? (sample.result === 'Not detected' ? '-1.00' : '28.93')}|cycle number||||F||${M2000_OPERATOR}||${M2000_RESULT_TIME}|${M2000_SERIAL}`
    );
  }
  records.push('L|1');
  return records;
}

/** Frames every record of every message, numbering frames continuously as the m2000 does. */
export function m2000Frames(messages: string[][], firstFrameNumber = 1): string[] {
  let frameNumber = firstFrameNumber;
  const frames: string[] = [];
  for (const message of messages) {
    for (const record of message) {
      frames.push(astmFrame(frameNumber, record + CR));
      frameNumber = (frameNumber + 1) % 8;
    }
  }
  return frames;
}

/** A whole run as one E1381 session. */
export function m2000Session(samples: M2000Sample[]): string {
  return ENQ + m2000Frames(samples.map(m2000Message)).join('') + EOT;
}

export const M2000_RUN_SAMPLES: M2000Sample[] = [
  { specimenId: 'HIV_NEG', well: 'A1', result: 'Not detected' },
  { specimenId: 'HIV_LOPOS', well: 'A2', result: '1523', cycleNumber: '27.10' },
  { specimenId: 'HIV_HIPOS', well: 'A3', result: '1094012', cycleNumber: '15.42' },
  { specimenId: 'VL00000001', well: 'A4', result: 'Not detected' },
  { specimenId: 'VL00000002', well: 'A5', result: '< 40' },
  { specimenId: 'VL00000003', well: 'A6', result: '86321', cycleNumber: '21.77' },
  { specimenId: 'VL00000004', well: 'A7', error: '4442 : Internal control cycle number is too high. Valid range is [19.19, 23.19].' },
  { specimenId: '344', well: 'A8', result: 'Not detected' }
];
