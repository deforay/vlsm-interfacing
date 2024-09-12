import { Injectable } from '@angular/core';
import { DatabaseService } from './database.service';
import { InstrumentConnectionStack } from '../interfaces/intrument-connections.interface';
import { RawMachineData } from '../interfaces/raw-machine-data.interface';
import { UtilitiesService } from './utilities.service';
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


  hl7ACK(messageID, characterSet, messageProfileIdentifier) {

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
      + self.crypto.randomUUID() + '|P|2.5.1|||||'
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


  processHL7DataAlinity(instrumentConnectionData, rawHl7Text: string) {

    const that = this;
    const message = that.hl7parser.create(rawHl7Text.trim());
    const msgID = message.get('MSH.10').toString();
    const characterSet = message.get('MSH.18').toString();
    const messageProfileIdentifier = message.get('MSH.21').toString();
    that.tcpService.socketClient.write(that.hl7ACK(msgID, characterSet, messageProfileIdentifier));
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

        const order: any = {};
        order.raw_text = rawText;
        order.order_id = singleSpm.get('SPM.3').toString().replace('&ROCHE', '');
        order.test_id = singleSpm.get('SPM.3').toString().replace('&ROCHE', '');

        if (order.order_id === "") {
          // const sac = message.get('SAC').toArray();
          // const singleSAC = sac[0];
          //Let us use the Sample Container ID as the Order ID
          order.order_id = message.get('SAC.3').toString();
          order.test_id = message.get('SAC.3').toString();
        }

        order.test_type = message.get('OBR.4.2')?.toString() || message.get('OBX.3.2')?.toString() || 'HIVVL';

        if (resultOutcome === 'Titer') {
          order.test_unit = singleObx.get('OBX.6.1').toString();
          order.results = singleObx.get('OBX.5.1').toString();
        } else if (resultOutcome === '> Titer max') {
          order.test_unit = '';
          order.results = '> 10000000';
        } else if (resultOutcome === 'Invalid') {
          order.test_unit = '';
          order.results = 'Invalid';
        } else if (resultOutcome === 'Failed') {
          order.test_unit = '';
          order.results = 'Failed';
        } else {
          order.test_unit = singleObx.get('OBX.6.1').toString();
          if (!order.test_unit) {
            order.test_unit = singleObx.get('OBX.6.2').toString();
          }
          if (!order.test_unit) {
            order.test_unit = singleObx.get('OBX.6').toString();
          }
          order.results = resultOutcome;
        }

        order.tested_by = singleObx.get('OBX.16').toString();
        order.result_status = 1;
        order.lims_sync_status = 0;
        order.analysed_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        //order.specimen_date_time = that.formatRawDate(message.get('OBX').get(0).get('OBX.19').toString());
        order.authorised_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        order.result_accepted_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        order.test_location = instrumentConnectionData.labName;
        order.machine_used = instrumentConnectionData.analyzerMachineName;

        that.saveOrder(order, instrumentConnectionData);

      });
    });
  }
  processHL7Data(instrumentConnectionData: InstrumentConnectionStack, rawHl7Text: string) {

    const that = this;
    const message = that.hl7parser.create(rawHl7Text.trim());
    const msgID = message.get('MSH.10').toString();
    const characterSet = message.get('MSH.18').toString();
    const messageProfileIdentifier = message.get('MSH.21').toString();
    that.tcpService.socketClient.write(that.hl7ACK(msgID, characterSet, messageProfileIdentifier));
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
      let sampleNumber = 0;

      //console.log(obx[1]);
      spm.forEach(function (singleSpm) {
        sampleNumber = (singleSpm.get(1).toInteger());
        if (isNaN(sampleNumber)) {
          sampleNumber = 1;
        }
        let singleObx = obx[(sampleNumber * 2) - 1]; // there are twice as many OBX .. so we take the even number - 1 OBX for each SPM

        //console.log(singleObx.get('OBX.19').toString());

        let resultOutcome = singleObx.get('OBX.5.1').toString();

        const order: any = {};
        order.raw_text = rawText;
        order.order_id = singleSpm.get('SPM.2').toString().replace("&ROCHE", "");
        order.test_id = singleSpm.get('SPM.2').toString().replace("&ROCHE", "");;

        if (order.order_id === "") {
          // const sac = message.get('SAC').toArray();
          // const singleSAC = sac[0];
          //Let us use the Sample Container ID as the Order ID
          order.order_id = message.get('SAC.3').toString();
          order.test_id = message.get('SAC.3').toString();
        }

        order.test_type = message.get('OBR.4.2')?.toString() || message.get('OBX.3.2')?.toString() || 'HIVVL';

        if (resultOutcome == 'Titer') {
          order.test_unit = singleObx.get('OBX.6.1').toString();
          order.results = singleObx.get('OBX.5.1').toString();
        } else if (resultOutcome == '<20' || resultOutcome == '< 20') {
          order.test_unit = '';
          order.results = 'Target Not Detected';
        } else if (resultOutcome == '> Titer max') {
          order.test_unit = '';
          order.results = '> 10000000';
        } else if (resultOutcome == 'Target Not Detected') {
          order.test_unit = '';
          order.results = 'Target Not Detected';
        } else if (resultOutcome == 'Invalid') {
          order.test_unit = '';
          order.results = 'Invalid';
        } else if (resultOutcome == 'Failed') {
          order.test_unit = '';
          order.results = 'Failed';
        } else {
          order.test_unit = singleObx.get('OBX.6.1').toString();
          order.results = resultOutcome;
        }

        order.tested_by = singleObx.get('OBX.16').toString();
        order.result_status = 1;
        order.lims_sync_status = 0;
        order.analysed_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        //order.specimen_date_time = that.formatRawDate(message.get('OBX').get(0).get('OBX.19').toString());
        order.authorised_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        order.result_accepted_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        order.test_location = instrumentConnectionData.labName;
        order.machine_used = instrumentConnectionData.instrumentId;

        that.saveOrder(order, instrumentConnectionData);

      });
    });
  }

  processHL7DataRoche5800(instrumentConnectionData: InstrumentConnectionStack, rawHl7Text: string) {

    const that = this;
    const message = that.hl7parser.create(rawHl7Text.trim());
    const msgID = message.get('MSH.10').toString();
    const characterSet = message.get('MSH.18').toString();
    const messageProfileIdentifier = message.get('MSH.21').toString();
    that.tcpService.socketClient.write(that.hl7ACK(msgID, characterSet, messageProfileIdentifier));

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
        if (isNaN(sampleNumber)) {
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

        const order: any = {};
        order.raw_text = rawText;
        order.order_id = singleSpm.get('SPM.2').toString().replace("&ROCHE", "");
        order.test_id = singleSpm.get('SPM.2').toString().replace("&ROCHE", "");;

        if (order.order_id === "") {
          // const sac = message.get('SAC').toArray();
          // const singleSAC = sac[0];
          //Let us use the Sample Container ID as the Order ID
          order.order_id = message.get('SAC.3').toString();
          order.test_id = message.get('SAC.3').toString();
        }

        order.test_type = message.get('OBR.4.2')?.toString() || message.get('OBX.3.2')?.toString() || 'HIVVL';

        if (resultOutcome == 'Titer') {
          order.test_unit = singleObx.get('OBX.6.1').toString();
          order.results = singleObx.get('OBX.5.1').toString();
        } else if (resultOutcome == '<20' || resultOutcome == '< 20') {
          order.test_unit = '';
          order.results = 'Target Not Detected';
        } else if (resultOutcome == '> Titer max') {
          order.test_unit = '';
          order.results = '> 10000000';
        } else if (resultOutcome == 'Target Not Detected') {
          order.test_unit = '';
          order.results = 'Target Not Detected';
        } else if (resultOutcome == 'Invalid') {
          order.test_unit = '';
          order.results = 'Invalid';
        } else if (resultOutcome == 'Failed') {
          order.test_unit = '';
          order.results = 'Failed';
        } else {
          order.test_unit = singleObx.get('OBX.6.1').toString();
          order.results = resultOutcome;
        }

        order.tested_by = singleObx.get('OBX.16').toString();
        order.result_status = 1;
        order.lims_sync_status = 0;
        order.analysed_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        //order.specimen_date_time = that.formatRawDate(message.get('OBX').get(0).get('OBX.19').toString());
        order.authorised_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        order.result_accepted_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        order.test_location = instrumentConnectionData.labName;
        order.machine_used = instrumentConnectionData.instrumentId;

        that.saveOrder(order, instrumentConnectionData);

      });
    });
  }

  processHL7DataRoche68008800(instrumentConnectionData: InstrumentConnectionStack, rawHl7Text: string) {

    const that = this;
    const message = that.hl7parser.create(rawHl7Text.trim());
    const msgID = message.get('MSH.10').toString();
    const characterSet = message.get('MSH.18').toString();
    const messageProfileIdentifier = message.get('MSH.21').toString();
    that.tcpService.socketClient.write(that.hl7ACK(msgID, characterSet, messageProfileIdentifier));

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

        const order: any = {};
        order.raw_text = rawText;
        order.order_id = singleSpm.get('SPM.2').toString().replace("&ROCHE", "");
        order.test_id = singleSpm.get('SPM.2').toString().replace("&ROCHE", "");;

        if (order.order_id === "") {
          // const sac = message.get('SAC').toArray();
          // const singleSAC = sac[0];
          //Let us use the Sample Container ID as the Order ID
          order.order_id = message.get('SAC.3').toString();
          order.test_id = message.get('SAC.3').toString();
        }

        order.test_type = message.get('OBR.4.2')?.toString() || message.get('OBX.3.2')?.toString() || 'HIVVL';

        if (resultOutcome == 'Titer') {
          order.test_unit = singleObx.get('OBX.6.1').toString();
          order.results = singleObx.get('OBX.5.1').toString();
        } else if (resultOutcome == '<20' || resultOutcome == '< 20') {
          order.test_unit = '';
          order.results = 'Target Not Detected';
        } else if (resultOutcome == '> Titer max') {
          order.test_unit = '';
          order.results = '> 10000000';
        } else if (resultOutcome == 'Target Not Detected') {
          order.test_unit = '';
          order.results = 'Target Not Detected';
        } else if (resultOutcome == 'Invalid') {
          order.test_unit = '';
          order.results = 'Invalid';
        } else if (resultOutcome == 'Failed') {
          order.test_unit = '';
          order.results = 'Failed';
        } else {
          order.test_unit = singleObx.get('OBX.6.1').toString();
          order.results = resultOutcome;
        }

        order.tested_by = singleObx.get('OBX.16').toString();
        order.result_status = 1;
        order.lims_sync_status = 0;
        order.analysed_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        //order.specimen_date_time = that.formatRawDate(message.get('OBX').get(0).get('OBX.19').toString());
        order.authorised_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        order.result_accepted_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        order.test_location = instrumentConnectionData.labName;
        order.machine_used = instrumentConnectionData.instrumentId;

        that.saveOrder(order, instrumentConnectionData);

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
      that.utilitiesService.logger('info', 'Data ' + that.strData, instrumentConnectionData.instrumentId);

      const rawData: RawMachineData = {
        data: that.strData,
        machine: instrumentConnectionData.instrumentId,
      };

      that.dbService.addRawData(rawData, () => {
        that.utilitiesService.logger('success', 'Successfully saved raw astm data', instrumentConnectionData.instrumentId);
      }, (err: any) => {
        that.utilitiesService.logger('error', 'Failed to save raw data : ' + JSON.stringify(err), instrumentConnectionData.instrumentId);
      });
      let astmData = that.strData;
      switch (astmProtocolType) {
        case 'astm-nonchecksum':
          astmData = that.utilitiesService.replaceControlCharacters(astmData, false);
          break;
        case 'astm-checksum':
          astmData = that.utilitiesService.replaceControlCharacters(astmData, true);
          break;
        default:
          astmData = that.utilitiesService.replaceControlCharacters(astmData, true);
          break;
      }

      astmData = that.cleanAndReconstructASTMData(astmData);
      const fullDataArray = astmData.split(that.START);

      // that.utilitiesService.logger('info', "AFTER SPLITTING USING " + that.START, instrumentConnectionData.instrumentId);
      // that.utilitiesService.logger('info', fullDataArray, instrumentConnectionData.instrumentId);

      fullDataArray.forEach(function (partData) {

        if (partData !== '' && partData !== undefined && partData !== null) {

          const astmArray = partData.split(/<CR>/);
          const dataArray = that.getASTMDataBlock(astmArray);

          console.error(dataArray);
          console.error(dataArray['R']);

          //that.utilitiesService.logger('info', dataArray, instrumentConnectionData.instrumentId);
          //that.utilitiesService.logger('info',dataArray['R'][0], instrumentConnectionData.instrumentId);

          if (dataArray === null || dataArray === undefined) {
            that.utilitiesService.logger('info', 'No ASTM data received.', instrumentConnectionData.instrumentId);
            return;
          }

          that.saveASTMDataBlock(dataArray, partData, instrumentConnectionData);

        } else {
          that.utilitiesService.logger('error', "Failed to save :" + JSON.stringify(astmData), instrumentConnectionData.instrumentId);
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

      that.dbService.addRawData(rawData, () => {
        that.utilitiesService.logger('success', 'Successfully saved raw hl7 data', instrumentConnectionData.instrumentId);
      }, (err: any) => {
        that.utilitiesService.logger('error', 'Failed to save raw data ' + JSON.stringify(err), instrumentConnectionData.instrumentId);
      });

      that.strData = that.strData.replace(/[\x0b\x1c]/g, '');
      that.strData = that.strData.trim();
      that.strData = that.strData.replace(/[\r\n\x0B\x0C\u0085\u2028\u2029]+/gm, '\r');

      if (instrumentConnectionData.machineType !== undefined
        && instrumentConnectionData.machineType !== null
        && instrumentConnectionData.machineType !== ""
        && instrumentConnectionData.machineType === 'abbott-alinity-m') {
        that.processHL7DataAlinity(instrumentConnectionData, that.strData);
      }
      else if (instrumentConnectionData.machineType !== undefined
        && instrumentConnectionData.machineType !== null
        && instrumentConnectionData.machineType !== ""
        && instrumentConnectionData.machineType === 'roche-cobas-5800') {
        that.processHL7DataRoche5800(instrumentConnectionData, that.strData);
      }
      else if (instrumentConnectionData.machineType !== undefined
        && instrumentConnectionData.machineType !== null
        && instrumentConnectionData.machineType !== ""
        && instrumentConnectionData.machineType === 'roche-cobas-6800') {
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

  private cleanAndReconstructASTMData(data: string): string {

    // Split the data at the valid record starts, marked by R|, O|, P|, Q|, L|, C|
    const splitData = data.split(/<CR>(?=H\|)|<CR>(?=R\|)|<CR>(?=O\|)|<CR>(?=P\|)|<CR>(?=Q\|)|<CR>(?=L\|)|<CR>(?=C\|)/);

    // Remove all <CR> markers from the data (if any are left within the split parts)
    const cleanedSplitData = splitData.map(part => part.replace(/<CR>/g, ''));

    // Rejoin the split data with <CR> at the end of each segment
    let reconstructedData = cleanedSplitData.join('<CR>') + '<CR>';  // Ensure <CR> at the end of the final part

    return reconstructedData;
  }




  // private saveOrder(order: any, instrumentConnectionData: InstrumentConnectionStack) {
  //   const that = this;
  //   if (order.results) {
  //     that.dbService.recordTestResults(order, (res) => {
  //       that.utilitiesService.logger('success', 'Successfully saved result : ' + order.test_id + '|' + order.order_id, instrumentConnectionData.instrumentId);
  //       return true;
  //     }, (err) => {
  //       that.utilitiesService.logger('error', 'Failed to save result : ' + order.test_id + '|' + order.order_id + ' | ' + JSON.stringify(err), instrumentConnectionData.instrumentId);
  //       return false;
  //     });
  //   } else {
  //     that.utilitiesService.logger('error', 'Failed to store data into the database', instrumentConnectionData.instrumentId);
  //     return false;
  //   }
  // }

  private saveOrder(order: any, instrumentConnectionData: InstrumentConnectionStack) {
    const that = this;
    if (order.results) {
      const data = { ...order, instrument_id: instrumentConnectionData.instrumentId }; // Add instrument_id here
      that.dbService.recordTestResults(data,
        (res) => {
          that.utilitiesService.logger('success', 'Successfully saved result : ' + order.test_id + '|' + order.order_id, instrumentConnectionData.instrumentId);
          return true;
        },
        (err) => {
          that.utilitiesService.logger('error', 'Failed to save result : ' + order.test_id + '|' + order.order_id + ' | ' + JSON.stringify(err), instrumentConnectionData.instrumentId);
          return false;
        });
    } else {
      that.utilitiesService.logger('error', 'Failed to store data into the database', instrumentConnectionData.instrumentId);
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
    const order: any = {};
    try {
      if (dataArray['O'] && dataArray['O'].length > 0) {

        const oSegmentFields = dataArray['O'][0]; // dataArray['O'] is an array of arrays (each sub-array is a segment's fields)

        order.order_id = oSegmentFields[2];
        order.test_id = oSegmentFields[1];

        const resultStatus = oSegmentFields[25]; // X = Failed, F = Final, P = Preliminary

        const universalTestIdentifier = oSegmentFields[4];
        const testTypeDetails = universalTestIdentifier.split('^');
        const testType = testTypeDetails.length > 1 ? testTypeDetails[3] : ''; // Adjust based on your ASTM format

        order.test_type = testType;

        if (dataArray['R'] && dataArray['R'].length > 0) {

          const rSegmentFields = dataArray['R'][0];

          if (!order.test_type) {
            order.test_type = (rSegmentFields[2]) ? rSegmentFields[2].replace('^^^', '') : rSegmentFields[2];
          }
          order.test_unit = rSegmentFields[4];

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

          order.results = finalResult;
          order.tested_by = rSegmentFields[10];
          order.analysed_date_time = that.utilitiesService.formatRawDate(rSegmentFields[12]);
          order.authorised_date_time = that.utilitiesService.formatRawDate(rSegmentFields[12]);
          order.result_accepted_date_time = that.utilitiesService.formatRawDate(rSegmentFields[12]);
        } else {
          order.test_type = testType;
          order.test_unit = null;
          order.results = 'Failed';
          order.tested_by = null;
          order.analysed_date_time = null;
          order.authorised_date_time = null;
          order.result_accepted_date_time = null;
        }
        order.raw_text = partData;
        order.result_status = 1;
        order.lims_sync_status = 0;
        order.test_location = instrumentConnectionData.labName;
        order.machine_used = instrumentConnectionData.instrumentId;

        return that.saveOrder(order, instrumentConnectionData);
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
  private generateASTMMessageForOrder(order: any): string {
    // Assuming order fields map directly to ASTM message fields
    // This will vary based on your specific ASTM message format requirements
    let message = `H|\\^&|||${order.test_location}|||||||P|1\r`;
    message += `P|1||||${order.order_id}|||||||||||||||||||||||\r`;
    message += `O|1|${order.test_id}|${order.test_id}||${order.test_type}||||||||||||||O\r`;
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

}
