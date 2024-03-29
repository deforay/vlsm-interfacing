import { Injectable } from '@angular/core';
import { DatabaseService } from './database.service';
import { ConnectionParams } from '../interfaces/connection-params.interface';
import { InstrumentConnectionStack } from '../interfaces/intrument-connections.interface';
import { RawMachineData } from '../interfaces/raw-machine-data.interface';
import { UtilitiesService } from './utilities.service';
import { TcpConnectionService } from './tcp-connection.service';

@Injectable({
  providedIn: 'root'
})

export class InstrumentInterfaceService {

  public hl7parser = require('hl7parser');

  protected ACK = Buffer.from('06', 'hex');
  protected EOT = '04';
  protected NAK = '21';

  protected strData = '';

  constructor(public dbService: DatabaseService,
    public tcpService: TcpConnectionService,
    public utilitiesService: UtilitiesService) {
  }

  // Method used to connect to the Testing Machine
  connect(instrument: any) {
    const that = this;
    if (instrument && instrument.connectionParams) {
      // Bind 'this' explicitly to handleTCPResponse
      const boundHandleTCPResponse = this.handleTCPResponse.bind(this);
      that.tcpService.connect(instrument.connectionParams, boundHandleTCPResponse);
    }
  }

  reconnect(instrument: any) {
    const that = this;
    if (instrument && instrument.connectionParams) {
      // Bind 'this' explicitly to handleTCPResponse
      const boundHandleTCPResponse = this.handleTCPResponse.bind(this);
      that.tcpService.reconnect(instrument.connectionParams, boundHandleTCPResponse);
    }
  }

