import { Injectable } from '@angular/core';
import { DatabaseService } from './database.service';
import { InstrumentConnectionStack } from '../interfaces/intrument-connections.interface';
import { RawMachineData } from '../interfaces/raw-machine-data.interface';
import { UtilitiesService } from './utilities.service';
import { TcpConnectionService } from './tcp-connection.service';
import { HL7HelperService } from './hl7-helper.service';
import { ASTMHelperService } from './astm-helper.service';
import { BehaviorSubject, Observable } from 'rxjs';


@Injectable({
  providedIn: 'root'
})

export class InstrumentInterfaceService {

  protected strData = '';
  private connectedInstruments = new Map<string, BehaviorSubject<boolean>>();

  constructor(public dbService: DatabaseService,
    public tcpService: TcpConnectionService,
    public utilitiesService: UtilitiesService,
    private hl7Helper: HL7HelperService,
    private astmHelper: ASTMHelperService
  ) {
  }


  // Method used to connect to the Testing Machine
  connect(instrument: any) {
    const that = this;
    if (instrument && instrument.connectionParams) {
      // Bind 'this' explicitly to handleTCPResponse
      const boundHandleTCPResponse = that.handleTCPResponse.bind(that);
      that.tcpService.connect(instrument.connectionParams, boundHandleTCPResponse);

      // Update instrument status based on TCP connection status
      that.tcpService.getStatusObservable(instrument.connectionParams)
        .subscribe(status => {
          that.updateInstrumentStatus(instrument.connectionParams.instrumentId, status);
        });
    }
  }

  reconnect(instrument: any) {
    const that = this;
    if (instrument && instrument.connectionParams) {
      // Bind 'this' explicitly to handleTCPResponse
      const boundHandleTCPResponse = that.handleTCPResponse.bind(that);
      that.tcpService.reconnect(instrument.connectionParams, boundHandleTCPResponse);

      // Update instrument status based on TCP connection status
      that.tcpService.getStatusObservable(instrument.connectionParams)
        .subscribe(status => {
          that.updateInstrumentStatus(instrument.connectionParams.instrumentId, status);
        });
    }
  }

  disconnect(instrument: any) {
    const that = this;
    if (instrument && instrument.connectionParams && instrument.connectionParams.host && instrument.connectionParams.port) {
      that.tcpService.disconnect(instrument.connectionParams);
      that.updateInstrumentStatus(instrument.connectionParams.instrumentId, false);
    }
  }

  // Method used to get connection status for an instrument
  getInstrumentStatus(instrumentId: string): Observable<boolean> {
    if (!this.connectedInstruments.has(instrumentId)) {
      this.connectedInstruments.set(instrumentId, new BehaviorSubject<boolean>(false));
    }
    return this.connectedInstruments.get(instrumentId).asObservable();
  }

  // Method used to update connection status for an instrument
  private updateInstrumentStatus(instrumentId: string, isConnected: boolean): void {
    if (!this.connectedInstruments.has(instrumentId)) {
      this.connectedInstruments.set(instrumentId, new BehaviorSubject<boolean>(false));
    }
    this.connectedInstruments.get(instrumentId).next(isConnected);
  }

  // HL7 processing methods
  // **UPDATED HL7 PROCESSING METHODS** - Remove ACK generation since it's already sent
  processHL7DataAlinity(instrumentConnectionData: InstrumentConnectionStack, rawHl7Text: string) {
    const that = this;

    // Parse the message for processing (ACK already sent)
    const message = that.hl7Helper.createHL7Message(rawHl7Text.trim());

    // Skip ACK generation - already sent immediately
    // that.tcpService.socketClient.write(that.hl7Helper.generateHL7ACK(...)); // REMOVED

    const hl7DataArray = rawHl7Text.split('MSH|');
    let processedCount = 0;
    let errorCount = 0;

    hl7DataArray.forEach(function (rawText: string, index: number) {
      if (rawText.trim() === '') { return; }

      try {
        rawText = 'MSH|' + rawText.trim();
        const message = that.hl7Helper.createHL7Message(rawText);

        if (message === '' || message === null || message.get('SPM') === null || message.get('OBX') === null) {
          return;
        }

        const obx = message.get('OBX').toArray();
        const spm = message.get('SPM');

        spm.forEach(function (singleSpm) {
          try {
            // For Alinity, we typically use the first OBX for each SPM
            let singleObx = obx[0];

            // Safety check
            if (!singleObx) {
              that.utilitiesService.logger('error', 'No valid OBX segment found for sample in Alinity data', instrumentConnectionData.instrumentId);
              return;
            }

            // Extract order and test IDs (Alinity uses SPM.3)
            const ids = that.hl7Helper.extractHL7OrderAndTestIDs(singleSpm, message, 3);

            const sampleResult: any = {
              raw_text: rawText,
              order_id: ids.order_id,
              test_id: ids.test_id,
              test_type: that.hl7Helper.extractHL7TestType(message)
            };

            // Process result value
            const resultData = that.hl7Helper.processHL7ResultValue(singleObx, that.hl7Helper.getHL7ResultStatusType(singleObx));
            sampleResult.results = resultData.results;
            sampleResult.test_unit = resultData.test_unit;

            // Extract tester info
            sampleResult.tested_by = that.hl7Helper.extractHL7TesterInfo(singleObx, obx, message);

            // Standard fields
            sampleResult.result_status = 1;
            sampleResult.lims_sync_status = 0;

            // Extract datetime fields
            const dateTimeFields = that.hl7Helper.extractHL7DateTimeFields(singleObx, that.utilitiesService);
            sampleResult.analysed_date_time = dateTimeFields.analysed_date_time;
            sampleResult.authorised_date_time = dateTimeFields.authorised_date_time;
            sampleResult.result_accepted_date_time = dateTimeFields.result_accepted_date_time;

            // Location information
            sampleResult.test_location = instrumentConnectionData.labName;
            sampleResult.machine_used = instrumentConnectionData.instrumentId;

            // Save result asynchronously
            setImmediate(() => {
              that.saveResult(sampleResult, instrumentConnectionData);
            });

            processedCount++;

          } catch (spmError) {
            errorCount++;
            that.utilitiesService.logger('error', `Error processing SPM segment: ${spmError}`, instrumentConnectionData.instrumentId);
          }
        });

      } catch (messageError) {
        errorCount++;
        that.utilitiesService.logger('error', `Error processing HL7 message ${index + 1}: ${messageError}`, instrumentConnectionData.instrumentId);
      }
    });

    that.utilitiesService.logger('info', `Alinity HL7 processing summary: ${processedCount} results processed, ${errorCount} errors`, instrumentConnectionData.instrumentId);
  }

