import { Injectable } from '@angular/core';
import { UtilitiesService } from './utilities.service';
import { randomUUID } from 'crypto';

@Injectable({
  providedIn: 'root'
})
export class HL7HelperService {
  public hl7parser = require('hl7parser');

  constructor(private utilitiesService: UtilitiesService) { }

  /**
   * Generates an HL7 ACK (acknowledgment) message
   * @param messageID Message ID to acknowledge
   * @param characterSet Character set to use in response
   * @param messageProfileIdentifier Message profile identifier
   * @param hl7Version HL7 version to use (default: 2.5.1)
   * @returns Formatted HL7 ACK message
   */
  generateHL7ACK(messageID: string | number, characterSet: string, messageProfileIdentifier: string, hl7Version = '2.5.1'): string {
    if (!messageID || messageID === '') {
      messageID = Math.random().toString();
    }

    if (!characterSet || characterSet === '') {
      characterSet = 'UNICODE UTF-8';
    }

    if (!messageProfileIdentifier || messageProfileIdentifier === '') {
      messageProfileIdentifier = '';
    }

    const moment = require('moment');
    const date = moment(new Date()).format('YYYYMMDDHHmmss');

    const mshFields = [
      'MSH',                     // MSH-1 (not transmitted, added by framing)
      '^~\\&',                   // MSH-2 Encoding Characters
      'VLSM',                    // MSH-3 Sending Application
      'VLSM',                    // MSH-4 Sending Facility
      'VLSM',                    // MSH-5 Receiving Application
      'VLSM',                    // MSH-6 Receiving Facility
      date,                      // MSH-7 Date/Time
      '',                        // MSH-8 Security
      'ACK^R22^ACK',             // MSH-9 Message Type
      randomUUID(),              // MSH-10 Message Control ID
      'P',                       // MSH-11 Processing ID
      hl7Version,                // MSH-12 Version ID
      '',                        // MSH-13 Sequence Number
      '',                        // MSH-14 Continuation Pointer
      'NE',                      // MSH-15 Accept Acknowledgment Type
      'AL',                      // MSH-16 Application Acknowledgment Type
      '',                        // MSH-17 Country Code
      characterSet,              // MSH-18 Character Set
      '',                        // MSH-19 Principal Language of Message
      '',                        // MSH-20 Alternate Character Set Handling Scheme
      messageProfileIdentifier   // MSH-21 Message Profile Identifier
    ];

    let ack = String.fromCharCode(11) // <VT>
      + mshFields.join('|') + String.fromCharCode(13) // <CR>
      + 'MSA|AA|' + messageID + String.fromCharCode(13)
      + String.fromCharCode(28) + String.fromCharCode(13); // <FS><CR>

    this.utilitiesService.logger('info', 'Sending HL7 ACK : ' + ack);
    return ack;
  }

  /**
   * Finds the most appropriate OBX segment for processing HL7 test results
   * @param obxArray Array of OBX segments
   * @param sampleNumber Sample number to match
   * @returns The most appropriate OBX segment or null if none found
   */
  findAppropriateHL7OBXSegment(obxArray: any[], sampleNumber: number): any {
    // First try to find an OBX segment that matches this sample number in OBX.4
    for (const currentObx of obxArray) {
      // Check if OBX.4 exists and matches sample number
      const obx4Value = currentObx.get('OBX.4')?.toString() ?? '';
      if (obx4Value && (obx4Value === sampleNumber.toString() || obx4Value === `${sampleNumber}/2`)) {
        return currentObx;
      }
    }

    // If we didn't find a matching OBX, use the index calculation as a fallback
    let index = (sampleNumber * 2) - 1;
    if (index >= obxArray.length) {
      index = Math.min(obxArray.length - 1, 0); // Ensure we have a valid index or use the first segment
    }

    return index >= 0 && index < obxArray.length ? obxArray[index] : null;
  }

