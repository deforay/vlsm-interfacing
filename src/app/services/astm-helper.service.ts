// ASTM Helper Service

import { Injectable } from '@angular/core';
import { UtilitiesService } from './utilities.service';

export interface ASTMProcessingResult {
  completed: boolean;
  rawData?: string;
  sampleResults?: any[];
}

@Injectable({
  providedIn: 'root'
})
export class ASTMHelperService {
  // Control characters
  protected NAK = '\x15'; // Negative Acknowledge
  protected STX = '\x02'; // Start of Text
  protected ETX = '\x03'; // End of Text
  protected EOT = '\x04'; // End of Transmission
  protected ENQ = '\x05'; // Enquiry
  protected ACK = '\x06'; // Acknowledge
  protected LF = '\x0A'; // Line Feed
  protected CR = '\x0D'; // Carriage Return

  protected START = '##START##';
  // Buffer for ACK character
  // This is used to send an ACK response to the instrument after processing a message
  // It is defined as a Buffer to ensure it is sent in the correct binary format
  private readonly ACK_BUFFER = Buffer.from('\x06', 'binary');

  // Track sequence numbers for different instruments
  private astmSequenceNumbers: Map<string, number> = new Map();
  // Buffer ASTM payloads per instrument until we receive EOT
  private astmBuffers: Map<string, string> = new Map();

  constructor(private utilitiesService: UtilitiesService) { }

  /**
 * Gets the START marker for ASTM message processing
 * @returns START marker string
 */
  getStartMarker(): string {
    return this.START;
  }

  /**
 * Sends ACK immediately with minimal overhead for ASTM protocol
 * @param instrumentConnectionData The instrument connection to send ACK to
 * @param logMessage Optional message to log (defaults to generic ACK message)
 */
  sendACK(instrumentConnectionData: any, logMessage?: string): void {
    try {
      if (instrumentConnectionData &&
        instrumentConnectionData.connectionSocket &&
        instrumentConnectionData.connectionSocket.writable) {

        const startTime = Date.now();
        this.utilitiesService.logger('info', logMessage || 'Sending ASTM ACK', instrumentConnectionData.instrumentId);
        // Send pre-created ACK buffer immediately
        instrumentConnectionData.connectionSocket.write(this.ACK_BUFFER, 'binary', () => {
          const endTime = Date.now();
          const duration = endTime - startTime;
          this.utilitiesService.logger('info', `ACK sent in ${duration}ms`, instrumentConnectionData.instrumentId);
        });
      }
    } catch (error) {
      this.utilitiesService.logger('error', 'Failed to send ASTM ACK: ' + error, instrumentConnectionData.instrumentId);
    }
  }

  /**
   * Gets ASTM data blocks from an array of ASTM segments
   * @param astmArray Array of ASTM segments
   * @returns Object containing ASTM data blocks organized by segment type
   */
  getASTMDataBlock(astmArray: any[]): any {
    let dataArray = {};

    for (const element of astmArray) {
      if (element !== '' && element !== null && element !== undefined) {
        // Remove leading digits and split the segment into its constituent fields
        const segmentFields = element.replace(/^\d*/, '').split('|');

        // Use the first character (segment type) as the key
        const segmentType = segmentFields[0].charAt(0);

        // Check if this type of segment has already been encountered
        if (!dataArray[segmentType]) {
          dataArray[segmentType] = [segmentFields]; // Initialize with the current segment's fields
        } else {
          dataArray[segmentType].push(segmentFields); // Append this segment's fields to the array of segments of the same type
        }
      }
    }

    return dataArray;
  }

  /**
   * Generates an ASTM message for an order
   * @param sampleResult Order data to include in the message
   * @returns Formatted ASTM message string
   */
  generateASTMMessageForOrder(sampleResult: any): string {
    // Assuming order fields map directly to ASTM message fields
    // This will vary based on your specific ASTM message format requirements
    let message = `H|\\^&|||${sampleResult.test_location}|||||||P|1\r`;
    message += `P|1||||${sampleResult.order_id}|||||||||||||||||||||||\r`;
    message += `O|1|${sampleResult.test_id}|${sampleResult.test_id}||${sampleResult.test_type}||||||||||||||O\r`;
    message += `L|1|N\r`;

    return message;
  }

  /**
   * Frames an ASTM message with control characters and checksum
   * @param message The ASTM message to frame
   * @param instrumentId The instrument ID for tracking sequence numbers
   * @returns Framed ASTM message ready for transmission
   */
  frameASTMMessage(message: string, instrumentId: string): string {
    const sequenceNumber = this.getAndUpdateSequenceNumber(instrumentId);
    const header = this.STX + sequenceNumber;
    const footer = this.ETX;
    const checksum = this.calculateChecksum(header + message + footer);
    return header + message + footer + checksum + this.CR + this.LF + this.EOT;
  }