  processHL7Data(instrumentConnectionData: InstrumentConnectionStack, rawHl7Text: string) {
    const that = this;

    // Parse the message for processing (ACK already sent)
    const message = that.hl7Helper.createHL7Message(rawHl7Text.trim());

    // Skip ACK generation - already sent immediately
    // that.tcpService.socketClient.write(that.hl7Helper.generateHL7ACK(...)); // REMOVED

    const hl7DataArray = rawHl7Text.split('MSH|');
    let processedCount = 0;
    let errorCount = 0;

    hl7DataArray.forEach(function (rawText: string, index: number) {
      if (rawText.trim() === '') { return; }

      try {
        rawText = 'MSH|' + rawText.trim();
        const message = that.hl7Helper.createHL7Message(rawText);

        if (message === '' || message === null || message.get('SPM') === null || message.get('OBX') === null) {
          return;
        }

        const obx = message.get('OBX').toArray();
        const spm = message.get('SPM');

        spm.forEach(function (singleSpm) {
          try {
            // Get sample number and find appropriate OBX segment
            let sampleNumber = singleSpm.get(1).toInteger();
            if (Number.isNaN(sampleNumber)) {
              sampleNumber = 1;
            }

            let singleObx = that.hl7Helper.findAppropriateHL7OBXSegment(obx, sampleNumber);

            // Safety check
            if (!singleObx) {
              that.utilitiesService.logger('error', 'No valid OBX segment found for sample ' + sampleNumber, instrumentConnectionData.instrumentId);
              return;
            }

            // Extract order and test IDs
            const ids = that.hl7Helper.extractHL7OrderAndTestIDs(singleSpm, message);

            const sampleResult: any = {
              raw_text: rawText,
              order_id: ids.order_id,
              test_id: ids.test_id,
              test_type: that.hl7Helper.extractHL7TestType(message)
            };

            // Process result
            const resultStatusType = that.hl7Helper.getHL7ResultStatusType(singleObx);
            const resultData = that.hl7Helper.processHL7ResultValue(singleObx, resultStatusType);
            sampleResult.results = resultData.results;
            sampleResult.test_unit = resultData.test_unit;

            // Extract tester info
            sampleResult.tested_by = that.hl7Helper.extractHL7TesterInfo(singleObx, obx, message);

            // Standard fields
            sampleResult.result_status = 1;
            sampleResult.lims_sync_status = 0;

            // Extract datetime fields
            const dateTimeFields = that.hl7Helper.extractHL7DateTimeFields(singleObx, that.utilitiesService);
            sampleResult.analysed_date_time = dateTimeFields.analysed_date_time;
            sampleResult.authorised_date_time = dateTimeFields.authorised_date_time;
            sampleResult.result_accepted_date_time = dateTimeFields.result_accepted_date_time;

            // Location information
            sampleResult.test_location = instrumentConnectionData.labName;
            sampleResult.machine_used = instrumentConnectionData.instrumentId;

            // Save result asynchronously
            setImmediate(() => {
              that.saveResult(sampleResult, instrumentConnectionData);
            });

            processedCount++;

          } catch (spmError) {
            errorCount++;
            that.utilitiesService.logger('error', `Error processing SPM segment: ${spmError}`, instrumentConnectionData.instrumentId);
          }
        });

      } catch (messageError) {
        errorCount++;
        that.utilitiesService.logger('error', `Error processing HL7 message ${index + 1}: ${messageError}`, instrumentConnectionData.instrumentId);
      }
    });

    that.utilitiesService.logger('info', `Generic HL7 processing summary: ${processedCount} results processed, ${errorCount} errors`, instrumentConnectionData.instrumentId);
  }

