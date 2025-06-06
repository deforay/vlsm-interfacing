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
  processHL7DataAlinity(instrumentConnectionData: InstrumentConnectionStack, rawHl7Text: string) {
    const that = this;
    const message = that.hl7Helper.createHL7Message(rawHl7Text.trim());
    const msgID = message.get('MSH.10')?.toString() ?? '';
    const characterSet = message.get('MSH.18')?.toString() ?? 'UNICODE UTF-8';
    const messageProfileIdentifier = message.get('MSH.21')?.toString() ?? '';
    const hl7Version = message.get('MSH.12')?.toString() ?? '2.5.1';

    that.hl7Helper.sendHL7ACK(instrumentConnectionData, msgID, characterSet, messageProfileIdentifier, hl7Version);

    const hl7DataArray = rawHl7Text.split('MSH|');

    hl7DataArray.forEach(function (rawText: string) {
      if (rawText.trim() === '') { return; }

      rawText = 'MSH|' + rawText.trim();
      const message = that.hl7Helper.createHL7Message(rawText);

      if (message === '' || message === null || message.get('SPM') === null || message.get('OBX') === null) {
        return;
      }

      const obx = message.get('OBX').toArray();
      const spm = message.get('SPM');

      spm.forEach(function (singleSpm) {
        // For Alinity, we typically use the first OBX for each SPM
        let singleObx = obx[0];

        // // Fall back to other OBX segments if needed
        // if (!singleObx && obx.length > 0) {
        //   singleObx = obx[0];
        // }

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
        //const resultOutcome = singleObx.get('OBX.5.1')?.toString() ?? '';
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

        that.saveResult(sampleResult, instrumentConnectionData);
      });
    });
  }

  processHL7Data(instrumentConnectionData: InstrumentConnectionStack, rawHl7Text: string) {
    const that = this;
    const message = that.hl7Helper.createHL7Message(rawHl7Text.trim());
    const msgID = message.get('MSH.10')?.toString() ?? '';
    const characterSet = message.get('MSH.18')?.toString() ?? 'UNICODE UTF-8';
    const messageProfileIdentifier = message.get('MSH.21')?.toString() ?? '';
    const hl7Version = message.get('MSH.12')?.toString() ?? '2.5.1';

    that.hl7Helper.sendHL7ACK(instrumentConnectionData, msgID, characterSet, messageProfileIdentifier, hl7Version);

    const hl7DataArray = rawHl7Text.split('MSH|');

    hl7DataArray.forEach(function (rawText: string) {
      if (rawText.trim() === '') { return; }

      rawText = 'MSH|' + rawText.trim();
      const message = that.hl7Helper.createHL7Message(rawText);

      if (message === '' || message === null || message.get('SPM') === null || message.get('OBX') === null) {
        return;
      }

      const obx = message.get('OBX').toArray();
      const spm = message.get('SPM');

      spm.forEach(function (singleSpm) {
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

        that.saveResult(sampleResult, instrumentConnectionData);
      });
    });
  }

  processHL7DataRoche5800(instrumentConnectionData: InstrumentConnectionStack, rawHl7Text: string) {
    const that = this;
    const message = that.hl7Helper.createHL7Message(rawHl7Text.trim());
    const msgID = message.get('MSH.10')?.toString() ?? '';
    const characterSet = message.get('MSH.18')?.toString() ?? 'UNICODE UTF-8';
    const messageProfileIdentifier = message.get('MSH.21')?.toString() ?? '';
    const hl7Version = message.get('MSH.12')?.toString() ?? '2.5.1';

    that.hl7Helper.sendHL7ACK(instrumentConnectionData, msgID, characterSet, messageProfileIdentifier, hl7Version);

    const hl7DataArray = rawHl7Text.split('MSH|');

    hl7DataArray.forEach(function (rawText: string) {
      if (rawText.trim() === '') { return; }

      rawText = 'MSH|' + rawText.trim();
      const message = that.hl7Helper.createHL7Message(rawText);

      if (message === '' || message === null || message.get('SPM') === null || message.get('OBX') === null) {
        return;
      }

      const obx = message.get('OBX').toArray();
      const spm = message.get('SPM');

      spm.forEach(function (singleSpm) {
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

        that.saveResult(sampleResult, instrumentConnectionData);
      });
    });
  }

  processHL7DataRoche68008800(instrumentConnectionData: InstrumentConnectionStack, rawHl7Text: string) {
    const that = this;
    const message = that.hl7Helper.createHL7Message(rawHl7Text.trim());
    const msgID = message.get('MSH.10')?.toString() ?? '';
    const characterSet = message.get('MSH.18')?.toString() ?? 'UNICODE UTF-8';
    const messageProfileIdentifier = message.get('MSH.21')?.toString() ?? '';
    const hl7Version = message.get('MSH.12')?.toString() ?? '2.5.1';

    that.hl7Helper.sendHL7ACK(instrumentConnectionData, msgID, characterSet, messageProfileIdentifier, hl7Version);

    const hl7DataArray = rawHl7Text.split('MSH|');

    hl7DataArray.forEach(function (rawText: string) {
      if (rawText.trim() === '') { return; }

      rawText = 'MSH|' + rawText.trim();
      const message = that.hl7Helper.createHL7Message(rawText);

      if (message === '' || message === null || message.get('SPM') === null || message.get('OBX') === null) {
        return;
      }

      const obxArray = message.get('OBX').toArray();
      const spm = message.get('SPM');

      spm.forEach(function (singleSpm: any) {
        // For 6800/8800, look for OBX with OBX.4 = "1/2"
        let resultOutcome = '';
        let singleObx = null;

        // This specific logic for 6800/8800 looks for "1/2" in OBX.4
        obxArray.forEach(function (obx: any) {
          if (obx.get('OBX.4')?.toString() === '1/2') {
            resultOutcome = obx.get('OBX.5.1')?.toString() ?? '';
            singleObx = obx;
            if (resultOutcome === 'Titer') {
              singleObx = obxArray[0];
              resultOutcome = obx.get('OBX.5.1')?.toString() ?? '';
            }
          }
        });

        // If no OBX segment with "1/2", fall back to first OBX
        if (!singleObx && obxArray.length > 0) {
          singleObx = obxArray[0];
          resultOutcome = singleObx.get('OBX.5.1')?.toString() ?? '';
        }

        // Safety check
        if (!singleObx) {
          that.utilitiesService.logger('error', 'No valid OBX segment found for Roche 6800/8800', instrumentConnectionData.instrumentId);
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

        that.saveResult(sampleResult, instrumentConnectionData);
      });
    });
  }


  private receiveASTM(astmProtocolType: string, instrumentConnectionData: InstrumentConnectionStack, data: Buffer) {
    const that = this;
    instrumentConnectionData.transmissionStatusSubject.next(true);
    //that.utilitiesService.logger('info', 'Receiving ' + astmProtocolType, instrumentConnectionData.instrumentId);
    let astmText = that.utilitiesService.hex2ascii(data.toString('hex'));

    // Use the helper to process ASTM text
    const processedText = that.astmHelper.processASTMText(astmText);

    if (processedText.isEOT) {
      that.astmHelper.sendACK(instrumentConnectionData, 'Sending ACK');
      that.utilitiesService.logger('info', 'Received EOT. Sending ACK.', instrumentConnectionData.instrumentId);
      that.utilitiesService.logger('info', 'Processing ' + astmProtocolType, instrumentConnectionData.instrumentId);
      that.utilitiesService.logger('info', 'Received  ' + that.strData, instrumentConnectionData.instrumentId);

      const rawData: RawMachineData = {
        data: that.strData,
        machine: instrumentConnectionData.instrumentId,
        instrument_id: instrumentConnectionData.instrumentId
      };
      process.nextTick(() => {
        that.dbService.recordRawData(rawData, () => {
          that.utilitiesService.logger('success', 'Successfully saved raw ASTM data', instrumentConnectionData.instrumentId);
        }, (err: any) => {
          that.utilitiesService.logger('error', 'Failed to save raw data : ' + JSON.stringify(err), instrumentConnectionData.instrumentId);
        });
      });

      let origAstmData = that.strData;

      let withChecksum = astmProtocolType !== 'astm-nonchecksum'; // true unless astm-nonchecksum

      let astmData = that.utilitiesService.removeControlCharacters(origAstmData, withChecksum);
      const fullDataArray = astmData.split(that.astmHelper.getStartMarker());

      for (const partData of fullDataArray) {
        if (partData) {
          const astmArray = partData.split(/<CR>/);

          if (Array.isArray(astmArray) && astmArray.length > 0) {
            const dataArray = that.astmHelper.getASTMDataBlock(astmArray);

            // Check if dataArray is empty
            if (Object.keys(dataArray).length === 0) {
              that.utilitiesService.logger('info', 'No ASTM data received for following:', instrumentConnectionData.instrumentId);
              that.utilitiesService.logger('info', astmArray, instrumentConnectionData.instrumentId);
              continue;
            }

            that.saveASTMDataBlock(dataArray, partData, instrumentConnectionData);
          }
        }
      }

      that.strData = '';
      instrumentConnectionData.transmissionStatusSubject.next(false);
    } else if (processedText.isNAK) {
      that.astmHelper.sendACK(instrumentConnectionData, 'Sending ACK');
      that.utilitiesService.logger('error', 'NAK Received', instrumentConnectionData.instrumentId);
      that.utilitiesService.logger('info', 'Sending ACK', instrumentConnectionData.instrumentId);
    } else {
      that.astmHelper.sendACK(instrumentConnectionData, 'Sending ACK');
      // If it's a header, it's already been processed in processASTMText
      if (processedText.isHeader) {
        that.strData += processedText.text;
      } else {
        that.strData += astmText;
      }

      that.utilitiesService.logger('info', astmProtocolType.toUpperCase() + ' | Receiving....' + astmText, instrumentConnectionData.instrumentId);
      that.utilitiesService.logger('info', 'Sending ACK', instrumentConnectionData.instrumentId);
    }
  }

  private receiveHL7(instrumentConnectionData: InstrumentConnectionStack, data: Buffer) {
    let that = this;
    instrumentConnectionData.transmissionStatusSubject.next(true);
    that.utilitiesService.logger('info', 'Receiving HL7 data', instrumentConnectionData.instrumentId);
    const hl7Text = that.utilitiesService.hex2ascii(data.toString('hex'));
    that.strData += hl7Text;

    that.utilitiesService.logger('info', hl7Text, instrumentConnectionData.instrumentId);

    // If there is a File Separator or 1C or ASCII 28 character,
    // it means the stream has ended and we can proceed with saving this data
    if (that.strData.includes('\x1c')) {
      // Let us store this Raw Data before we process it
      instrumentConnectionData.transmissionStatusSubject.next(false);
      that.utilitiesService.logger('info', 'Received File Separator Character. Ready to process HL7 data', instrumentConnectionData.instrumentId);

      const rawData: RawMachineData = {
        data: that.strData,
        machine: instrumentConnectionData.instrumentId,
        instrument_id: instrumentConnectionData.instrumentId
      };
      process.nextTick(() => {
        that.dbService.recordRawData(rawData, () => {
          that.utilitiesService.logger('success', 'Successfully saved raw HL7 data', instrumentConnectionData.instrumentId);
        }, (err: any) => {
          that.utilitiesService.logger('error', 'Failed to save raw data ' + JSON.stringify(err), instrumentConnectionData.instrumentId);
        });
      });


      that.strData = that.strData.replace(/[\x0b\x1c]/g, '');
      that.strData = that.strData.trim();
      that.strData = that.strData.replace(/[\r\n\x0B\x0C\u0085\u2028\u2029]+/gm, '\r');

      //console.error(that.strData);

      if (instrumentConnectionData.machineType === 'abbott-alinity-m') {
        that.processHL7DataAlinity(instrumentConnectionData, that.strData);
      }
      else if (instrumentConnectionData.machineType === 'roche-cobas-5800') {
        that.processHL7DataRoche5800(instrumentConnectionData, that.strData);
      }
      else if (instrumentConnectionData.machineType === 'roche-cobas-6800') {
        that.processHL7DataRoche68008800(instrumentConnectionData, that.strData);
      }
      else {
        that.processHL7Data(instrumentConnectionData, that.strData);
      }

      that.strData = '';
      instrumentConnectionData.transmissionStatusSubject.next(false);
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

  private saveResult(sampleResult: any, instrumentConnectionData: InstrumentConnectionStack) {
    const that = this;
    if (sampleResult) {
      const data = { ...sampleResult, instrument_id: instrumentConnectionData.instrumentId };
      process.nextTick(() => {
        that.dbService.recordTestResults(data,
          (res) => {
            that.utilitiesService.logger('success', 'Successfully saved result : ' + sampleResult.test_id + '|' + sampleResult.order_id, instrumentConnectionData.instrumentId);
            return true;
          },
          (err) => {
            that.utilitiesService.logger('error', 'Failed to save result : ' + sampleResult.test_id + '|' + sampleResult.order_id + ' | ' + JSON.stringify(err), instrumentConnectionData.instrumentId);
            return false;
          });
      });
    } else {
      that.utilitiesService.logger('error', 'Failed to save result into the database : ' + JSON.stringify(sampleResult), instrumentConnectionData.instrumentId);
      return false;
    }
  }

  private saveASTMDataBlock(dataArray: {}, partData: string, instrumentConnectionData: InstrumentConnectionStack) {
    const that = this;

    that.utilitiesService.logger('info', 'Processing following ASTM Data to save into database...', instrumentConnectionData.instrumentId);
    that.utilitiesService.logger('info', JSON.stringify(dataArray), instrumentConnectionData.instrumentId);

    // Extract sample result from the ASTM data
    const sampleResult = that.astmHelper.extractSampleResultFromASTM(dataArray, partData);

    if (sampleResult) {
      // Add location information
      sampleResult.test_location = instrumentConnectionData.labName;
      sampleResult.machine_used = instrumentConnectionData.instrumentId;

      // Save the result
      return that.saveResult(sampleResult, instrumentConnectionData);
    } else {
      that.utilitiesService.logger('error', 'Order record not found in the following ASTM data block', instrumentConnectionData.instrumentId);
      that.utilitiesService.logger('error', JSON.stringify(dataArray), instrumentConnectionData.instrumentId);
      return false;
    }
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