  /**
   * Calculates the checksum of an ASTM message
   * @param message Message to calculate checksum for
   * @returns Checksum as a hexadecimal string
   */
  calculateChecksum(message: string): string {
    let checksum = 0;

    // Remove STX if present
    const startIndex = message.startsWith('\x02') ? 1 : 0;
    // Ensure ETX is present, and trim anything after ETX
    const endIndex = message.indexOf('\x03') !== -1 ? message.indexOf('\x03') + 1 : message.length;
    // Adjust message to only include content from start index to ETX (inclusive)
    const adjustedMessage = message.substring(startIndex, endIndex);

    // Calculate checksum
    for (let i = 0; i < adjustedMessage.length; i++) {
      checksum += adjustedMessage.charCodeAt(i);
    }
    checksum &= 0xFF; // Keep only the last 8 bits

    // Convert to 2-digit hexadecimal string, uppercased
    const hexChecksum = checksum.toString(16).toUpperCase().padStart(2, '0');

    return hexChecksum;
  }

  /**
   * Gets and updates the sequence number for an instrument
   * @param instrumentId Instrument ID to track sequence for
   * @returns Current sequence number as a string
   */
  getAndUpdateSequenceNumber(instrumentId: string): string {
    // Ensure the instrumentId is tracked
    if (!this.astmSequenceNumbers.has(instrumentId)) {
      this.astmSequenceNumbers.set(instrumentId, 1);
    } else {
      let currentSequence = this.astmSequenceNumbers.get(instrumentId)!;
      //currentSequence = (currentSequence % 7) + 1; // Cycle from 1 to 7
      this.astmSequenceNumbers.set(instrumentId, currentSequence + 1);
    }
    return this.astmSequenceNumbers.get(instrumentId)!.toString(); // No padding needed
  }

  /**
   * Resets the sequence number for an instrument
   * @param instrumentId Instrument ID to reset sequence for
   */
  resetSequenceNumber(instrumentId: string): void {
    console.error("Resetting sequence number for " + instrumentId);
    this.astmSequenceNumbers.set(instrumentId, 100);
  }

  /**
   * Appends an ASTM data chunk to the instrument buffer and, when EOT is received,
   * returns the accumulated payload together with parsed sample results.
   */
  appendASTMChunk(
    instrumentConnectionData: any,
    astmText: string,
    protocolType: string,
    processedInfo: { text: string; isHeader: boolean; isEOT: boolean; isNAK: boolean }
  ): ASTMProcessingResult {
    const instrumentId = instrumentConnectionData?.instrumentId;
    if (!instrumentId) {
      return { completed: false };
    }

    // Initialize buffer if needed
    if (!this.astmBuffers.has(instrumentId)) {
      this.astmBuffers.set(instrumentId, '');
    }

    // When EOT is received, process the accumulated payload and reset the buffer
    if (processedInfo.isEOT) {
      const accumulatedPayload = this.astmBuffers.get(instrumentId) ?? '';
      this.astmBuffers.delete(instrumentId);

      if (!accumulatedPayload) {
        this.utilitiesService.logger('warn', 'EOT received without accumulated ASTM payload', instrumentId);
        return { completed: true, rawData: '' };
      }

      this.utilitiesService.logger('info', 'Processing completed ASTM transmission', instrumentId);

      const withChecksum = protocolType !== 'astm-nonchecksum';
      let astmData = this.utilitiesService.removeControlCharacters(accumulatedPayload, withChecksum);
      const fullDataArray = astmData.split(this.START);

      const sampleResults: any[] = [];

      for (const partData of fullDataArray) {
        if (!partData) {
          continue;
        }

        const astmArray = partData.split(/<CR>/);

        if (!Array.isArray(astmArray) || astmArray.length === 0) {
          continue;
        }

        const dataArray = this.getASTMDataBlock(astmArray);

        if (Object.keys(dataArray).length === 0) {
          this.utilitiesService.logger('info', 'No ASTM data extracted from chunk', instrumentId);
          continue;
        }

        const sampleResult = this.extractSampleResultFromASTM(dataArray, partData);
        if (sampleResult) {
          sampleResults.push(sampleResult);
        } else {
          this.utilitiesService.logger('warn', 'Failed to extract sample result from ASTM chunk', instrumentId);
        }
      }

      return {
        completed: true,
        rawData: accumulatedPayload,
        sampleResults
      };
    }

    // For normal payload frames, append the data (header frames are pre-processed)
    const payloadToAppend = processedInfo.isHeader ? processedInfo.text : astmText;
    const updatedPayload = (this.astmBuffers.get(instrumentId) ?? '') + payloadToAppend;
    this.astmBuffers.set(instrumentId, updatedPayload);

    return { completed: false };
  }