  // **OPTIMIZED HL7 ROCHE 5800 PROCESSING** - No duplicate ACK, async saves
  processHL7DataRoche5800(instrumentConnectionData: InstrumentConnectionStack, rawHl7Text: string) {
    const that = this;

    // Parse the message for processing (ACK already sent)
    const message = that.hl7Helper.createHL7Message(rawHl7Text.trim());

    // Skip ACK generation - already sent immediately in receiveHL7
    // that.tcpService.socketClient.write(that.hl7Helper.generateHL7ACK(...)); // REMOVED

    const hl7DataArray = rawHl7Text.split('MSH|');
    let processedCount = 0;
    let errorCount = 0;

    that.utilitiesService.logger('info', `Processing ${hl7DataArray.length} HL7 message segments for Roche 5800`, instrumentConnectionData.instrumentId);

    hl7DataArray.forEach(function (rawText: string, index: number) {
      if (rawText.trim() === '') { return; }

      try {
        rawText = 'MSH|' + rawText.trim();
        const message = that.hl7Helper.createHL7Message(rawText);

        if (message === '' || message === null || message.get('SPM') === null || message.get('OBX') === null) {
          that.utilitiesService.logger('warning', `Skipping HL7 message ${index + 1} - missing required segments`, instrumentConnectionData.instrumentId);
          return;
        }

        const obx = message.get('OBX').toArray();
        const spm = message.get('SPM');

        spm.forEach(function (singleSpm, spmIndex) {
          try {
            // Get sample number and find appropriate OBX segment
            let sampleNumber = singleSpm.get(1).toInteger();
            if (Number.isNaN(sampleNumber)) {
              sampleNumber = 1;
            }

            let singleObx = that.hl7Helper.findAppropriateHL7OBXSegment(obx, sampleNumber);

            // Safety check
            if (!singleObx) {
              that.utilitiesService.logger('error', `No valid OBX segment found for sample ${sampleNumber} in Roche 5800 data`, instrumentConnectionData.instrumentId);
              errorCount++;
              return;
            }

            // Extract order and test IDs
            const ids = that.hl7Helper.extractHL7OrderAndTestIDs(singleSpm, message);

            const sampleResult: any = {
              raw_text: rawText,
              order_id: ids.order_id,
              test_id: ids.test_id,
              test_type: that.hl7Helper.extractHL7TestType(message)
            };

            // Process result
            const resultStatusType = that.hl7Helper.getHL7ResultStatusType(singleObx);
            const resultData = that.hl7Helper.processHL7ResultValue(singleObx, resultStatusType);
            sampleResult.results = resultData.results;
            sampleResult.test_unit = resultData.test_unit;

            // Extract tester info
            sampleResult.tested_by = that.hl7Helper.extractHL7TesterInfo(singleObx, obx, message);

            // Standard fields
            sampleResult.result_status = 1;
            sampleResult.lims_sync_status = 0;

            // Extract datetime fields
            const dateTimeFields = that.hl7Helper.extractHL7DateTimeFields(singleObx, that.utilitiesService);
            sampleResult.analysed_date_time = dateTimeFields.analysed_date_time;
            sampleResult.authorised_date_time = dateTimeFields.authorised_date_time;
            sampleResult.result_accepted_date_time = dateTimeFields.result_accepted_date_time;

            // Location information
            sampleResult.test_location = instrumentConnectionData.labName;
            sampleResult.machine_used = instrumentConnectionData.instrumentId;

            // **ASYNC DATABASE SAVE** - Don't block processing
            setImmediate(() => {
              that.saveResult(sampleResult, instrumentConnectionData);
            });

            processedCount++;

          } catch (spmError) {
            errorCount++;
            that.utilitiesService.logger('error', `Error processing SPM segment ${spmIndex + 1} in message ${index + 1}: ${spmError}`, instrumentConnectionData.instrumentId);
          }
        });

      } catch (messageError) {
        errorCount++;
        that.utilitiesService.logger('error', `Error processing Roche 5800 HL7 message ${index + 1}: ${messageError}`, instrumentConnectionData.instrumentId);
        that.utilitiesService.logger('error', `Problematic message data: ${rawText.substring(0, 100)}...`, instrumentConnectionData.instrumentId);
      }
    });

    that.utilitiesService.logger('info', `Roche 5800 HL7 processing summary: ${processedCount} results processed, ${errorCount} errors`, instrumentConnectionData.instrumentId);
  }