  disconnect(instrument: any) {
    const that = this;
    if (instrument && instrument.connectionParams && instrument.connectionParams.host && instrument.connectionParams.port) {
      that.tcpService.disconnect(instrument.connectionParams.host, instrument.connectionParams.port);
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
        //order.specimen_date_time = this.formatRawDate(message.get('OBX').get(0).get('OBX.19').toString());
        order.authorised_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        order.result_accepted_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        order.test_location = instrumentConnectionData.labName;
        order.machine_used = instrumentConnectionData.analyzerMachineName;

        that.saveOrder(order, instrumentConnectionData);

      });
    });
  }
  processHL7Data(instrumentConnectionData, rawHl7Text: string) {

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
        //order.specimen_date_time = this.formatRawDate(message.get('OBX').get(0).get('OBX.19').toString());
        order.authorised_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        order.result_accepted_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        order.test_location = instrumentConnectionData.labName;
        order.machine_used = instrumentConnectionData.analyzerMachineName;

        that.saveOrder(order, instrumentConnectionData);

      });
    });
  }

  processHL7DataRoche5800(instrumentConnectionData, rawHl7Text: string) {

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
        if(index >= obx.length) {
          index-=1
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
        //order.specimen_date_time = this.formatRawDate(message.get('OBX').get(0).get('OBX.19').toString());
        order.authorised_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        order.result_accepted_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        order.test_location = instrumentConnectionData.labName;
        order.machine_used = instrumentConnectionData.analyzerMachineName;

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
        //order.specimen_date_time = this.formatRawDate(message.get('OBX').get(0).get('OBX.19').toString());
        order.authorised_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        order.result_accepted_date_time = that.utilitiesService.formatRawDate(singleObx.get('OBX.19').toString());
        order.test_location = instrumentConnectionData.labName;
        order.machine_used = instrumentConnectionData.instrumentId;

        that.saveOrder(order, instrumentConnectionData);

      });



      // order.order_id = r.sampleID;
      // order.test_id = r.sampleID;
      // order.test_type = r.testName;
      // order.test_unit = r.unit;
      // //order.createdDate = '';
      // order.results = r.result;
      // order.tested_by = r.operator;
      // order.result_status = 1;
      // order.analysed_date_time = r.timestamp;
      // order.specimen_date_time = r.specimenDate;
      // order.authorised_date_time = r.timestamp;
      // order.result_accepted_date_time = r.timestamp;
      // order.test_location = this.labName;
      // order.machine_used = this.analyzerMachineName;
    });
  }

  private receiveASTM(astmProtocolType: string, instrumentConnectionData: InstrumentConnectionStack, data: Buffer) {
    let that = this;
    that.utilitiesService.logger('info', 'Receiving ' + astmProtocolType, instrumentConnectionData.instrumentId);

    const hexData = data.toString('hex');

    if (hexData === that.EOT) {
      instrumentConnectionData.connectionSocket.write(that.ACK);
      that.utilitiesService.logger('info', 'Received EOT. Sending ACK.', instrumentConnectionData.instrumentId);
      that.utilitiesService.logger('info', 'Processing ' + astmProtocolType, instrumentConnectionData.instrumentId);
      that.utilitiesService.logger('info', 'Data ' + that.strData, instrumentConnectionData.instrumentId);

      const rawData: RawMachineData = {
        data: that.strData,
        machine: instrumentConnectionData.instrumentId,
      };

      that.dbService.addRawData(rawData, (res) => {
        that.utilitiesService.logger('success', 'Successfully saved raw astm data', instrumentConnectionData.instrumentId);
      }, (err) => {
        that.utilitiesService.logger('error', 'Failed to save raw data : ' + JSON.stringify(err), instrumentConnectionData.instrumentId);
      });

      switch (astmProtocolType) {
        case 'astm-elecsys':
          that.processASTMElecsysData(instrumentConnectionData, that.strData);
          break;
        case 'astm-concatenated':
          that.processASTMConcatenatedData(instrumentConnectionData, that.strData);
          break;
        default:
          // Handle unexpected protocol
          break;
      }
      that.strData = "";
    } else if (hexData === that.NAK) {
      instrumentConnectionData.connectionSocket.write(that.ACK);
      that.utilitiesService.logger('error', 'NAK Received', instrumentConnectionData.instrumentId);
      that.utilitiesService.logger('info', 'Sending ACK', instrumentConnectionData.instrumentId);
    } else {
      let text = that.utilitiesService.hex2ascii(hexData);
      const regex = /^\d*H/;
      if (regex.test(text.replace(/[\x05\x02\x03]/g, ''))) {
        text = '##START##' + text;
      }
      that.strData += text;
      that.utilitiesService.logger('info', 'Receiving....' + text, instrumentConnectionData.instrumentId);
      instrumentConnectionData.connectionSocket.write(that.ACK);
      that.utilitiesService.logger('info', 'Sending ACK', instrumentConnectionData.instrumentId);
    }
  }

  private receiveHL7(instrumentConnectionData: InstrumentConnectionStack, data: Buffer) {
    let that = this;
    that.utilitiesService.logger('info', 'Receiving HL7 data', instrumentConnectionData.instrumentId);
    const hl7Text = that.utilitiesService.hex2ascii(data.toString('hex'));
    that.strData += hl7Text;

    that.utilitiesService.logger('info', hl7Text, instrumentConnectionData.instrumentId);

    // If there is a File Separator or 1C or ASCII 28 character,
    // it means the stream has ended and we can proceed with saving this data
    if (that.strData.includes('\x1c')) {
      // Let us store this Raw Data before we process it

      that.utilitiesService.logger('info', 'Received File Separator Character. Ready to process HL7 data', instrumentConnectionData.instrumentId);

      const rawData: RawMachineData = {
        data: that.strData,
        machine: instrumentConnectionData.instrumentId,
      };

      that.dbService.addRawData(rawData, (res) => {
        that.utilitiesService.logger('success', 'Successfully saved raw hl7 data', instrumentConnectionData.instrumentId);
      }, (err) => {
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
    }
  }


  handleTCPResponse(connectionIdentifierKey: string, data: Buffer) {
    const that = this;
    const instrumentConnectionData = that.tcpService.connectionStack.get(connectionIdentifierKey);
    if (instrumentConnectionData.connectionProtocol === 'hl7') {
      that.receiveHL7(instrumentConnectionData, data);
    } else if (instrumentConnectionData.connectionProtocol === 'astm-elecsys') {
      that.receiveASTM('astm-elecsys', instrumentConnectionData, data);
    } else if (instrumentConnectionData.connectionProtocol === 'astm-concatenated') {
      that.receiveASTM('astm-concatenated', instrumentConnectionData, data);
    }
  }


  processASTMElecsysData(instrumentConnectionData: InstrumentConnectionStack, astmData: string) {

    //that.utilitiesService.logger('info', astmData, instrumentConnectionData.instrumentId);

    const that = this;
    const fullDataArray = astmData.split('##START##');

    // that.utilitiesService.logger('info', "AFTER SPLITTING USING ##START##", instrumentConnectionData.instrumentId);
    // that.utilitiesService.logger('info', fullDataArray, instrumentConnectionData.instrumentId);

    fullDataArray.forEach(function (partData) {

      if (partData !== '' && partData !== undefined && partData !== null) {

        partData = partData.replace(/[\x05\x02\x03]/g, '');
        const astmArray = partData.split(/\r?\n/);
        const dataArray = that.getASTMDataBlock(astmArray);

        //that.utilitiesService.logger('info', dataArray, instrumentConnectionData.instrumentId);
        //that.utilitiesService.logger('info', dataArray['R'][0], instrumentConnectionData.instrumentId);

        if (dataArray === null || dataArray === undefined || !dataArray['R'] || dataArray['R'].length == 0) {
          // console.error(partData);
          // console.error(astmArray);
          // console.error(dataArray);
          that.utilitiesService.logger('info', 'No ASTM Elecsys data received.', instrumentConnectionData.instrumentId);
          return;
        }

        that.saveASTMDataBlock(dataArray, partData, instrumentConnectionData);

      }
      else {
        that.utilitiesService.logger('error', "Failed to save :" + JSON.stringify(astmData), instrumentConnectionData.instrumentId);
      }
    });

  }

  processASTMConcatenatedData(instrumentConnectionData: InstrumentConnectionStack, astmData: string) {

    //this.logger('info', astmData, instrumentConnectionData.instrumentId);

    const that = this;
    astmData = that.utilitiesService.replaceControlCharacters(astmData);
    const fullDataArray = astmData.split('##START##');

    // that.utilitiesService.logger('info', "AFTER SPLITTING USING ##START##", instrumentConnectionData.instrumentId);
    // that.utilitiesService.logger('info', fullDataArray, instrumentConnectionData.instrumentId);

    fullDataArray.forEach(function (partData) {

      if (partData !== '' && partData !== undefined && partData !== null) {

        const astmArray = partData.split(/<CR>/);
        const dataArray = that.getASTMDataBlock(astmArray);

        //that.utilitiesService.logger('info', dataArray, instrumentConnectionData.instrumentId);
        //that.utilitiesService.logger('info',dataArray['R'][0], instrumentConnectionData.instrumentId);

        if (dataArray === null || dataArray === undefined || !dataArray['R'] || dataArray['R'].length == 0) {
          that.utilitiesService.logger('info', 'No ASTM Concatenated data received.', instrumentConnectionData.instrumentId);
          return;
        }

        that.saveASTMDataBlock(dataArray, partData, instrumentConnectionData);

      } else {
        that.utilitiesService.logger('error', "Failed to save :" + JSON.stringify(astmData), instrumentConnectionData.instrumentId);
      }
    });

  }

  private saveOrder(order: any, instrumentConnectionData: InstrumentConnectionStack) {
    const that = this;
    if (order.results) {
      that.dbService.addOrderTest(order, (res) => {
        that.utilitiesService.logger('success', 'Successfully saved result : ' + order.test_id + '|' + order.order_id, instrumentConnectionData.instrumentId);
        return true;
      }, (err) => {
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
      if (element !== '') {
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
    console.log(dataArray);
    try {



      if (dataArray['O'] && dataArray['O'].length > 0) {

        const oSegmentFields = dataArray['O'][0]; // dataArray['O'] is an array of arrays (each sub-array is a segment's fields)

        order.order_id = oSegmentFields[2];
        order.test_id = oSegmentFields[1];

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
          order.test_type = '';
          order.test_unit = '';
          order.results = 'Failed';
          order.tested_by = '';
          order.analysed_date_time = '';
          order.authorised_date_time = '';
          order.result_accepted_date_time = '';
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
}