  /**
   * Extracts the technician/tested by information from HL7 segments
   * @param primaryObx Primary OBX segment to check first
   * @param allObx All available OBX segments to check as fallback
   * @param message Full HL7 message to check OBR segment as final fallback
   * @returns Technician/tested by name or empty string if not found
   */
  extractHL7TesterInfo(primaryObx: any, allObx: any[], message: any): string {
    // First try the primary OBX segment
    let testerName = primaryObx.get('OBX.16')?.toString() ?? '';

    // If not found, look through all OBX segments
    if (!testerName && allObx.length > 0) {
      for (const obx of allObx) {
        const name = obx.get('OBX.16')?.toString() ?? '';
        if (name) {
          testerName = name;
          break;
        }
      }
    }

    // Last resort: check OBR segment
    if (!testerName) {
      testerName = message.get('OBR.34')?.toString() ?? ''; // OBR.34 sometimes contains technician ID
    }

    return testerName;
  }

  /**
   * Processes HL7 result data and formats it according to result type
   * @param singleObx OBX segment containing result data
   * @param resultStatusType Status of the result
   * @returns Object containing result value and unit
   */
  processHL7ResultValue(singleObx: any, resultStatusType: string): { results: string, test_unit: string } {
    const resultOutcome = singleObx.get('OBX.5.1')?.toString() ?? '';

    if (resultStatusType === 'ERROR') {
      return { results: 'Failed', test_unit: '' };
    } else if (resultStatusType === 'INCOMPLETE') {
      return { results: 'Incomplete', test_unit: '' };
    }

    // Process based on result value
    if (resultOutcome === 'Titer') {
      return {
        results: singleObx.get('OBX.5.1')?.toString() ?? '',
        test_unit: singleObx.get('OBX.6.1')?.toString() ?? ''
      };
    } else if (resultOutcome === '<20' || resultOutcome === '< 20' || resultOutcome === 'Target Not Detected') {
      return { results: 'Target Not Detected', test_unit: '' };
    } else if (resultOutcome === '> Titer max') {
      return { results: '> 10000000', test_unit: '' };
    } else if (
      resultOutcome === 'Target Not Detected' ||
      resultOutcome === 'Failed' ||
      resultOutcome === 'Invalid' ||
      resultOutcome === 'Not Detected') {
      return { results: resultOutcome, test_unit: '' };
    } else {
      return {
        results: resultOutcome,
        test_unit: singleObx.get('OBX.6.1')?.toString() ?? singleObx.get('OBX.6.2')?.toString() ?? singleObx.get('OBX.6')?.toString() ?? ''
      };
    }
  }

  /**
   * Extracts order and test IDs from HL7 message
   * @param spm SPM segment
   * @param message Full HL7 message
   * @param fieldPosition Field position in SPM segment (2 or 3 depending on instrument)
   * @returns Object with order_id and test_id
   */
  extractHL7OrderAndTestIDs(spm: any, message: any, fieldPosition: number = 2): { order_id: string, test_id: string } {
    const idValue = spm.get(`SPM.${fieldPosition}`)?.toString().replace('&ROCHE', '') ?? '';

    if (idValue) {
      return { order_id: idValue, test_id: idValue };
    } else {
      // Fallback to SAC.3
      const sacValue = message.get('SAC.3')?.toString() ?? '';
      return { order_id: sacValue, test_id: sacValue };
    }
  }

  /**
   * Extracts the test type from the HL7 message
   * @param message HL7 message
   * @returns Test type string
   */
  extractHL7TestType(message: any): string {
    return message.get('OBR.4.2')?.toString() ?? message.get('OBX.3.2')?.toString() ?? 'HIVVL';
  }

  /**
   * Extracts and formats datetime fields from HL7 message
   * @param obxSegment OBX segment containing datetime
   * @param utils Utilities service for date formatting
   * @returns Object with formatted datetime fields
   */
  extractHL7DateTimeFields(obxSegment: any, utils: any): {
    analysed_date_time: string,
    authorised_date_time: string,
    result_accepted_date_time: string
  } {
    const dateTimeValue = obxSegment.get('OBX.19')?.toString() ?? '';
    const formattedDateTime = utils.formatRawDate(dateTimeValue);

    return {
      analysed_date_time: formattedDateTime,
      authorised_date_time: formattedDateTime,
      result_accepted_date_time: formattedDateTime
    };
  }