  // **OPTIMIZED HL7 ROCHE 6800/8800 PROCESSING** - No duplicate ACK, async saves
  processHL7DataRoche68008800(instrumentConnectionData: InstrumentConnectionStack, rawHl7Text: string) {
    const that = this;

    // Parse the message for processing (ACK already sent)
    const message = that.hl7Helper.createHL7Message(rawHl7Text.trim());

    // Skip ACK generation - already sent immediately in receiveHL7
    // that.tcpService.socketClient.write(that.hl7Helper.generateHL7ACK(...)); // REMOVED

    const hl7DataArray = rawHl7Text.split('MSH|');
    let processedCount = 0;
    let errorCount = 0;

    that.utilitiesService.logger('info', `Processing ${hl7DataArray.length} HL7 message segments for Roche 6800/8800`, instrumentConnectionData.instrumentId);

    hl7DataArray.forEach(function (rawText: string, index: number) {
      if (rawText.trim() === '') { return; }

      try {
        rawText = 'MSH|' + rawText.trim();
        const message = that.hl7Helper.createHL7Message(rawText);

        if (message === '' || message === null || message.get('SPM') === null || message.get('OBX') === null) {
          that.utilitiesService.logger('warning', `Skipping HL7 message ${index + 1} - missing required segments`, instrumentConnectionData.instrumentId);
          return;
        }

        const obxArray = message.get('OBX').toArray();
        const spm = message.get('SPM');

        spm.forEach(function (singleSpm: any, spmIndex) {
          try {
            // For 6800/8800, look for OBX with OBX.4 = "1/2"
            let resultOutcome = '';
            let singleObx = null;
            let obxSearchMethod = 'unknown';

            // This specific logic for 6800/8800 looks for "1/2" in OBX.4
            obxArray.forEach(function (obx: any, obxIndex) {
              if (obx.get('OBX.4')?.toString() === '1/2') {
                resultOutcome = obx.get('OBX.5.1')?.toString() ?? '';
                singleObx = obx;
                obxSearchMethod = `OBX.4="1/2" (index ${obxIndex})`;

                if (resultOutcome === 'Titer') {
                  singleObx = obxArray[0];
                  resultOutcome = singleObx.get('OBX.5.1')?.toString() ?? '';
                  obxSearchMethod = `Titer fallback to first OBX`;
                }
              }
            });

            // If no OBX segment with "1/2", fall back to first OBX
            if (!singleObx && obxArray.length > 0) {
              singleObx = obxArray[0];
              resultOutcome = singleObx.get('OBX.5.1')?.toString() ?? '';
              obxSearchMethod = `Fallback to first OBX`;
            }

            // Safety check
            if (!singleObx) {
              that.utilitiesService.logger('error', `No valid OBX segment found for Roche 6800/8800 SPM ${spmIndex + 1}`, instrumentConnectionData.instrumentId);
              errorCount++;
              return;
            }

            that.utilitiesService.logger('info', `Using OBX segment via ${obxSearchMethod} for SPM ${spmIndex + 1}`, instrumentConnectionData.instrumentId);

            // Extract order and test IDs
            const ids = that.hl7Helper.extractHL7OrderAndTestIDs(singleSpm, message);

            const sampleResult: any = {
              raw_text: rawText,
              order_id: ids.order_id,
              test_id: ids.test_id,
              test_type: that.hl7Helper.extractHL7TestType(message)
            };

            // Process result
            const resultStatusType = that.hl7Helper.getHL7ResultStatusType(singleObx);
            const resultData = that.hl7Helper.processHL7ResultValue(singleObx, resultStatusType);
            sampleResult.results = resultData.results;
            sampleResult.test_unit = resultData.test_unit;

            // Extract tester info
            sampleResult.tested_by = that.hl7Helper.extractHL7TesterInfo(singleObx, obxArray, message);

            // Standard fields
            sampleResult.result_status = 1;
            sampleResult.lims_sync_status = 0;

            // Extract datetime fields
            const dateTimeFields = that.hl7Helper.extractHL7DateTimeFields(singleObx, that.utilitiesService);
            sampleResult.analysed_date_time = dateTimeFields.analysed_date_time;
            sampleResult.authorised_date_time = dateTimeFields.authorised_date_time;
            sampleResult.result_accepted_date_time = dateTimeFields.result_accepted_date_time;

            // Location information
            sampleResult.test_location = instrumentConnectionData.labName;
            sampleResult.machine_used = instrumentConnectionData.instrumentId;

            // **ASYNC DATABASE SAVE** - Don't block processing
            setImmediate(() => {
              that.saveResult(sampleResult, instrumentConnectionData);
            });

            processedCount++;

          } catch (spmError) {
            errorCount++;
            that.utilitiesService.logger('error', `Error processing SPM segment ${spmIndex + 1} in message ${index + 1}: ${spmError}`, instrumentConnectionData.instrumentId);
          }
        });

      } catch (messageError) {
        errorCount++;
        that.utilitiesService.logger('error', `Error processing Roche 6800/8800 HL7 message ${index + 1}: ${messageError}`, instrumentConnectionData.instrumentId);
        that.utilitiesService.logger('error', `Problematic message data: ${rawText.substring(0, 100)}...`, instrumentConnectionData.instrumentId);
      }
    });

    that.utilitiesService.logger('info', `Roche 6800/8800 HL7 processing summary: ${processedCount} results processed, ${errorCount} errors`, instrumentConnectionData.instrumentId);
  }

  // **ENHANCED SAVE RESULT METHOD** - Better async handling and logging
  private saveResult(sampleResult: any, instrumentConnectionData: InstrumentConnectionStack) {
    const that = this;

    if (!sampleResult) {
      that.utilitiesService.logger('error', 'Cannot save null/undefined sample result', instrumentConnectionData.instrumentId);
      return false;
    }

    // Validate required fields
    if (!sampleResult.order_id || !sampleResult.test_id) {
      that.utilitiesService.logger('error', `Sample result missing required fields - order_id: ${sampleResult.order_id}, test_id: ${sampleResult.test_id}`, instrumentConnectionData.instrumentId);
      return false;
    }

    const data = { ...sampleResult, instrument_id: instrumentConnectionData.instrumentId };

    // Use setImmediate to ensure database operations don't block incoming data
    setImmediate(() => {
      that.dbService.recordTestResults(data,
        (res) => {
          that.utilitiesService.logger('success', `Successfully saved result: ${sampleResult.test_id}|${sampleResult.order_id} (${sampleResult.results})`, instrumentConnectionData.instrumentId);
          return true;
        },
        (err) => {
          that.utilitiesService.logger('error', `Failed to save result: ${sampleResult.test_id}|${sampleResult.order_id} | Error: ${JSON.stringify(err)}`, instrumentConnectionData.instrumentId);
          that.utilitiesService.logger('error', `Failed result data: ${JSON.stringify(sampleResult).substring(0, 200)}...`, instrumentConnectionData.instrumentId);
          return false;
        }
      );
    });
  }


