import { Injectable } from '@angular/core';
import { DatabaseService } from './database.service';
import { BehaviorSubject, Observable } from 'rxjs';
import { ElectronService } from '../core/services';
import { ConnectionParams } from '../interfaces/connection-params.interface';
import { InstrumentConnections } from '../interfaces/intrument-connections.interface';
import { RawMachineData } from '../interfaces/raw-machine-data.interface';
import { UtilitiesService } from './utilities.service';

@Injectable({
  providedIn: 'root'
})

export class InstrumentInterfaceService {

  public connectionParams: ConnectionParams = null;
  public socketClient = null;
  public server = null;
  public net = null;
  public hl7parser = require('hl7parser');

  protected ACK = Buffer.from('06', 'hex');
  protected EOT = '04';
  protected NAK = '21';

  protected strData = '';
  protected clientConnectionOptions: any = null;
  protected timer = null;

  private connections: Map<string, InstrumentConnections> = new Map();

  constructor(public electronService: ElectronService,
    public dbService: DatabaseService,
    public utilitiesService: UtilitiesService) {
    this.net = this.electronService.net;
  }

  // Method used to connect to the Testing Machine
  connect(connectionParams: ConnectionParams) {

    const that = this;
    let instrumentConnectionData: InstrumentConnections = null;

    const connectionKey = that._getKey(connectionParams.host, connectionParams.port);

    if (this.connections.has(connectionKey)) {
      instrumentConnectionData = this.connections.get(connectionKey);
    }
    else {
      const statusSubject = new BehaviorSubject(false);
      // Subscribe to the BehaviorSubject
      statusSubject.subscribe(value => {
        console.info(connectionParams.instrumentId + ' statusSubject ===> ' + value);
      });
      const connectionAttemptStatusSubject = new BehaviorSubject(false);
      // Subscribe to the BehaviorSubject
      connectionAttemptStatusSubject.subscribe(value => {
        console.info(connectionParams.instrumentId + ' connectionAttemptStatusSubject ===> ' + value);
      });

      instrumentConnectionData = {
        connectionMode: connectionParams.connectionMode,
        connectionProtocol: connectionParams.connectionProtocol,
        instrumentId: connectionParams.instrumentId,
        labName: connectionParams.labName,
        machineType: connectionParams.machineType,
        statusSubject: statusSubject,
        connectionAttemptStatusSubject: connectionAttemptStatusSubject,
        connectionSocket: null,
        connectionServer: null
      };

      this.connections.set(connectionKey, instrumentConnectionData);

    }

    instrumentConnectionData.connectionAttemptStatusSubject.next(true);

    if (connectionParams.connectionMode === 'tcpserver') {
      that.utilitiesService.logger('info', 'Listening for connection on port ' + connectionParams.port, instrumentConnectionData.instrumentId);
      instrumentConnectionData.connectionServer = that.net.createServer();
      instrumentConnectionData.connectionServer.listen(connectionParams.port);

      const sockets = [];
      instrumentConnectionData.connectionServer.on('connection', function (socket) {
        // confirm socket connection from client
        that.utilitiesService.logger('info', (new Date()) + ' : A remote client has connected to the Interfacing Server', instrumentConnectionData.instrumentId);

        sockets.push(socket);
        that.socketClient = socket;
        socket.on('data', function (data) {
          that.handleTCPResponse(connectionKey, data);
        });

        instrumentConnectionData.connectionSocket = that.socketClient;
        instrumentConnectionData.statusSubject.next(true);

        // Add a 'close' event handler to this instance of socket
        socket.on('close', function (data) {
          const index = sockets.findIndex(function (o) {
            return o.host === socket.host && o.port === socket.port;
          })
          if (index !== -1) {
            sockets.splice(index, 1);
          }
          console.log('CLOSED: ' + socket.host + ' ' + socket.host);
        });

      });


      instrumentConnectionData.connectionServer.on('error', function (e) {
        that.utilitiesService.logger('error', 'Error while connecting ' + e.code, instrumentConnectionData.instrumentId);
        that.disconnect(connectionParams.host, connectionParams.port);

        if (connectionParams.interfaceAutoConnect === 'yes') {
          instrumentConnectionData.connectionAttemptStatusSubject.next(true);
          that.utilitiesService.logger('error', "Interface AutoConnect is enabled: Will re-attempt connection in 30 seconds", instrumentConnectionData.instrumentId);
          setTimeout(() => {
            that.connect(connectionParams);
          }, 30000);
        }

      });

    } else if (connectionParams.connectionMode === 'tcpclient') {

      instrumentConnectionData.connectionSocket = that.socketClient = new that.net.Socket();
      that.clientConnectionOptions = {
        port: connectionParams.port,
        host: connectionParams.host
      };

      // since this is a CLIENT connection, we don't need a server object, so we set it to null
      instrumentConnectionData.connectionServer = null;

      that.utilitiesService.logger('info', 'Trying to connect as client', instrumentConnectionData.instrumentId);

      instrumentConnectionData.connectionSocket.connect(that.clientConnectionOptions, function () {
        instrumentConnectionData.statusSubject.next(true);
        that.utilitiesService.logger('success', 'Connected as client successfully', instrumentConnectionData.instrumentId);
      });

      instrumentConnectionData.connectionSocket.on('data', function (data) {
        instrumentConnectionData.statusSubject.next(true);
        that.handleTCPResponse(connectionKey, data);
      });

      instrumentConnectionData.connectionSocket.on('close', function () {
        that.disconnect(connectionParams.host, connectionParams.port);
        if (connectionParams.interfaceAutoConnect === 'yes') {
          instrumentConnectionData.connectionAttemptStatusSubject.next(true);
          that.utilitiesService.logger('error', "Interface AutoConnect is enabled: Will re-attempt connection in 30 seconds", instrumentConnectionData.instrumentId);
          setTimeout(() => {
            that.connect(connectionParams);
          }, 30000);
        }

      });

      instrumentConnectionData.connectionSocket.on('error', (e) => {
        that.utilitiesService.logger('error', e);
        that.disconnect(connectionParams.host, connectionParams.port);

        if (connectionParams.interfaceAutoConnect === 'yes') {
          instrumentConnectionData.connectionAttemptStatusSubject.next(true);
          that.utilitiesService.logger('error', "Interface AutoConnect is enabled: Will re-attempt connection in 30 seconds", instrumentConnectionData.instrumentId);
          setTimeout(() => {
            that.connect(connectionParams);
          }, 30000);
        }

      });
    } else {

    }

  }

