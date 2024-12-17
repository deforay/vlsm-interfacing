import { Injectable } from '@angular/core';
import { DatabaseService } from './database.service';
import { InstrumentConnectionStack } from '../interfaces/intrument-connections.interface';
import { RawMachineData } from '../interfaces/raw-machine-data.interface';
import { UtilitiesService } from './utilities.service';
import { randomUUID } from 'crypto';
import { TcpConnectionService } from './tcp-connection.service';

@Injectable({
  providedIn: 'root'
})

export class InstrumentInterfaceService {

  public hl7parser = require('hl7parser');

  // protected ACK = Buffer.from('06', 'hex');
  // protected EOT = '04';
  protected NAK = '\x15'; // Negative Acknowledge
  protected STX = '\x02'; // Start of Text
  protected ETX = '\x03'; // End of Text
  protected EOT = '\x04'; // End of Transmission
  protected ENQ = '\x05'; // Enquiry
  protected ACK = '\x06'; // Acknowledge
  protected LF = '\x0A'; // Line Feed
  protected CR = '\x0D'; // Carriage Return

  protected START = '##START##';

  protected strData = '';

  private astmSequenceNumbers: Map<string, number> = new Map();


  constructor(public dbService: DatabaseService,
    public tcpService: TcpConnectionService,
    public utilitiesService: UtilitiesService) {
  }


  // Method used to connect to the Testing Machine
  connect(instrument: any) {
    const that = this;
    if (instrument && instrument.connectionParams) {
      // Bind 'this' explicitly to handleTCPResponse
      const boundHandleTCPResponse = that.handleTCPResponse.bind(that);
      that.tcpService.connect(instrument.connectionParams, boundHandleTCPResponse);
    }
  }

  reconnect(instrument: any) {
    const that = this;
    if (instrument && instrument.connectionParams) {
      // Bind 'this' explicitly to handleTCPResponse
      const boundHandleTCPResponse = that.handleTCPResponse.bind(that);
      that.tcpService.reconnect(instrument.connectionParams, boundHandleTCPResponse);
    }
  }

  disconnect(instrument: any) {
    const that = this;
    if (instrument && instrument.connectionParams && instrument.connectionParams.host && instrument.connectionParams.port) {
      that.tcpService.disconnect(instrument.connectionParams);
    }
  }


  hl7ACK(messageID: string | number, characterSet: string, messageProfileIdentifier: string, hl7Version = '2.5.1') {

    const that = this;

    if (!messageID || messageID === '') {
      messageID = Math.random();
    }

    if (!characterSet || characterSet === '') {
      characterSet = 'UNICODE UTF-8';
    }
    if (!messageProfileIdentifier || messageProfileIdentifier === '') {
      messageProfileIdentifier = '';
    }

    const moment = require('moment');
    const date = moment(new Date()).format('YYYYMMDDHHmmss');

    let ack = String.fromCharCode(11)
      + 'MSH|^~\\&|VLSM|VLSM|VLSM|VLSM|'
      + date + '||ACK^R22^ACK|'
      + randomUUID() + '|P|' + hl7Version + '|||||'
      + "|" + characterSet
      + "|" + messageProfileIdentifier
      + String.fromCharCode(13);

    ack += 'MSA|AA|' + messageID
      + String.fromCharCode(13)
      + String.fromCharCode(28)
      + String.fromCharCode(13);

    that.utilitiesService.logger('info', 'Sending HL7 ACK : ' + ack);
    return ack;
  }