  private receiveASTM(astmProtocolType: string, instrumentConnectionData: InstrumentConnectionStack, data: Buffer) {
    const that = this;
    instrumentConnectionData.transmissionStatusSubject.next(true);

    let astmText = that.utilitiesService.hex2ascii(data.toString('hex'));

    // **IMMEDIATE ACK PROCESSING** - Critical for timing
    // More comprehensive ASTM frame detection
    let shouldSendAck = false;
    let quickFrameType = null;

    // Comprehensive ASTM frame validation - order matters for performance
    if (astmText.includes('\x04')) {
      shouldSendAck = true;
      quickFrameType = 'EOT';
    } else if (astmText.includes('\x15')) {
      shouldSendAck = true;
      quickFrameType = 'NAK';
    } else if (astmText.includes('\x06')) {
      shouldSendAck = false; // Don't ACK an ACK
      quickFrameType = 'ACK';
    } else if (astmText.includes('\x02') || astmText.includes('\x03')) {
      shouldSendAck = true;
      quickFrameType = 'DATA';
    }

    // **SEND ACK IMMEDIATELY** - Before any heavy processing
    if (shouldSendAck) {
      try {
        instrumentConnectionData.connectionSocket.write(that.astmHelper.getACK());
        that.utilitiesService.logger('info', `Sending ACK for ${quickFrameType} frame`, instrumentConnectionData.instrumentId);
      } catch (ackError) {
        that.utilitiesService.logger('error', `Failed to send ACK for ${quickFrameType}: ${ackError}`, instrumentConnectionData.instrumentId);
        // Continue processing even if ACK fails - data integrity is important
      }
    }

    // **ASYNC PROCESSING** - Heavy operations moved to next tick to prevent blocking
    setImmediate(() => {
      try {
        // Now do the detailed processing without time pressure
        const processedText = that.astmHelper.processASTMText(astmText);

        // Use the detailed processing results (not the quick check)
        if (processedText.isEOT) {
          that.utilitiesService.logger('info', 'Received EOT. Processing complete transmission.', instrumentConnectionData.instrumentId);
          that.utilitiesService.logger('info', 'Processing ' + astmProtocolType, instrumentConnectionData.instrumentId);
          that.utilitiesService.logger('info', 'Complete transmission data: ' + that.strData, instrumentConnectionData.instrumentId);

          // Process the complete ASTM data asynchronously
          that.processCompleteASTMData(astmProtocolType, instrumentConnectionData);

        } else if (processedText.isNAK) {
          that.utilitiesService.logger('error', 'NAK Received - clearing partial data', instrumentConnectionData.instrumentId);
          // Clear partial data on NAK to start fresh
          that.strData = '';
          instrumentConnectionData.transmissionStatusSubject.next(false);

        } else if (processedText.isACK) {
          that.utilitiesService.logger('info', 'ACK received from instrument', instrumentConnectionData.instrumentId);
          // Don't accumulate ACK messages in strData

        } else {
          // Accumulate data for normal frames (STX, ETX, data frames)
          if (processedText.isHeader) {
            that.strData += processedText.text;
          } else {
            that.strData += astmText;
          }

          that.utilitiesService.logger('info', `${astmProtocolType.toUpperCase()} | Receiving ${quickFrameType || 'UNKNOWN'}: ${astmText.substring(0, 50)}${astmText.length > 50 ? '...' : ''}`, instrumentConnectionData.instrumentId);
        }

      } catch (processingError) {
        that.utilitiesService.logger('error', `Error processing ASTM data: ${processingError}`, instrumentConnectionData.instrumentId);
        that.utilitiesService.logger('error', `Raw data causing error: ${astmText}`, instrumentConnectionData.instrumentId);
        // Don't clear strData on processing errors to avoid data loss
        // But do reset transmission status if we're not expecting more data
        if (quickFrameType === 'EOT' || quickFrameType === 'NAK') {
          instrumentConnectionData.transmissionStatusSubject.next(false);
        }
      }
    });
  }

  // Process complete ASTM data after receiving EOT or NAK
  // This method is designed to handle large data sets without blocking the UI
  private processCompleteASTMData(astmProtocolType: string, instrumentConnectionData: InstrumentConnectionStack) {
    const that = this;

    // Validate we have data to process
    if (!that.strData || that.strData.trim() === '') {
      that.utilitiesService.logger('warning', 'No ASTM data to process after EOT', instrumentConnectionData.instrumentId);
      instrumentConnectionData.transmissionStatusSubject.next(false);
      return;
    }

    const dataLength = that.strData.length;
    that.utilitiesService.logger('info', `Processing ${dataLength} characters of ASTM data`, instrumentConnectionData.instrumentId);

    // Create raw data record asynchronously
    const rawData: RawMachineData = {
      data: that.strData,
      machine: instrumentConnectionData.instrumentId,
      instrument_id: instrumentConnectionData.instrumentId
    };

    // **ASYNC DATABASE OPERATIONS** - Don't block the main thread
    setImmediate(() => {
      that.dbService.recordRawData(rawData,
        () => {
          that.utilitiesService.logger('success', `Successfully saved ${dataLength} chars of raw ASTM data`, instrumentConnectionData.instrumentId);
        },
        (err: any) => {
          that.utilitiesService.logger('error', `Failed to save raw data: ${JSON.stringify(err)}`, instrumentConnectionData.instrumentId);
        }
      );
    });

    // **ASYNC DATA PROCESSING** - Process data without blocking
    setImmediate(() => {
      try {
        let origAstmData = that.strData;
        let withChecksum = astmProtocolType !== 'astm-nonchecksum';
        let astmData = that.utilitiesService.removeControlCharacters(origAstmData, withChecksum);

        // Validate cleaned data
        if (!astmData || astmData.trim() === '') {
          that.utilitiesService.logger('warning', 'No valid ASTM data after removing control characters', instrumentConnectionData.instrumentId);
          return;
        }

        const fullDataArray = astmData.split(that.astmHelper.getStartMarker());
        const recordCount = fullDataArray.filter(data => data && data.trim() !== '').length;

        that.utilitiesService.logger('info', `Found ${recordCount} ASTM records to process`, instrumentConnectionData.instrumentId);

        // Process each data block
        that.processASTMDataBlocks(fullDataArray, instrumentConnectionData);

      } catch (processingError) {
        that.utilitiesService.logger('error', `Error processing complete ASTM data: ${processingError}`, instrumentConnectionData.instrumentId);
        that.utilitiesService.logger('error', `Data causing error: ${that.strData.substring(0, 200)}...`, instrumentConnectionData.instrumentId);
      } finally {
        // Always clear data and reset transmission status
        that.strData = '';
        instrumentConnectionData.transmissionStatusSubject.next(false);
        that.utilitiesService.logger('info', 'ASTM transmission processing completed', instrumentConnectionData.instrumentId);
      }
    });
  }