  /**
   * Determines the result status type from an OBX segment
   * @param singleObx OBX segment to analyze
   * @returns Status type as string (ERROR, INCOMPLETE, or FINAL)
   */
  getHL7ResultStatusType(singleObx: any): string {
    const resultStatus = singleObx.get('OBX.11')?.toString().toUpperCase() ?? '';
    const resultValue = singleObx.get('OBX.5.1')?.toString().toLowerCase() ?? '';
    const badValues = ['failed', 'invalid'];
    if (resultStatus === 'X' || badValues.includes(resultValue)) {
      return 'ERROR';
    }
    if (['I', 'R'].includes(resultStatus)) {
      return 'INCOMPLETE';
    }
    return 'FINAL';
  }

  /**
   * Generates an HL7 message for an order to be sent to an instrument
   * @param sampleResult Order/sample data
   * @returns Formatted HL7 message string
   */
  generateHL7MessageForOrder(sampleResult: any): string {
    const moment = require('moment');
    const date = moment(new Date()).format('YYYYMMDDHHmmss');

    let message = 'MSH|^~\\&|LIS|LISFacility|Roche|x800|' + date + '||ORM^O01|' + randomUUID() + '|P|2.3\r';
    message += 'PID|||123456^^^LIS||Doe^John\r';
    message += 'ORC|NW|' + sampleResult.order_id + '|||' + date + '\r';
    message += 'OBR|1||' + sampleResult.order_id + '^LIS|' + sampleResult.test_id + '^' + sampleResult.test_type + '^L\r';

    return message;
  }

  /**
   * Frames an HL7 message with control characters
   * @param message The HL7 message to frame
   * @returns Framed HL7 message ready for transmission
   */
  frameHL7Message(message: string): string {
    return '\x0B' + message + '\x1C' + '\x0D'; // \x0B is the start block, \x1C is the end block, and \x0D is carriage return
  }

  /**
   * Creates a new HL7 message from raw text
   * @param rawHl7Text Raw HL7 text to parse
   * @returns Parsed HL7 message object
   */
  createHL7Message(rawHl7Text: string): any {
    return this.hl7parser.create(rawHl7Text.trim());
  }

  /**
   * Extracts message ID and other key parameters from an HL7 message
   * @param message HL7 message object
   * @returns Object containing extracted parameters
   */
  extractHL7MessageParams(message: any): { msgID: string, characterSet: string, messageProfileIdentifier: string, hl7Version: string } {
    return {
      msgID: message.get('MSH.10')?.toString() ?? '',
      characterSet: message.get('MSH.18')?.toString() ?? 'UNICODE UTF-8',
      messageProfileIdentifier: message.get('MSH.21')?.toString() ?? '',
      hl7Version: message.get('MSH.12')?.toString() ?? '2.5.1'
    };
  }

  /**
   * Validates if an HL7 message contains required segments
   * @param message HL7 message to validate
   * @returns Boolean indicating if message is valid
   */
  isValidHL7Message(message: any): boolean {
    return message !== '' &&
      message !== null &&
      message.get('SPM') !== null &&
      message.get('OBX') !== null;
  }

  /**
   * Processes HL7 raw text by cleaning control characters
   * @param rawText Raw HL7 text to process
   * @returns Cleaned HL7 text
   */
  cleanHL7RawText(rawText: string): string {
    // Remove specific control characters
    let cleaned = rawText.replace(/[\x0b\x1c]/g, '');
    // Trim white space
    cleaned = cleaned.trim();
    // Normalize all line breaks to CR
    cleaned = cleaned.replace(/[\r\n\x0B\x0C\u0085\u2028\u2029]+/gm, '\r');

    return cleaned;
  }
}