  processHL7DataAlinity(instrumentConnectionData: InstrumentConnectionStack, rawHl7Text: string) {

    const that = this;
    const message = that.hl7parser.create(rawHl7Text.trim());
    const msgID = message.get('MSH.10').toString();
    const characterSet = message.get('MSH.18').toString();
    const messageProfileIdentifier = message.get('MSH.21').toString();
    const hl7Version = message.get('MSH.12') ? message.get('MSH.12').toString() : '2.5.1'; // Default to 2.5.1 if not provided
    that.tcpService.socketClient.write(that.hl7ACK(msgID, characterSet, messageProfileIdentifier, hl7Version));
    // let result = null;
    //console.log(message.get('OBX'));

    const hl7DataArray = rawHl7Text.split('MSH|');

    hl7DataArray.forEach(function (rawText: string) {

      if (rawText.trim() === '') { return; }

      rawText = 'MSH|' + rawText.trim();
      const message = that.hl7parser.create(rawText);

      if (message === '' || message === null || message.get('SPM') === null || message.get('OBX') === null) {
        return;
      }

      const obx = message.get('OBX').toArray();

      //obx.forEach(function (singleObx) {
      //  console.log(singleObx);
      //});

      const spm = message.get('SPM');

      //console.log(obx[1]);
      spm.forEach(function (singleSpm) {
        //sampleNumber = (singleSpm.get(1).toInteger());
        //const singleObx = obx[(sampleNumber * 2) - 1]; // there are twice as many OBX .. so we take the even number - 1 OBX for each SPM
        const singleObx = obx[0]; // there are twice as many OBX .. so we take the even number - 1 OBX for each SPM

        //console.log(singleObx.get('OBX.19').toString())

        const resultOutcome = singleObx.get('OBX.5.1').toString();

        const sampleResult: any = {};
        sampleResult.raw_text = rawText;
        sampleResult.order_id = singleSpm.get('SPM.3').toString().replace('&ROCHE', '');
        sampleResult.test_id = singleSpm.get('SPM.3').toString().replace('&ROCHE', '');

        if (sampleResult.order_id === "") {
          // const sac = message.get('SAC').toArray();
          // const singleSAC = sac[0];
          //Let us use the Sample Container ID as the Order ID
          sampleResult.order_id = message.get('SAC.3').toString();
          sampleResult.test_id = message.get('SAC.3').toString();
        }

        sampleResult.test_type = message.get('OBR.4.2')?.toString() || message.get('OBX.3.2')?.toString() || 'HIVVL';

        if (resultOutcome === 'Titer') {
          sampleResult.test_unit = singleObx.get('OBX.6.1').toString();
          sampleResult.results = singleObx.get('OBX.5.1').toString();
        } else if (resultOutcome === '> Titer max') {
          sampleResult.test_unit = '';
          sampleResult.results = '> 10000000';
        } else if (
          resultOutcome == 'Target Not Detected'
          || resultOutcome == 'Failed'
          || resultOutcome == 'Invalid'
          || resultOutcome == 'Not Detected') {
          sampleResult.test_unit = '';
          sampleResult.results = resultOutcome;
        } else {
          sampleResult.test_unit = singleObx.get('OBX.6.1').toString();
          if (!sampleResult.test_unit) {
            sampleResult.test_unit = singleObx.get('OBX.6.2').toString();
          }
          if (!sampleResult.test_unit) {
            sampleResult.test_unit = singleObx.get('OBX.6').toString();
          }
          sampleResult.results = resultOutcome;
        }

        sampleResult.tested_by = singleObx.get('OBX.16').toString();
        sampleResult.result_status = 1;
        sampleResult.lims_sync_status = 0;
        sampleResult.analysed_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        //sampleResult.specimen_date_time = that.formatRawDate(message.get('OBX').get(0).get('OBX.19').toString());
        sampleResult.authorised_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        sampleResult.result_accepted_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        sampleResult.test_location = instrumentConnectionData.labName;
        sampleResult.machine_used = instrumentConnectionData.instrumentId;

        that.saveResult(sampleResult, instrumentConnectionData);

      });
    });
  }
  processHL7Data(instrumentConnectionData: InstrumentConnectionStack, rawHl7Text: string) {

    const that = this;
    const message = that.hl7parser.create(rawHl7Text.trim());
    const msgID = message.get('MSH.10').toString();
    const characterSet = message.get('MSH.18').toString();
    const messageProfileIdentifier = message.get('MSH.21').toString();
    const hl7Version = message.get('MSH.12') ? message.get('MSH.12').toString() : '2.5.1'; // Default to 2.5.1 if not provided
    that.tcpService.socketClient.write(that.hl7ACK(msgID, characterSet, messageProfileIdentifier, hl7Version));
    // let result = null;
    //console.log(message.get('OBX'));

    const hl7DataArray = rawHl7Text.split('MSH|');

    hl7DataArray.forEach(function (rawText: string) {

      if (rawText.trim() === '') {
        return;
      }

      rawText = 'MSH|' + rawText.trim();
      const message = that.hl7parser.create(rawText);

      if (message === '' || message === null || message.get('SPM') === null || message.get('OBX') === null) {
        return;
      }

      const obx = message.get('OBX').toArray();

      //obx.forEach(function (singleObx) {
      //  console.log(singleObx);
      //});

      const spm = message.get('SPM');
      let sampleNumber = 0;

      //console.log(obx[1]);
      spm.forEach(function (singleSpm) {
        sampleNumber = (singleSpm.get(1).toInteger());
        if (Number.isNaN(sampleNumber)) {
          sampleNumber = 1;
        }
        let singleObx = obx[(sampleNumber * 2) - 1]; // there are twice as many OBX .. so we take the even number - 1 OBX for each SPM

        //console.log(singleObx.get('OBX.19').toString());

        let resultOutcome = singleObx.get('OBX.5.1').toString();

        const sampleResult: any = {};
        sampleResult.raw_text = rawText;
        sampleResult.order_id = singleSpm.get('SPM.2').toString().replace("&ROCHE", "");
        sampleResult.test_id = singleSpm.get('SPM.2').toString().replace("&ROCHE", "");;

        if (sampleResult.order_id === "") {
          // const sac = message.get('SAC').toArray();
          // const singleSAC = sac[0];
          //Let us use the Sample Container ID as the Order ID
          sampleResult.order_id = message.get('SAC.3').toString();
          sampleResult.test_id = message.get('SAC.3').toString();
        }

        sampleResult.test_type = message.get('OBR.4.2')?.toString() || message.get('OBX.3.2')?.toString() || 'HIVVL';

        if (resultOutcome == 'Titer') {
          sampleResult.test_unit = singleObx.get('OBX.6.1').toString();
          sampleResult.results = singleObx.get('OBX.5.1').toString();
        } else if (resultOutcome == '<20' || resultOutcome == '< 20') {
          sampleResult.test_unit = '';
          sampleResult.results = 'Target Not Detected';
        } else if (resultOutcome == '> Titer max') {
          sampleResult.test_unit = '';
          sampleResult.results = '> 10000000';
        } else if (
          resultOutcome == 'Target Not Detected'
          || resultOutcome == 'Failed'
          || resultOutcome == 'Invalid'
          || resultOutcome == 'Not Detected') {
          sampleResult.test_unit = '';
          sampleResult.results = resultOutcome;
        } else {
          sampleResult.test_unit = singleObx.get('OBX.6.1').toString();
          sampleResult.results = resultOutcome;
        }

        sampleResult.tested_by = singleObx.get('OBX.16').toString();
        sampleResult.result_status = 1;
        sampleResult.lims_sync_status = 0;
        sampleResult.analysed_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        //sampleResult.specimen_date_time = that.formatRawDate(message.get('OBX').get(0).get('OBX.19').toString());
        sampleResult.authorised_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        sampleResult.result_accepted_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        sampleResult.test_location = instrumentConnectionData.labName;
        sampleResult.machine_used = instrumentConnectionData.instrumentId;

        that.saveResult(sampleResult, instrumentConnectionData);

      });
    });
  }