  // Process each ASTM data block in batches to avoid UI blocking
  // This method is designed to handle large data sets without blocking the UI
  private processASTMDataBlocks(fullDataArray: string[], instrumentConnectionData: InstrumentConnectionStack) {
    const that = this;
    let processedCount = 0;
    let errorCount = 0;

    // Process each complete ASTM record
    for (let i = 0; i < fullDataArray.length; i++) {
      const partData = fullDataArray[i];

      if (!partData || partData.trim() === '') {
        continue; // Skip empty records
      }

      try {
        const astmArray = partData.split(/<CR>/);

        if (Array.isArray(astmArray) && astmArray.length > 0) {
          const dataArray = that.astmHelper.getASTMDataBlock(astmArray);

          // Check if dataArray is empty
          if (!dataArray || Object.keys(dataArray).length === 0) {
            that.utilitiesService.logger('info', `No valid ASTM data in record ${i + 1}: ${JSON.stringify(astmArray)}`, instrumentConnectionData.instrumentId);
            continue;
          }

          // Save this complete ASTM record
          that.saveASTMDataBlock(dataArray, partData, instrumentConnectionData, i + 1);
          processedCount++;

        } else {
          that.utilitiesService.logger('warning', `Invalid ASTM array structure in record ${i + 1}`, instrumentConnectionData.instrumentId);
        }

      } catch (blockError) {
        errorCount++;
        that.utilitiesService.logger('error', `Error processing ASTM record ${i + 1}: ${blockError}`, instrumentConnectionData.instrumentId);
        that.utilitiesService.logger('error', `Problematic data: ${partData.substring(0, 100)}...`, instrumentConnectionData.instrumentId);
      }
    }

    that.utilitiesService.logger('info', `ASTM processing summary: ${processedCount} records processed, ${errorCount} errors`, instrumentConnectionData.instrumentId);
  }

  private receiveHL7(instrumentConnectionData: InstrumentConnectionStack, data: Buffer) {
    const that = this;
    instrumentConnectionData.transmissionStatusSubject.next(true);

    const hl7Text = that.utilitiesService.hex2ascii(data.toString('hex'));

    // **IMMEDIATE ACK PROCESSING** - Critical for timing
    // Quick HL7 frame detection without heavy processing
    let shouldSendAck = false;
    let quickFrameType = null;
    let isEndOfTransmission = false;

    // Quick HL7 frame validation - check for common HL7 patterns
    if (hl7Text.includes('MSH|')) {
      shouldSendAck = true;
      quickFrameType = 'HL7_MESSAGE';
    } else if (hl7Text.includes('\x0b') || hl7Text.includes('\x1c')) {
      // Start block (VT) or File separator (FS) - valid HL7 control chars
      shouldSendAck = true;
      quickFrameType = 'HL7_CONTROL';
    } else if (hl7Text.includes('ACK|')) {
      shouldSendAck = false; // Don't ACK an ACK
      quickFrameType = 'HL7_ACK';
    }

    // Check for end of transmission (but don't process yet)
    if (hl7Text.includes('\x1c')) {
      isEndOfTransmission = true;
    }

    // **SEND ACK IMMEDIATELY** - Before any heavy processing
    if (shouldSendAck && isEndOfTransmission) {
      // For HL7, we need to send ACK after we have the complete message
      // But we can do a quick parse just for ACK generation
      try {
        // Quick parse just to get MSH fields for ACK
        const quickMshMatch = (that.strData + hl7Text).match(/MSH\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|([^|]*)\|[^|]*\|([^|]*)/);

        if (quickMshMatch) {
          const msgID = quickMshMatch[1] || '';
          const hl7Version = quickMshMatch[2] || '2.5.1';

          // Generate quick ACK
          const quickAck = that.hl7Helper.generateHL7ACK(msgID, 'UNICODE UTF-8', '', hl7Version);
          instrumentConnectionData.connectionSocket.write(quickAck);
          that.utilitiesService.logger('info', `Sending HL7 ACK for ${quickFrameType} frame`, instrumentConnectionData.instrumentId);
        } else {
          // Fallback: send basic ACK
          const basicAck = that.hl7Helper.generateHL7ACK('', 'UNICODE UTF-8', '', '2.5.1');
          instrumentConnectionData.connectionSocket.write(basicAck);
          that.utilitiesService.logger('info', `Sending basic HL7 ACK for ${quickFrameType} frame`, instrumentConnectionData.instrumentId);
        }
      } catch (ackError) {
        that.utilitiesService.logger('error', `Failed to send HL7 ACK for ${quickFrameType}: ${ackError}`, instrumentConnectionData.instrumentId);
        // Continue processing even if ACK fails
      }
    }

    // **ASYNC PROCESSING** - Heavy operations moved to next tick to prevent blocking
    setImmediate(() => {
      try {
        // Accumulate data immediately (no delay)
        that.strData += hl7Text;

        that.utilitiesService.logger('info', `HL7 | Receiving ${quickFrameType || 'UNKNOWN'}: ${hl7Text.substring(0, 50)}${hl7Text.length > 50 ? '...' : ''}`, instrumentConnectionData.instrumentId);

        // Check if we have complete transmission
        if (that.strData.includes('\x1c')) {
          that.utilitiesService.logger('info', 'Received File Separator Character. Processing complete HL7 transmission.', instrumentConnectionData.instrumentId);

          // Process the complete HL7 data asynchronously
          that.processCompleteHL7Data(instrumentConnectionData);
        }

      } catch (processingError) {
        that.utilitiesService.logger('error', `Error processing HL7 data: ${processingError}`, instrumentConnectionData.instrumentId);
        that.utilitiesService.logger('error', `Raw data causing error: ${hl7Text}`, instrumentConnectionData.instrumentId);

        // Reset transmission status on errors
        if (isEndOfTransmission) {
          instrumentConnectionData.transmissionStatusSubject.next(false);
        }
      }
    });
  }