  reconnect(connectionParams: ConnectionParams, connectInSeconds = 0) {
    let that = this;
    that.disconnect(connectionParams.host, connectionParams.port);
    that.connect(connectionParams);
  }

  disconnect(host: string, port: number) {
    const that = this;
    const connectionKey = that._getKey(host, port);

    const instrumentConnectionData = that.connections.get(connectionKey);
    if (instrumentConnectionData) {

      instrumentConnectionData.statusSubject.next(false);
      instrumentConnectionData.connectionAttemptStatusSubject.next(false);

      if (instrumentConnectionData.connectionMode === 'tcpclient' && instrumentConnectionData.connectionSocket) {
        instrumentConnectionData.connectionSocket.end();
        instrumentConnectionData.connectionSocket.destroy();
        that.utilitiesService.logger('info', 'Client Disconnected', instrumentConnectionData.instrumentId);

      } else if (instrumentConnectionData.connectionMode === 'tcpserver' && instrumentConnectionData.connectionServer) {
        instrumentConnectionData.connectionServer.close();
        that.utilitiesService.logger('info', 'Server Stopped', instrumentConnectionData.instrumentId);
      }
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
    that.socketClient.write(that.hl7ACK(msgID, characterSet, messageProfileIdentifier));
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

        order.test_type = 'HIVVL';

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
    that.socketClient.write(that.hl7ACK(msgID, characterSet, messageProfileIdentifier));
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

        order.test_type = 'HIVVL';

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
  processHL7DataRoche68008800(instrumentConnectionData: InstrumentConnections, rawHl7Text: string) {

    const that = this;
    const message = that.hl7parser.create(rawHl7Text.trim());
    const msgID = message.get('MSH.10').toString();
    const characterSet = message.get('MSH.18').toString();
    const messageProfileIdentifier = message.get('MSH.21').toString();
    that.socketClient.write(that.hl7ACK(msgID, characterSet, messageProfileIdentifier));

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

        order.test_type = 'HIVVL';

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


  private receiveASTM(astmProtocolType: string, instrumentConnectionData: InstrumentConnections, data: Buffer) {
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
        that.utilitiesService.logger('success', 'Successfully saved raw data', instrumentConnectionData.instrumentId);
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

  private receiveHL7(instrumentConnectionData: InstrumentConnections, data: Buffer) {
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
        that.utilitiesService.logger('success', 'Successfully saved raw data', instrumentConnectionData.instrumentId);
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
        && instrumentConnectionData.machineType === 'roche-cobas-6800') {
        that.processHL7DataRoche68008800(instrumentConnectionData, that.strData);
      }
      else {
        that.processHL7Data(instrumentConnectionData, that.strData);
      }

      that.strData = '';
    }
  }


  handleTCPResponse(connectionKey: string, data: Buffer) {
    const that = this;
    const instrumentConnectionData = that.connections.get(connectionKey);
    if (instrumentConnectionData.connectionProtocol === 'hl7') {
      that.receiveHL7(instrumentConnectionData, data);
    } else if (instrumentConnectionData.connectionProtocol === 'astm-elecsys') {
      that.receiveASTM('astm-elecsys', instrumentConnectionData, data);
    } else if (instrumentConnectionData.connectionProtocol === 'astm-concatenated') {
      that.receiveASTM('astm-concatenated', instrumentConnectionData, data);
    }
  }


  processASTMElecsysData(instrumentConnectionData: InstrumentConnections, astmData: string) {

    //that.utilitiesService.logger('info', astmData, instrumentConnectionData.instrumentId);

    const that = this;
    const fullDataArray = astmData.split('##START##');

    // that.utilitiesService.logger('info', "AFTER SPLITTING USING ##START##", instrumentConnectionData.instrumentId);
    // that.utilitiesService.logger('info', fullDataArray, instrumentConnectionData.instrumentId);

    fullDataArray.forEach(function (partData) {

      if (partData !== '' && partData !== undefined && partData !== null) {

        partData = partData.replace(/[\x05\x02\x03]/g, '');
        const astmArray = partData.split(/\r?\n/);
        const dataArray = [];
        astmArray.forEach(function (element) {
          if (element !== '') {
            element = element.replace(/^\d*/, '');
            if (dataArray[element.substring(0, 1)] === undefined) {
              dataArray[element.substring(0, 1)] = element.split('|');
            } else {
              const arr = element.split('|');
              arr.shift();
              dataArray[element.substring(0, 1)] += arr;
            }
          }
        });

        //that.utilitiesService.logger('info', dataArray, instrumentConnectionData.instrumentId);
        //that.utilitiesService.logger('info',dataArray['R'], instrumentConnectionData.instrumentId);

        if (dataArray === null || dataArray === undefined || dataArray['R'] === undefined) {
          console.error(dataArray);
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

  processASTMConcatenatedData(instrumentConnectionData: InstrumentConnections, astmData: string) {

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
        //that.utilitiesService.logger('info',dataArray['R'], instrumentConnectionData.instrumentId);

        if (dataArray === null || dataArray === undefined || dataArray['R'] === undefined) {
          that.utilitiesService.logger('info', 'No ASTM Concatenated data received.', instrumentConnectionData.instrumentId);
          return;
        }

        that.saveASTMDataBlock(dataArray, partData, instrumentConnectionData);

      } else {
        that.utilitiesService.logger('error', "Failed to save :" + JSON.stringify(astmData), instrumentConnectionData.instrumentId);
      }
    });

  }


  private _getKey(host: string, port: number): string {
    return `${host}:${port}`;
  }

  getStatusObservable(host: string, port: number): Observable<boolean> {
    const connectionKey = this._getKey(host, port);
    const instrumentConnectionData = this.connections.get(connectionKey);
    return instrumentConnectionData.statusSubject.asObservable();
  }

  getConnectionAttemptObservable(host: string, port: number): Observable<boolean> {
    const connectionKey = this._getKey(host, port);
    const instrumentConnectionData = this.connections.get(connectionKey);
    return instrumentConnectionData.connectionAttemptStatusSubject.asObservable();
  }

  private saveOrder(order: any, instrumentConnectionData: InstrumentConnections) {
    const that = this;
    if (order.results) {
      that.dbService.addOrderTest(order, (res) => {
        that.utilitiesService.logger('success', 'Successfully saved result : ' + order.test_id, instrumentConnectionData.instrumentId);
        return true;
      }, (err) => {
        that.utilitiesService.logger('error', 'Failed to save result : ' + order.test_id + ' ' + JSON.stringify(err), instrumentConnectionData.instrumentId);
        return false;
      });
    } else {
      that.utilitiesService.logger('error', 'Failed to store data into the database', instrumentConnectionData.instrumentId);
      return false;
    }
  }

  private getASTMDataBlock(astmArray: any[]) {
    let dataArray = [];
    astmArray.forEach(function (element) {
      if (element !== '') {
        element = element.replace(/^\d*/, '');
        if (dataArray[element.substring(0, 1)] === undefined) {
          dataArray[element.substring(0, 1)] = element.split('|');
        } else {
          const arr = element.split('|');
          arr.shift();
          dataArray[element.substring(0, 1)] += arr;
        }
      }
    });
    return dataArray;
  }

  private saveASTMDataBlock(dataArray: any[], partData: string, instrumentConnectionData: InstrumentConnections) {
    const that = this;
    const order: any = {};

    try {

      if (that.utilitiesService.arrayKeyExists('R', dataArray) && typeof dataArray['R'] == 'string') {
        dataArray['R'] = dataArray['R'].split(',');
      }

      if (that.utilitiesService.arrayKeyExists('O', dataArray) && typeof dataArray['O'] == 'string') {
        dataArray['O'] = dataArray['O'].split(',');
      }

      if (that.utilitiesService.arrayKeyExists('C', dataArray) && typeof dataArray['C'] == 'string') {
        dataArray['C'] = dataArray['C'].split(',');
      }

      if (dataArray['O'] !== undefined && dataArray['O'] !== null) {

        order.order_id = dataArray['O'][2];
        order.test_id = dataArray['O'][1];
        if (dataArray['R'] !== undefined && dataArray['R'] !== null) {
          order.test_type = (dataArray['R'][2]) ? dataArray['R'][2].replace('^^^', '') : dataArray['R'][2];
          order.test_unit = dataArray['R'][4];
          order.results = dataArray['R'][3];
          order.tested_by = dataArray['R'][10];
          order.analysed_date_time = that.utilitiesService.formatRawDate(dataArray['R'][12]);
          order.authorised_date_time = that.utilitiesService.formatRawDate(dataArray['R'][12]);
          order.result_accepted_date_time = that.utilitiesService.formatRawDate(dataArray['R'][12]);
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