  processHL7DataRoche5800(instrumentConnectionData: InstrumentConnectionStack, rawHl7Text: string) {

    const that = this;
    const message = that.hl7parser.create(rawHl7Text.trim());
    const msgID = message.get('MSH.10').toString();
    const characterSet = message.get('MSH.18').toString();
    const messageProfileIdentifier = message.get('MSH.21').toString();
    const hl7Version = message.get('MSH.12') ? message.get('MSH.12').toString() : '2.5.1'; // Default to 2.5.1 if not provided
    that.tcpService.socketClient.write(that.hl7ACK(msgID, characterSet, messageProfileIdentifier, hl7Version));

    const hl7DataArray = rawHl7Text.split('MSH|');

    hl7DataArray.forEach(function (rawText: string) {

      if (rawText.trim() === '') { return; }

      rawText = 'MSH|' + rawText.trim();
      const message = that.hl7parser.create(rawText);

      if (message === '' || message === null || message.get('SPM') === null || message.get('OBX') === null) {
        return;
      }

      const obx = message.get('OBX').toArray();

      //obx.forEach(function (singleObx) {
      //  console.log(singleObx);
      //});

      const spm = message.get('SPM');
      let sampleNumber = 0;

      //console.log(obx[1]);
      spm.forEach(function (singleSpm) {
        sampleNumber = (singleSpm.get(1).toInteger());
        if (Number.isNaN(sampleNumber)) {
          sampleNumber = 1;
        }
        let index = (sampleNumber * 2) - 1

        // Index access error if:
        // index == 1 when sampleNumer == 1 and obx.length == 1
        // Therefore we reduce index by 1
        if (index >= obx.length) {
          index -= 1
        }

        let singleObx = obx[index]; // there are twice as many OBX .. so we take the even number - 1 OBX for each SPM

        //console.log(singleObx.get('OBX.19').toString());

        let resultOutcome = singleObx.get('OBX.5.1').toString();

        const sampleResult: any = {};
        sampleResult.raw_text = rawText;
        sampleResult.order_id = singleSpm.get('SPM.2').toString().replace("&ROCHE", "");
        sampleResult.test_id = singleSpm.get('SPM.2').toString().replace("&ROCHE", "");;

        if (sampleResult.order_id === "") {
          // const sac = message.get('SAC').toArray();
          // const singleSAC = sac[0];
          //Let us use the Sample Container ID as the Order ID
          sampleResult.order_id = message.get('SAC.3').toString();
          sampleResult.test_id = message.get('SAC.3').toString();
        }

        sampleResult.test_type = message.get('OBR.4.2')?.toString() || message.get('OBX.3.2')?.toString() || 'HIVVL';

        if (resultOutcome == 'Titer') {
          sampleResult.test_unit = singleObx.get('OBX.6.1').toString();
          sampleResult.results = singleObx.get('OBX.5.1').toString();
        } else if (resultOutcome == '<20' || resultOutcome == '< 20' || resultOutcome == 'Target Not Detected') {
          sampleResult.test_unit = '';
          sampleResult.results = 'Target Not Detected';
        } else if (resultOutcome == '> Titer max') {
          sampleResult.test_unit = '';
          sampleResult.results = '> 10000000';
        } else if (
          resultOutcome == 'Target Not Detected'
          || resultOutcome == 'Failed'
          || resultOutcome == 'Invalid'
          || resultOutcome == 'Not Detected') {
          sampleResult.test_unit = '';
          sampleResult.results = resultOutcome;
        } else {
          sampleResult.test_unit = singleObx.get('OBX.6.1').toString();
          sampleResult.results = resultOutcome;
        }

        sampleResult.tested_by = singleObx.get('OBX.16').toString();
        sampleResult.result_status = 1;
        sampleResult.lims_sync_status = 0;
        sampleResult.analysed_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        //sampleResult.specimen_date_time = that.formatRawDate(message.get('OBX').get(0).get('OBX.19').toString());
        sampleResult.authorised_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        sampleResult.result_accepted_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        sampleResult.test_location = instrumentConnectionData.labName;
        sampleResult.machine_used = instrumentConnectionData.instrumentId;

        that.saveResult(sampleResult, instrumentConnectionData);

      });
    });
  }