  // **NEW HELPER METHOD** - Process complete HL7 data asynchronously
  private processCompleteHL7Data(instrumentConnectionData: InstrumentConnectionStack) {
    const that = this;

    // Validate we have data to process
    if (!that.strData || that.strData.trim() === '') {
      that.utilitiesService.logger('warning', 'No HL7 data to process after File Separator', instrumentConnectionData.instrumentId);
      instrumentConnectionData.transmissionStatusSubject.next(false);
      return;
    }

    const dataLength = that.strData.length;
    that.utilitiesService.logger('info', `Processing ${dataLength} characters of HL7 data`, instrumentConnectionData.instrumentId);

    // Create raw data record asynchronously
    const rawData: RawMachineData = {
      data: that.strData,
      machine: instrumentConnectionData.instrumentId,
      instrument_id: instrumentConnectionData.instrumentId
    };

    // **ASYNC DATABASE OPERATIONS** - Don't block the main thread
    setImmediate(() => {
      that.dbService.recordRawData(rawData,
        () => {
          that.utilitiesService.logger('success', `Successfully saved ${dataLength} chars of raw HL7 data`, instrumentConnectionData.instrumentId);
        },
        (err: any) => {
          that.utilitiesService.logger('error', `Failed to save raw HL7 data: ${JSON.stringify(err)}`, instrumentConnectionData.instrumentId);
        }
      );
    });

    // **ASYNC DATA PROCESSING** - Process data without blocking
    setImmediate(() => {
      try {
        // Clean the HL7 data
        let cleanedData = that.strData.replace(/[\x0b\x1c]/g, '');
        cleanedData = cleanedData.trim();
        cleanedData = cleanedData.replace(/[\r\n\x0B\x0C\u0085\u2028\u2029]+/gm, '\r');

        // Validate cleaned data
        if (!cleanedData || cleanedData.trim() === '') {
          that.utilitiesService.logger('warning', 'No valid HL7 data after cleaning control characters', instrumentConnectionData.instrumentId);
          return;
        }

        that.utilitiesService.logger('info', `Cleaned HL7 data for processing: ${cleanedData.length} characters`, instrumentConnectionData.instrumentId);

        // Route to appropriate processor based on machine type
        that.routeHL7Processing(instrumentConnectionData, cleanedData);

      } catch (processingError) {
        that.utilitiesService.logger('error', `Error processing complete HL7 data: ${processingError}`, instrumentConnectionData.instrumentId);
        that.utilitiesService.logger('error', `Data causing error: ${that.strData.substring(0, 200)}...`, instrumentConnectionData.instrumentId);
      } finally {
        // Always clear data and reset transmission status
        that.strData = '';
        instrumentConnectionData.transmissionStatusSubject.next(false);
        that.utilitiesService.logger('info', 'HL7 transmission processing completed', instrumentConnectionData.instrumentId);
      }
    });
  }

  // **NEW HELPER METHOD** - Route HL7 processing based on machine type
  private routeHL7Processing(instrumentConnectionData: InstrumentConnectionStack, cleanedData: string) {
    const that = this;

    try {
      if (instrumentConnectionData.machineType === 'abbott-alinity-m') {
        that.utilitiesService.logger('info', 'Processing as Abbott Alinity-M HL7 data', instrumentConnectionData.instrumentId);
        that.processHL7DataAlinity(instrumentConnectionData, cleanedData);
      } else if (instrumentConnectionData.machineType === 'roche-cobas-5800') {
        that.utilitiesService.logger('info', 'Processing as Roche COBAS 5800 HL7 data', instrumentConnectionData.instrumentId);
        that.processHL7DataRoche5800(instrumentConnectionData, cleanedData);
      } else if (instrumentConnectionData.machineType === 'roche-cobas-6800') {
        that.utilitiesService.logger('info', 'Processing as Roche COBAS 6800/8800 HL7 data', instrumentConnectionData.instrumentId);
        that.processHL7DataRoche68008800(instrumentConnectionData, cleanedData);
      } else {
        that.utilitiesService.logger('info', 'Processing as Generic HL7 data', instrumentConnectionData.instrumentId);
        that.processHL7Data(instrumentConnectionData, cleanedData);
      }
    } catch (routingError) {
      that.utilitiesService.logger('error', `Error in HL7 processing routing: ${routingError}`, instrumentConnectionData.instrumentId);
      that.utilitiesService.logger('error', `Machine type: ${instrumentConnectionData.machineType}`, instrumentConnectionData.instrumentId);
    }
  }