  /**
   * Processes a received ASTM message
   * @param astmText The ASTM text to process
   * @param withChecksum Whether the message includes a checksum
   * @returns Object containing processed ASTM data
   */
  processASTMText(astmText: string, withChecksum: boolean = true): any {
    // Step 1: Control character removal
    const cleanedForHeaderCheck = astmText.replace(/[\x00-\x1F\x7F]/g, '');

    // Step 2: use regex pattern to check if the text starts with a header
    const regexToCheckIfHeader = /^\d*H\|/; // Added the | after H

    const isHeader = regexToCheckIfHeader.test(cleanedForHeaderCheck);

    if (isHeader) {
      astmText = this.START + astmText;
    }

    return {
      text: astmText,
      isHeader: isHeader,
      isEOT: astmText === this.EOT,
      isNAK: astmText === this.NAK
    };
  }

  /**
   * Extracts sample result information from ASTM data blocks
   * @param dataArray ASTM data blocks
   * @param partData Raw ASTM part data
   * @returns Sample result object or null if extraction fails
   */
  extractSampleResultFromASTM(dataArray: any, partData: string): any | null {
    const sampleResult: any = {};

    try {
      if (dataArray['O'] && dataArray['O'].length > 0) {
        const oSegmentFields = dataArray['O'][0]; // dataArray['O'] is an array of arrays (each sub-array is a segment's fields)

        sampleResult.order_id = oSegmentFields[2];
        sampleResult.test_id = oSegmentFields[1];

        const resultStatus = oSegmentFields[25]; // X = Failed, F = Final, P = Preliminary

        const universalTestIdentifier = oSegmentFields[4];
        const testTypeDetails = universalTestIdentifier.split('^');
        const testType = testTypeDetails.length > 1 ? testTypeDetails[3] : ''; // Adjust based on your ASTM format

        sampleResult.test_type = testType;

        if (dataArray['R'] && dataArray['R'].length > 0) {
          const rSegmentFields = dataArray['R'][0];

          if (!sampleResult.test_type) {
            sampleResult.test_type = (rSegmentFields[2]) ? rSegmentFields[2].replace('^^^', '') : rSegmentFields[2];
          }

          let testUnit = rSegmentFields[4];
          if (testUnit) {
            testUnit = this.utilitiesService.decodeHtmlEntities(testUnit);
          }
          sampleResult.test_unit = testUnit;

          let resultSegment = rSegmentFields[3];

          let finalResult = null;
          if (resultSegment) {
            let resultSegmentComponents = resultSegment.split("^");
            // Check if the primary result is non-empty and use it; otherwise, check the additional result
            if (resultSegmentComponents[0].trim()) {
              finalResult = resultSegmentComponents[0].trim();
            } else if (resultSegmentComponents.length > 1 && resultSegmentComponents[1].trim()) {
              finalResult = resultSegmentComponents[1].trim();
            }
          }

          if (finalResult) {
            finalResult = this.utilitiesService.decodeHtmlEntities(finalResult);
          }

          sampleResult.results = finalResult;
          sampleResult.tested_by = rSegmentFields[10];
          sampleResult.analysed_date_time = this.utilitiesService.formatRawDate(rSegmentFields[12]);
          sampleResult.authorised_date_time = this.utilitiesService.formatRawDate(rSegmentFields[12]);
          sampleResult.result_accepted_date_time = this.utilitiesService.formatRawDate(rSegmentFields[12]);
        } else {
          sampleResult.test_type = testType;
          sampleResult.test_unit = null;
          sampleResult.results = 'Failed';
          sampleResult.tested_by = null;
          sampleResult.analysed_date_time = null;
          sampleResult.authorised_date_time = null;
          sampleResult.result_accepted_date_time = null;
        }

        sampleResult.raw_text = partData;
        sampleResult.result_status = resultStatus === 'F' ? 1 : 0;
        sampleResult.lims_sync_status = 0;

        return sampleResult;
      }

      return null;
    } catch (error) {
      console.error("Error extracting sample result from ASTM:", error);
      return null;
    }
  }

  /**
   * Determines if a received ASTM message is a control character
   * @param astmText ASTM text to check
   * @returns Object indicating which control character (if any) the text is
   */
  isControlCharacter(astmText: string): {
    isControl: boolean,
    type: 'ACK' | 'NAK' | 'EOT' | 'STX' | 'ETX' | 'ENQ' | 'none'
  } {
    if (astmText === this.ACK) {
      return { isControl: true, type: 'ACK' };
    } else if (astmText === this.NAK) {
      return { isControl: true, type: 'NAK' };
    } else if (astmText === this.EOT) {
      return { isControl: true, type: 'EOT' };
    } else if (astmText === this.STX) {
      return { isControl: true, type: 'STX' };
    } else if (astmText === this.ETX) {
      return { isControl: true, type: 'ETX' };
    } else if (astmText === this.ENQ) {
      return { isControl: true, type: 'ENQ' };
    }

    return { isControl: false, type: 'none' };
  }
}