  processHL7DataRoche68008800(instrumentConnectionData: InstrumentConnectionStack, rawHl7Text: string) {

    const that = this;
    const message = that.hl7parser.create(rawHl7Text.trim());
    const msgID = message.get('MSH.10').toString();
    const characterSet = message.get('MSH.18').toString();
    const messageProfileIdentifier = message.get('MSH.21').toString();
    const hl7Version = message.get('MSH.12') ? message.get('MSH.12').toString() : '2.5.1'; // Default to 2.5.1 if not provided
    that.tcpService.socketClient.write(that.hl7ACK(msgID, characterSet, messageProfileIdentifier, hl7Version));

    const hl7DataArray = rawHl7Text.split('MSH|');

    hl7DataArray.forEach(function (rawText: string) {

      if (rawText.trim() === '') { return; }

      rawText = 'MSH|' + rawText.trim();
      const message = that.hl7parser.create(rawText);

      if (message === '' || message === null || message.get('SPM') === null || message.get('OBX') === null) {
        return;
      }

      const obxArray = message.get('OBX').toArray();
      const spm = message.get('SPM');

      //console.log(obx[1]);
      spm.forEach(function (singleSpm: any) {

        let resultOutcome = '';
        let singleObx = null;
        obxArray.forEach(function (obx: any) {
          if (obx.get('OBX.4').toString() === '1/2') {
            resultOutcome = obx.get('OBX.5.1').toString();
            singleObx = obx;
            if (resultOutcome === 'Titer') {
              singleObx = obx = obxArray[0];
              resultOutcome = obx.get('OBX.5.1').toString();
            }
          }
        });

        const sampleResult: any = {};
        sampleResult.raw_text = rawText;
        sampleResult.order_id = singleSpm.get('SPM.2').toString().replace("&ROCHE", "");
        sampleResult.test_id = singleSpm.get('SPM.2').toString().replace("&ROCHE", "");;

        if (sampleResult.order_id === "") {
          // const sac = message.get('SAC').toArray();
          // const singleSAC = sac[0];
          //Let us use the Sample Container ID as the Order ID
          sampleResult.order_id = message.get('SAC.3').toString();
          sampleResult.test_id = message.get('SAC.3').toString();
        }

        sampleResult.test_type = message.get('OBR.4.2')?.toString() || message.get('OBX.3.2')?.toString() || 'HIVVL';

        if (resultOutcome == 'Titer') {
          sampleResult.test_unit = singleObx.get('OBX.6.1').toString();
          sampleResult.results = singleObx.get('OBX.5.1').toString();
        } else if (resultOutcome == '> Titer max') {
          sampleResult.test_unit = '';
          sampleResult.results = '> 10000000';
        } else if (
          resultOutcome == 'Target Not Detected'
          || resultOutcome == 'Failed'
          || resultOutcome == 'Invalid'
          || resultOutcome == 'Not Detected') {
          sampleResult.test_unit = '';
          sampleResult.results = resultOutcome;
        } else {
          sampleResult.test_unit = singleObx.get('OBX.6.1').toString();
          sampleResult.results = resultOutcome;
        }

        sampleResult.tested_by = singleObx.get('OBX.16').toString();
        sampleResult.result_status = 1;
        sampleResult.lims_sync_status = 0;
        sampleResult.analysed_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        //sampleResult.specimen_date_time = that.formatRawDate(message.get('OBX').get(0).get('OBX.19').toString());
        sampleResult.authorised_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        sampleResult.result_accepted_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        sampleResult.test_location = instrumentConnectionData.labName;
        sampleResult.machine_used = instrumentConnectionData.instrumentId;

        that.saveResult(sampleResult, instrumentConnectionData);

      });
    });
  }


