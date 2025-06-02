import { Injectable } from '@angular/core';
import { UtilitiesService } from './utilities.service';

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

  // Track sequence numbers for different instruments
  private astmSequenceNumbers: Map<string, number> = new Map();

  constructor(private utilitiesService: UtilitiesService) { }

  /**
 * Gets the START marker for ASTM message processing
 * @returns START marker string
 */
  getStartMarker(): string {
    return this.START;
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
          sampleResult.test_unit = rSegmentFields[4];

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
   * Gets an acknowledgment (ACK) for an ASTM message
   * @returns ACK character
   */
  getACK(): string {
    return this.ACK;
  }

  /**
   * Gets the End of Transmission (EOT) character
   * @returns EOT character
   */
  getEOT(): string {
    return this.EOT;
  }

  /**
   * Gets the Negative Acknowledgment (NAK) character
   * @returns NAK character
   */
  getNAK(): string {
    return this.NAK;
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