  handleTCPResponse(connectionIdentifierKey: string, data: Buffer) {
    const that = this;
    const instrumentConnectionData = that.tcpService.connectionStack.get(connectionIdentifierKey);
    // First ensure the instrument is marked as connected
    if (instrumentConnectionData) {
      // Explicitly mark as connected whenever we receive data
      instrumentConnectionData.statusSubject.next(true);
    }

    // Then process the data based on protocol
    if (instrumentConnectionData.connectionProtocol === 'hl7') {
      that.receiveHL7(instrumentConnectionData, data);
    } else if (instrumentConnectionData.connectionProtocol === 'astm-nonchecksum') {
      that.receiveASTM('astm-nonchecksum', instrumentConnectionData, data);
    } else if (instrumentConnectionData.connectionProtocol === 'astm-checksum') {
      that.receiveASTM('astm-checksum', instrumentConnectionData, data);
    }
  }

  private saveASTMDataBlock(dataArray: {}, partData: string, instrumentConnectionData: InstrumentConnectionStack, recordNumber?: number) {
    const that = this;

    // Use setImmediate to ensure this doesn't block incoming data
    setImmediate(() => {
      try {
        const recordLabel = recordNumber ? `record ${recordNumber}` : 'record';
        that.utilitiesService.logger('info', `Processing ASTM ${recordLabel} for database save...`, instrumentConnectionData.instrumentId);

        // Log data structure for debugging (but limit size)
        const dataStr = JSON.stringify(dataArray);
        const logData = dataStr.length > 200 ? dataStr.substring(0, 200) + '...' : dataStr;
        that.utilitiesService.logger('info', `ASTM ${recordLabel} structure: ${logData}`, instrumentConnectionData.instrumentId);

        // Extract sample result from the ASTM data
        const sampleResult = that.astmHelper.extractSampleResultFromASTM(dataArray, partData);

        if (sampleResult) {
          // Add location information
          sampleResult.test_location = instrumentConnectionData.labName;
          sampleResult.machine_used = instrumentConnectionData.instrumentId;

          // **ASYNC DATABASE SAVE** - Don't block the processing thread
          setImmediate(() => {
            that.saveResult(sampleResult, instrumentConnectionData);
          });

        } else {
          that.utilitiesService.logger('error', `Order record not found in ASTM ${recordLabel}`, instrumentConnectionData.instrumentId);
          that.utilitiesService.logger('error', `ASTM ${recordLabel} data: ${logData}`, instrumentConnectionData.instrumentId);
        }

      } catch (saveError) {
        that.utilitiesService.logger('error', `Error in saveASTMDataBlock: ${saveError}`, instrumentConnectionData.instrumentId);
        that.utilitiesService.logger('error', `Data causing save error: ${partData.substring(0, 100)}...`, instrumentConnectionData.instrumentId);
      }
    });
  }

  // TEST ORDERS SECTION

  // Method to fetch orders and send as ASTM messages
  fetchAndSendASTMOrders(instrument: any) {
    let that = this;
    // Fetching orders from the database
    that.dbService.getOrdersToSend(
      (orders: any[]) => { // Assuming getOrdersToSend now returns an array of orders
        if (!orders || orders.length === 0) {
          that.utilitiesService.logger('error', "No orders to send for " + instrument.connectionParams.instrumentId, instrument.connectionParams.instrumentId);
          return;
        }

        orders.forEach(order => {
          // Generate the ASTM message for each order
          const astmMessage = that.astmHelper.generateASTMMessageForOrder(order);

          // Frame the ASTM message with control characters
          const framedMessage = that.astmHelper.frameASTMMessage(astmMessage, instrument.connectionParams.instrumentId);

          // Send the framed message over TCP
          // Assuming tcpService has a method like sendData that takes host, port, and the message
          that.tcpService.sendData(instrument.connectionParams, framedMessage);
        });
      },
      (err: any) => {
        //console.error("Error fetching orders to send:", err);
      }
    );
  }

  fetchAndSendHL7Orders(instrument: any) {
    const that = this;
    that.dbService.getOrdersToSend(
      (orders: any[]) => {
        if (!orders || orders.length === 0) {
          that.utilitiesService.logger('error', 'No orders to send for ' + instrument.connectionParams.instrumentId, instrument.connectionParams.instrumentId);
          return;
        }

        orders.forEach(order => {
          // Generate HL7 message for each order
          const hl7Message = that.hl7Helper.generateHL7MessageForOrder(order);

          // Frame the HL7 message with necessary control characters
          const framedMessage = that.hl7Helper.frameHL7Message(hl7Message);

          // Send the framed message over TCP
          that.tcpService.sendData(instrument.connectionParams, framedMessage);
        });
      },
      (err: any) => {
        console.error('Error fetching orders to send:', err);
      }
    );
  }

}