  private receiveASTM(astmProtocolType: string, instrumentConnectionData: InstrumentConnectionStack, data: Buffer) {
    let that = this;
    instrumentConnectionData.transmissionStatusSubject.next(true);
    //that.utilitiesService.logger('info', 'Receiving ' + astmProtocolType, instrumentConnectionData.instrumentId);
    let astmText = that.utilitiesService.hex2ascii(data.toString('hex'));

    if (astmText === that.EOT) {
      instrumentConnectionData.connectionSocket.write(that.ACK);
      that.utilitiesService.logger('info', 'Received EOT. Sending ACK.', instrumentConnectionData.instrumentId);
      that.utilitiesService.logger('info', 'Processing ' + astmProtocolType, instrumentConnectionData.instrumentId);
      that.utilitiesService.logger('info', 'Received  ' + that.strData, instrumentConnectionData.instrumentId);

      const rawData: RawMachineData = {
        data: that.strData,
        machine: instrumentConnectionData.instrumentId,
      };

      that.dbService.recordRawData(rawData, () => {
        that.utilitiesService.logger('success', 'Successfully saved raw ASTM data', instrumentConnectionData.instrumentId);
      }, (err: any) => {
        that.utilitiesService.logger('error', 'Failed to save raw data : ' + JSON.stringify(err), instrumentConnectionData.instrumentId);
      });
      let astmData = that.strData;
      switch (astmProtocolType) {
        case 'astm-nonchecksum':
          astmData = that.utilitiesService.removeControlCharacters(astmData, false);
          break;
        case 'astm-checksum':
          astmData = that.utilitiesService.removeControlCharacters(astmData, true);
          break;
        default:
          astmData = that.utilitiesService.removeControlCharacters(astmData, true);
          break;
      }

      astmData = that.reconstructASTM(astmData);
      const fullDataArray = astmData.split(that.START);

      //that.utilitiesService.logger('info', "AFTER SPLITTING USING " + that.START, instrumentConnectionData.instrumentId);
      // that.utilitiesService.logger('info', fullDataArray, instrumentConnectionData.instrumentId);
      console.error('-------------------');
      console.error('-------------------');
      console.error(fullDataArray);
      console.error(fullDataArray.length);
      console.error('-------------------');
      console.error('-------------------');

      fullDataArray.forEach(function (partData) {
        // console.error(partData);
        if (partData !== '' && partData !== undefined && partData !== null) {

          const astmArray = partData.split(/<CR>/);
          const dataArray = that.getASTMDataBlock(astmArray);

          console.error(partData);
          console.error(dataArray);
          console.error(dataArray['R']);

          //that.utilitiesService.logger('info', dataArray, instrumentConnectionData.instrumentId);
          //that.utilitiesService.logger('info',dataArray['R'][0], instrumentConnectionData.instrumentId);

          if (dataArray === null || dataArray === undefined) {
            that.utilitiesService.logger('info', 'No ASTM data received.', instrumentConnectionData.instrumentId);
            return;
          }

          that.saveASTMDataBlock(dataArray, partData, instrumentConnectionData);

        }
      });

      that.strData = '';
      instrumentConnectionData.transmissionStatusSubject.next(false);
    } else if (astmText === that.NAK) {
      instrumentConnectionData.connectionSocket.write(that.ACK);
      that.utilitiesService.logger('error', 'NAK Received', instrumentConnectionData.instrumentId);
      that.utilitiesService.logger('info', 'Sending ACK', instrumentConnectionData.instrumentId);
    } else {
      const regexToCheckIfHeader = /^\d*H/;
      if (regexToCheckIfHeader.test(astmText.replace(/[\x05\x02\x03]/g, ''))) {
        astmText = that.START + astmText;
      }
      that.strData += astmText;
      that.utilitiesService.logger('info', astmProtocolType.toUpperCase() + ' | Receiving....' + astmText, instrumentConnectionData.instrumentId);
      instrumentConnectionData.connectionSocket.write(that.ACK);
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
      };

      that.dbService.recordRawData(rawData, () => {
        that.utilitiesService.logger('success', 'Successfully saved raw HL7 data', instrumentConnectionData.instrumentId);
      }, (err: any) => {
        that.utilitiesService.logger('error', 'Failed to save raw data ' + JSON.stringify(err), instrumentConnectionData.instrumentId);
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
    if (instrumentConnectionData.connectionProtocol === 'hl7') {
      that.receiveHL7(instrumentConnectionData, data);
    } else if (instrumentConnectionData.connectionProtocol === 'astm-nonchecksum') {
      that.receiveASTM('astm-nonchecksum', instrumentConnectionData, data);
    } else if (instrumentConnectionData.connectionProtocol === 'astm-checksum') {
      that.receiveASTM('astm-checksum', instrumentConnectionData, data);
    }
  }

  // private reconstructASTM(data: string): string {

  //   // Split the data at the valid record starts, marked by R|, O|, P|, Q|, L|, C|
  //   const splitData = data.split(/<CR>(?=H\|)|<CR>(?=R\|)|<CR>(?=O\|)|<CR>(?=P\|)|<CR>(?=Q\|)|<CR>(?=L\|)|<CR>(?=C\|)/);

  //   // Remove all <CR> markers from the data (if any are left within the split parts)
  //   const cleanedSplitData = splitData.map(part => part.replace(/<CR>/g, ''));
  //   // Rejoin the split data with <CR> at the end of each segment
  //   let reconstructedData = cleanedSplitData.join('<CR>') + '<CR>';  // Ensure <CR> at the end of the final part

  //   return reconstructedData;
  // }

  private reconstructASTM(data: string): string {
    // Split the data at the valid record starts, marked by H|, P|, O|, R|, L|, C|, Q|, M|, S|, I|
    const splitData = data.split(/<CR>(?=[HPORLCQMSI]\|)/);

    // Remove all <CR> markers from the data (if any are left within the split parts)
    const cleanedSplitData = splitData.map(part => part.replace(/<CR>/g, ''));

    // Join broken lines within each segment
    let reconstructedASTMData = this.joinBrokenLines(cleanedSplitData);

    // Rejoin the split data with <CR> at the end of each segment
    return reconstructedASTMData.join('<CR>') + '<CR>';  // Ensure <CR> at the end of the final part
  }

  private joinBrokenLines(segments: string[]): string[] {
    const joinedSegments: string[] = [];
    let currentSegment = '';

    segments.forEach(segment => {
      // Check if the segment starts with a record type character (H, P, O, R, L, C, Q, M, S, I)
      if (/^(H\||P\||O\||R\||L\||C\||Q\||M\||S\||I\|)/.test(segment) && currentSegment) {
        joinedSegments.push(currentSegment);
        currentSegment = segment;
      } else {
        currentSegment += segment;
      }
    });

    if (currentSegment) {
      joinedSegments.push(currentSegment);
    }

    return joinedSegments;
  }


  private saveResult(sampleResult: any, instrumentConnectionData: InstrumentConnectionStack) {
    const that = this;
    if (sampleResult) {
      const data = { ...sampleResult, instrument_id: instrumentConnectionData.instrumentId }; // Add instrument_id here
      that.dbService.recordTestResults(data,
        (res) => {
          that.utilitiesService.logger('success', 'Successfully saved result : ' + sampleResult.test_id + '|' + sampleResult.order_id, instrumentConnectionData.instrumentId);
          return true;
        },
        (err) => {
          that.utilitiesService.logger('error', 'Failed to save result : ' + sampleResult.test_id + '|' + sampleResult.order_id + ' | ' + JSON.stringify(err), instrumentConnectionData.instrumentId);
          return false;
        });
    } else {
      that.utilitiesService.logger('error', 'Failed to save result into the database : ' + JSON.stringify(sampleResult), instrumentConnectionData.instrumentId);
      return false;
    }
  }


  private getASTMDataBlock(astmArray: any[]) {
    let dataArray = {};

    astmArray.forEach(function (element) {
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
    });

    return dataArray;
  }


  private saveASTMDataBlock(dataArray: {}, partData: string, instrumentConnectionData: InstrumentConnectionStack) {
    const that = this;
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
          sampleResult.analysed_date_time = that.utilitiesService.formatRawDate(rSegmentFields[12]);
          sampleResult.authorised_date_time = that.utilitiesService.formatRawDate(rSegmentFields[12]);
          sampleResult.result_accepted_date_time = that.utilitiesService.formatRawDate(rSegmentFields[12]);
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
        sampleResult.test_location = instrumentConnectionData.labName;
        sampleResult.machine_used = instrumentConnectionData.instrumentId;

        return that.saveResult(sampleResult, instrumentConnectionData);
      }else{
        that.utilitiesService.logger('error', 'No result data found in ASTM data block', instrumentConnectionData.instrumentId);
        return false;
      }
    }

    catch (error) {
      that.utilitiesService.logger('error', error, instrumentConnectionData.instrumentId);
      console.error(error);
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
          const astmMessage = that.generateASTMMessageForOrder(order);

          // Frame the ASTM message with control characters
          const framedMessage = that.frameASTMMessage(astmMessage, instrument.connectionParams.instrumentId);

          // Send the framed message over TCP
          // Assuming tcpService has a method like sendData that takes host, port, and the message
          that.tcpService.sendData(instrument.connectionParams, framedMessage);
        });
      },
      (err: any) => {
        console.error("Error fetching orders to send:", err);
      }
    );
  }


  // Method to generate ASTM message for an order
  private generateASTMMessageForOrder(sampleResult: any): string {
    // Assuming order fields map directly to ASTM message fields
    // This will vary based on your specific ASTM message format requirements
    let message = `H|\\^&|||${sampleResult.test_location}|||||||P|1\r`;
    message += `P|1||||${sampleResult.order_id}|||||||||||||||||||||||\r`;
    message += `O|1|${sampleResult.test_id}|${sampleResult.test_id}||${sampleResult.test_type}||||||||||||||O\r`;
    message += `L|1|N\r`;

    return message;
  }

  // Method to frame ASTM message with control characters and checksum
  private frameASTMMessage(message: string, instrumentId: string): string {
    let that = this;
    const sequenceNumber = that.getAndUpdateSequenceNumber(instrumentId);
    const header = that.STX + sequenceNumber;
    const footer = that.ETX;
    const checksum = that.calculateChecksum(header + message + footer);
    return header + message + footer + checksum + that.CR + that.LF + that.EOT;
  }

  // Method to calculate the checksum of an ASTM message
  private calculateChecksum(message: string): string {
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

    // console.log("ADJUSTED MESSAGE: " + adjustedMessage);
    // console.log("CHECKSUM: " + hexChecksum);

    return hexChecksum;
  }



  private getAndUpdateSequenceNumber(instrumentId: string): string {
    let that = this;
    // Ensure the instrumentId is tracked
    if (!that.astmSequenceNumbers.has(instrumentId)) {
      that.astmSequenceNumbers.set(instrumentId, 1);
    } else {
      let currentSequence = that.astmSequenceNumbers.get(instrumentId)!;
      //currentSequence = (currentSequence % 7) + 1; // Cycle from 1 to 7
      that.astmSequenceNumbers.set(instrumentId, currentSequence + 1);
    }
    return that.astmSequenceNumbers.get(instrumentId)!.toString(); // No padding needed
  }

  resetSequenceNumber(instrumentId: string) {
    let that = this;
    // Reset the sequence number to 1 (or 0, depending on protocol specifics)
    console.error("Resetting sequence number for " + instrumentId);
    that.astmSequenceNumbers.set(instrumentId, 100);
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
          const hl7Message = that.generateHL7MessageForOrder(order);

          // Frame the HL7 message with necessary control characters
          const framedMessage = that.frameHL7Message(hl7Message);

          // Send the framed message over TCP
          that.tcpService.sendData(instrument.connectionParams, framedMessage);
        });
      },
      (err: any) => {
        console.error('Error fetching orders to send:', err);
      }
    );
  }

  // Method to generate HL7 message for an order
  private generateHL7MessageForOrder(sampleResult: any): string {
    const moment = require('moment');
    const date = moment(new Date()).format('YYYYMMDDHHmmss');

    let message = 'MSH|^~\\&|LIS|LISFacility|Roche|x800|' + date + '||ORM^O01|' + randomUUID() + '|P|2.3\r';
    message += 'PID|||123456^^^LIS||Doe^John\r';
    message += 'ORC|NW|' + sampleResult.order_id + '|||' + date + '\r';
    message += 'OBR|1||' + sampleResult.order_id + '^LIS|' + sampleResult.test_id + '^' + sampleResult.test_type + '^L\r';

    return message;
  }

  // Method to frame HL7 message with control characters
  private frameHL7Message(message: string): string {
    return '\x0B' + message + '\x1C' + '\x0D'; // \x0B is the start block, \x1C is the end block, and \x0D is carriage return
  }

}
