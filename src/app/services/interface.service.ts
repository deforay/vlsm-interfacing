import { Injectable } from '@angular/core';
import { DatabaseService } from './database.service';
import { BehaviorSubject, Observable } from 'rxjs';
import { ElectronStoreService } from './electron-store.service';
import { ElectronService } from '../core/services';
import { ConnectionParams } from '../interfaces/connection-params.interface';


interface RawData {
  data: string;
  machine: string;
}

interface ConnectionData {
  connectionMode?: 'tcpserver' | 'tcpclient';
  connectionProtocol?: string;
  instrumentId?: string;
  labName?: string;
  machineType?: string;
  statusSubject: BehaviorSubject<boolean>;
  connectionAttemptStatusSubject: BehaviorSubject<boolean>;
  connectionSocket?: any;
  connectionServer?: any;
}


@Injectable({
  providedIn: 'root'
})


export class InterfaceService {

  public connectionParams: ConnectionParams = null;
  public socketClient = null;
  public server = null;
  public net = null;
  public hl7parser = require('hl7parser');

  protected ACK = Buffer.from('06', 'hex');
  protected EOT = '04';
  protected NAK = '21';

  protected log = null;
  protected strData = '';
  protected connectopts: any = null;
  protected timer = null;
  protected logtext = [];

  private connections: Map<string, ConnectionData> = new Map();

  protected lastOrdersSubject = new BehaviorSubject([]);
  // eslint-disable-next-line @typescript-eslint/member-ordering
  lastOrders = this.lastOrdersSubject.asObservable();

  protected liveLogSubject = new BehaviorSubject([]);
  // eslint-disable-next-line @typescript-eslint/member-ordering
  liveLog = this.liveLogSubject.asObservable();


  constructor(public electronService: ElectronService,
    public dbService: DatabaseService) {
    this.log = this.electronService.log;
    this.net = this.electronService.net;
  }

  // Method used to connect to the Testing Machine
  connect(connectionParams: ConnectionParams) {

    const that = this;
    let connectionData: ConnectionData = null;

    const connectionKey = that._getKey(connectionParams.host, connectionParams.port);

    if (this.connections.has(connectionKey)) {
      connectionData = this.connections.get(connectionKey);
    }
    else {
      const statusSubject = new BehaviorSubject(false);
      // Subscribe to the BehaviorSubject
      statusSubject.subscribe(value => {
        console.log(connectionParams.instrumentId + ' statusSubject::::::::' + value);
      });
      const connectionAttemptStatusSubject = new BehaviorSubject(false);
      // Subscribe to the BehaviorSubject
      connectionAttemptStatusSubject.subscribe(value => {
        console.log(connectionParams.instrumentId + ' connectionAttemptStatusSubject::::::::' + value);
      });

      connectionData = {
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

      this.connections.set(connectionKey, connectionData);

    }

    connectionData.connectionAttemptStatusSubject.next(true);

    if (connectionParams.connectionMode === 'tcpserver') {
      that.logger('info', 'Listening for connection on port ' + connectionParams.port);
      connectionData.connectionServer = that.net.createServer();
      connectionData.connectionServer.listen(that.connectionParams.port);

      const sockets = [];
      connectionData.connectionServer.on('connection', function (socket) {
        // confirm socket connection from client
        that.logger('info', (new Date()) + ' : A remote client has connected to the Interfacing Server');

        sockets.push(socket);
        that.socketClient = socket;
        socket.on('data', function (data) {
          that.handleTCPResponse(connectionKey, data);
        });

        connectionData.connectionSocket = that.socketClient;
        connectionData.statusSubject.next(true);

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


      connectionData.connectionServer.on('error', function (e) {
        that.logger('error', 'Error while connecting ' + e.code);
        that.disconnect(connectionParams.host, connectionParams.port);

        if (connectionParams.interfaceAutoConnect === 'yes') {
          connectionData.connectionAttemptStatusSubject.next(true);
          that.logger('error', "Interface AutoConnect is enabled: Will re-attempt connection in 30 seconds");
          setTimeout(() => {
            that.reconnect(connectionParams);
          }, 30000);
        }

      });

    } else if (connectionParams.connectionMode === 'tcpclient') {

      connectionData.connectionSocket = that.socketClient = new that.net.Socket();
      that.connectopts = {
        port: connectionParams.port,
        host: connectionParams.host
      };

      // since this is a CLIENT connection, we don't need a server object, so we set it to null
      connectionData.connectionServer = null;

      that.logger('info', 'Trying to connect as client');

      connectionData.connectionSocket.connect(that.connectopts, function () {
        connectionData.statusSubject.next(true);
        that.logger('success', 'Connected as client successfully');
      });

      connectionData.connectionSocket.on('data', function (data) {
        connectionData.statusSubject.next(true);
        that.handleTCPResponse(connectionKey, data);
      });

      connectionData.connectionSocket.on('close', function () {
        that.disconnect(that.connectionParams.host, that.connectionParams.port);
        if (that.connectionParams.interfaceAutoConnect === 'yes') {
          connectionData.connectionAttemptStatusSubject.next(true);
          that.logger('error', "Interface AutoConnect is enabled: Will re-attempt connection in 30 seconds");
          setTimeout(() => {
            that.reconnect(that.connectionParams);
          }, 30000);
        }

      });

      connectionData.connectionSocket.on('error', (e) => {
        that.logger('error', e);
        that.disconnect(that.connectionParams.host, that.connectionParams.port);

        if (that.connectionParams.interfaceAutoConnect === 'yes') {
          connectionData.connectionAttemptStatusSubject.next(true);
          that.logger('error', "Interface AutoConnect is enabled: Will re-attempt connection in 30 seconds");
          setTimeout(() => {
            that.reconnect(that.connectionParams);
          }, 30000);
        }

      });
    } else {

    }

  }

  reconnect(connectionParams: ConnectionParams) {
    let that = this;
    that.disconnect(connectionParams.host, connectionParams.port);
    that.connect(connectionParams)
  }

  disconnect(host: string, port: number) {
    const that = this;
    const connectionKey = that._getKey(host, port);

    const connectionData = that.connections.get(connectionKey);
    if (connectionData) {

      connectionData.statusSubject.next(false);
      connectionData.connectionAttemptStatusSubject.next(false);

      if (connectionData.connectionMode === 'tcpclient' && connectionData.connectionSocket) {
        connectionData.connectionSocket.destroy();
        that.logger('info', 'Client Disconnected');

      } else if (connectionData.connectionMode === 'tcpserver' && connectionData.connectionServer) {
        connectionData.connectionServer.close();
        that.logger('info', 'Server Stopped');
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

    that.logger('info', 'Sending HL7 ACK : ' + ack);
    return ack;
  }



  hex2ascii(hexx) {
    const hex = hexx.toString(); // force conversion
    let str = '';
    for (let i = 0; i < hex.length; i += 2) {
      str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }

    return str;
  }


  processHL7DataAlinity(connectionData, rawHl7Text: string) {

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
          order.results = '>10000000';
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
        order.analysed_date_time = that.formatRawDate(singleObx.get('OBX.19').toString());
        //order.specimen_date_time = this.formatRawDate(message.get('OBX').get(0).get('OBX.19').toString());
        order.authorised_date_time = that.formatRawDate(singleObx.get('OBX.19').toString());
        order.result_accepted_date_time = that.formatRawDate(singleObx.get('OBX.19').toString());
        order.test_location = connectionData.labName;
        order.machine_used = connectionData.analyzerMachineName;

        if (order.results) {
          that.dbService.addOrderTest(order, (res) => {
            that.logger('success', 'Successfully saved result : ' + order.test_id);
          }, (err) => {
            that.logger('error', 'Failed to save result : ' + order.test_id + ' ' + JSON.stringify(err));
          });
        } else {
          that.logger('error', 'Failed to store data into the database');
        }
      });
    });
  }
  processHL7Data(connectionData, rawHl7Text: string) {

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
        } else if (resultOutcome == '<20') {
          order.test_unit = '';
          order.results = 'Target Not Detected';
        } else if (resultOutcome == '> Titer max') {
          order.test_unit = '';
          order.results = '>10000000';
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
        order.analysed_date_time = that.formatRawDate(singleObx.get('OBX.19').toString());
        //order.specimen_date_time = this.formatRawDate(message.get('OBX').get(0).get('OBX.19').toString());
        order.authorised_date_time = that.formatRawDate(singleObx.get('OBX.19').toString());
        order.result_accepted_date_time = that.formatRawDate(singleObx.get('OBX.19').toString());
        order.test_location = connectionData.labName;
        order.machine_used = connectionData.analyzerMachineName;

        if (order.results) {
          that.dbService.addOrderTest(order, (res) => {
            that.logger('success', 'Successfully saved result : ' + order.test_id);
          }, (err) => {
            that.logger('error', 'Failed to save result : ' + order.test_id + ' ' + JSON.stringify(err));
          });
        } else {
          that.logger('error', 'Failed to store data into the database');
        }
      });
    });
  }
  processHL7DataRoche68008800(connectionData, rawHl7Text: string) {

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
        } else if (resultOutcome == '<20') {
          order.test_unit = '';
          order.results = 'Target Not Detected';
        } else if (resultOutcome == '> Titer max') {
          order.test_unit = '';
          order.results = '>10000000';
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
        order.analysed_date_time = that.formatRawDate(singleObx.get('OBX.19').toString());
        //order.specimen_date_time = this.formatRawDate(message.get('OBX').get(0).get('OBX.19').toString());
        order.authorised_date_time = that.formatRawDate(singleObx.get('OBX.19').toString());
        order.result_accepted_date_time = that.formatRawDate(singleObx.get('OBX.19').toString());
        order.test_location = connectionData.labName;
        order.machine_used = connectionData.instrumentId;

        if (order.results) {
          that.dbService.addOrderTest(order, (res) => {
            that.logger('success', 'Successfully saved result : ' + order.test_id);
          }, (err) => {
            that.logger('error', 'Failed to save result : ' + order.test_id + ' ' + JSON.stringify(err));
          });
        } else {
          that.logger('error', 'Failed to store data into the database');
        }
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


  private receiveASTM(astmProtocolType: string, connectionData: ConnectionData, data: Buffer) {
    let that = this;
    that.logger('info', 'Receiving ' + astmProtocolType);

    const hexData = data.toString('hex');

    if (hexData === that.EOT) {
      connectionData.connectionSocket.write(that.ACK);
      that.logger('info', 'Received EOT. Sending ACK.');
      that.logger('info', 'Processing ' + astmProtocolType);
      that.logger('info', 'Data ' + that.strData);

      const rawData: RawData = {
        data: that.strData,
        machine: connectionData.instrumentId,
      };

      that.dbService.addRawData(rawData, (res) => {
        that.logger('success', 'Successfully saved raw data');
      }, (err) => {
        that.logger('error', 'Failed to save raw data : ' + JSON.stringify(err));
      });

      switch (astmProtocolType) {
        case 'astm-elecsys':
          that.processASTMElecsysData(connectionData, that.strData);
          break;
        case 'astm-concatenated':
          that.processASTMConcatenatedData(connectionData, that.strData);
          break;
        default:
          // Handle unexpected protocol
          break;
      }
      that.strData = "";
    } else if (hexData === that.NAK) {
      connectionData.connectionSocket.write(that.ACK);
      that.logger('error', 'NAK Received');
      that.logger('info', 'Sending ACK');
    } else {
      let text = that.hex2ascii(hexData);
      const regex = /^\d*H/;
      if (regex.test(text.replace(/[\x05\x02\x03]/g, ''))) {
        text = '##START##' + text;
      }
      that.strData += text;
      that.logger('info', 'Receiving....' + text);
      connectionData.connectionSocket.write(that.ACK);
      that.logger('info', 'Sending ACK');
    }
  }

  private receiveHL7(connectionData: ConnectionData, data: Buffer) {
    let that = this;
    that.logger('info', 'Receiving HL7 data');
    const hl7Text = that.hex2ascii(data.toString('hex'));
    that.strData += hl7Text;

    that.logger('info', hl7Text);

    // If there is a File Separator or 1C or ASCII 28 character,
    // it means the stream has ended and we can proceed with saving this data
    if (that.strData.includes('\x1c')) {
      // Let us store this Raw Data before we process it

      that.logger('info', 'Received File Separator Character. Ready to process HL7 data');
      const rData: any = {};
      rData.data = that.strData;
      rData.machine = connectionData.instrumentId;

      that.dbService.addRawData(rData, (res) => {
        that.logger('success', 'Successfully saved raw data');
      }, (err) => {
        that.logger('error', 'Failed to save raw data ' + JSON.stringify(err));
      });

      that.strData = that.strData.replace(/[\x0b\x1c]/g, '');
      that.strData = that.strData.trim();
      that.strData = that.strData.replace(/[\r\n\x0B\x0C\u0085\u2028\u2029]+/gm, '\r');

      if (connectionData.machineType !== undefined
        && connectionData.machineType !== null
        && connectionData.machineType !== ""
        && connectionData.machineType === 'abbott-alinity-m') {
        that.processHL7DataAlinity(connectionData, that.strData);
      }
      else if (connectionData.machineType !== undefined
        && connectionData.machineType !== null
        && connectionData.machineType !== ""
        && connectionData.machineType === 'roche-cobas-6800') {
        that.processHL7DataRoche68008800(connectionData, that.strData);
      }
      else {
        that.processHL7Data(connectionData, that.strData);
      }

      that.strData = '';
    }
  }


  handleTCPResponse(connectionKey: string, data) {
    const that = this;
    const connectionData = that.connections.get(connectionKey);
    if (connectionData.connectionProtocol === 'hl7') {
      that.receiveHL7(connectionData, data);
    } else if (connectionData.connectionProtocol === 'astm-elecsys') {
      that.receiveASTM('astm-elecsys', connectionData, data);
    } else if (connectionData.connectionProtocol === 'astm-concatenated') {
      that.receiveASTM('astm-concatenated', connectionData, data);
    }
  }

  arrayKeyExists(key, search) { // eslint-disable-line camelcase
    //  discuss at: http://locutus.io/php/arrayKeyExists/
    // original by: Kevin van Zonneveld (http://kvz.io)
    // improved by: Felix Geisendoerfer (http://www.debuggable.com/felix)
    //   example 1: arrayKeyExists('kevin', {'kevin': 'van Zonneveld'})
    //   returns 1: true

    if (!search || (search.constructor !== Array && search.constructor !== Object)) {
      return false
    }

    return key in search
  }

  formatRawDate(rawDate) {

    if (rawDate === false || rawDate === null || rawDate === '' || rawDate === undefined || rawDate.length === 0) {
      return null;
    }

    const len = rawDate.length;
    const year = rawDate.substring(0, 4);
    const month = rawDate.substring(4, 6);
    const day = rawDate.substring(6, 8);
    let d = year + '-' + month + '-' + day;
    if (len > 9) {
      const h = rawDate.substring(8, 10);
      const m = rawDate.substring(10, 12);
      let s = '00';
      if (len > 11) { s = rawDate.substring(12, 14); }
      d += ' ' + h + ':' + m + ':' + s;
    }
    return d;
  }

  processASTMElecsysData(connectionData: ConnectionData, astmData: string) {

    //that.logger('info', astmData);

    const that = this;
    const fullDataArray = astmData.split('##START##');

    // that.logger('info', "AFTER SPLITTING USING ##START##");
    // that.logger('info', fullDataArray);


    fullDataArray.forEach(function (partData) {

      if (partData !== '' && partData !== undefined && partData !== null) {

        let data = partData.replace(/[\x05\x02\x03]/g, '');
        let astmArray = data.split(/\r?\n/);

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


        //that.logger('info', dataArray);
        //that.logger('info',dataArray['R']);

        if (dataArray === null || dataArray === undefined || dataArray['R'] === undefined) {
          that.logger('info', 'No data received');
          return;
        }

        const order: any = {};

        try {

          if (that.arrayKeyExists('R', dataArray) && typeof dataArray['R'] == 'string') {
            dataArray['R'] = dataArray['R'].split(',');
          }

          if (that.arrayKeyExists('O', dataArray) && typeof dataArray['O'] == 'string') {
            dataArray['O'] = dataArray['O'].split(',');
          }

          if (that.arrayKeyExists('C', dataArray) && typeof dataArray['C'] == 'string') {
            dataArray['C'] = dataArray['C'].split(',');
          }


          // console.warn(dataArray['O']);
          // console.warn(dataArray['R']);

          if (dataArray['O'] !== undefined && dataArray['O'] !== null) {

            order.order_id = dataArray['O'][2];
            order.test_id = dataArray['O'][1];
            if (dataArray['R'] !== undefined && dataArray['R'] !== null) {
              order.test_type = (dataArray['R'][2]) ? dataArray['R'][2].replace('^^^', '') : dataArray['R'][2];
              order.test_unit = dataArray['R'][4];
              order.results = dataArray['R'][3];
              order.tested_by = dataArray['R'][10];
              order.analysed_date_time = that.formatRawDate(dataArray['R'][12]);
              order.authorised_date_time = that.formatRawDate(dataArray['R'][12]);
              order.result_accepted_date_time = that.formatRawDate(dataArray['R'][12]);
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
            order.test_location = connectionData.labName;
            order.machine_used = connectionData.instrumentId;

            if (order.order_id) {
              that.logger('info', "Trying to add order :" + JSON.stringify(order));
              that.dbService.addOrderTest(order, (res) => {
                that.logger('success', 'Successfully saved result : ' + order.order_id);
              }, (err) => {
                that.logger('error', 'Failed to save : ' + JSON.stringify(err));
              });
            } else {
              that.logger('error', "Failed to save :" + JSON.stringify(order));
            }
          }
        }

        catch (error) {
          that.logger('error', error);
          console.error(error);
          return;
        }

        //if (dataArray == undefined || dataArray['0'] == undefined ||
        //      dataArray['O'][3] == undefined || dataArray['O'][3] == null ||
        //        dataArray['O'][3] == '') return;
        //if (dataArray == undefined || dataArray['R'] == undefined
        //        || dataArray['R'][2] == undefined || dataArray['R'][2] == null
        //        || dataArray['R'][2] == '') return;

      } else {
        that.logger('error', "Failed to save :" + JSON.stringify(astmData));
      }
    });

  }

  processASTMConcatenatedData(connectionData: ConnectionData, astmData: string) {

    //this.logger('info', astmData);

    const that = this;
    astmData = astmData.replace(/[\x05]/g, '');
    astmData = astmData.replace(/\x02/g, "<STX>");
    astmData = astmData.replace(/\x03/g, "<ETX>");
    astmData = astmData.replace(/\x04/g, "<EOT>");
    astmData = astmData.replace(/\x17/g, "<ETB>");
    //astmData = astmData.replace(/\x5E/g, "::")

    astmData = astmData.replace(/\n/g, "<LF>");
    astmData = astmData.replace(/\r/g, "<CR>");

    //Let us remove the transmission blocks
    astmData = astmData.replace(/<ETB>\w{2}<CR><LF>/g, "").replace(/<STX>/g, "");

    const fullDataArray = astmData.split('##START##');

    // that.logger('info', "AFTER SPLITTING USING ##START##");
    // that.logger('info', fullDataArray);

    fullDataArray.forEach(function (partData) {

      if (partData !== '' && partData !== undefined && partData !== null) {

        const astmArray = partData.split(/<CR>/);

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


        //console.log("=== CHOTOA ===");
        //that.logger('info', dataArray);
        //that.logger('info',dataArray['R']);

        if (dataArray === null || dataArray === undefined || dataArray['R'] === undefined) {
          that.logger('info', 'dataArray blank');
          return;
        }

        const order: any = {};

        try {

          if (that.arrayKeyExists('R', dataArray) && typeof dataArray['R'] == 'string') {
            dataArray['R'] = dataArray['R'].split(',');
          }

          if (that.arrayKeyExists('O', dataArray) && typeof dataArray['O'] == 'string') {
            dataArray['O'] = dataArray['O'].split(',');
          }

          if (that.arrayKeyExists('C', dataArray) && typeof dataArray['C'] == 'string') {
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
              order.analysed_date_time = that.formatRawDate(dataArray['R'][12]);
              order.authorised_date_time = that.formatRawDate(dataArray['R'][12]);
              order.result_accepted_date_time = that.formatRawDate(dataArray['R'][12]);
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
            order.test_location = connectionData.labName;
            order.machine_used = connectionData.instrumentId;

            if (order.order_id) {
              that.logger('info', "Trying to add order :" + JSON.stringify(order));
              that.dbService.addOrderTest(order, (res) => {
                that.logger('success', 'Successfully saved result : ' + order.order_id);
              }, (err) => {
                that.logger('error', 'Failed to save : ' + JSON.stringify(err));
              });
            } else {
              that.logger('error', "Failed to save :" + JSON.stringify(order));
            }
          }
        }

        catch (error) {
          that.logger('error', error);
          console.error(error);
          return;

        }

        //if (dataArray == undefined || dataArray['0'] == undefined ||
        //      dataArray['O'][3] == undefined || dataArray['O'][3] == null ||
        //        dataArray['O'][3] == '') return;
        //if (dataArray == undefined || dataArray['R'] == undefined
        //        || dataArray['R'][2] == undefined || dataArray['R'][2] == null
        //        || dataArray['R'][2] == '') return;

      }
    });

  }


  fetchLastOrders() {
    const that = this;
    that.dbService.fetchLastOrders((res) => {
      res = [res]; // converting it into an array
      that.lastOrdersSubject.next(res);
    }, (err) => {
      that.logger('error', 'Failed to fetch data ' + JSON.stringify(err));
    });
  }

  fetchRecentLogs() {
    const that = this;
    that.dbService.fetchRecentLogs((res) => {

      res.forEach(function (r) {
        that.logtext.push(r.log);
        that.liveLogSubject.next(that.logtext);
      });

    }, (err) => {
      that.logger('error', 'Failed to fetch data ' + JSON.stringify(err));
    });
  }

  fetchLastSyncTimes(callback): any {
    const that = this;
    that.dbService.fetchLastSyncTimes((res) => {
      // data.lastLimsSync = (res[0].lastLimsSync);
      // data.lastResultReceived = (res[0].lastResultReceived);
      // return data;

      callback(res[0]);
    }, (err) => {
      that.logger('error', 'Failed to fetch data ' + JSON.stringify(err));
    });
  }

  clearLiveLog() {
    const that = this;
    that.logtext = []
    that.liveLogSubject.next(that.logtext);
  }


  logger(logType, message) {
    const that = this;
    const moment = require('moment');
    const date = moment(new Date()).format('DD-MMM-YYYY HH:mm:ss');

    let logMessage = '';

    that.log.transports.file.fileName = `${moment().format('YYYY-MM-DD')}.log`;

    if (logType === 'info') {
      that.log.info(message);
      logMessage = '<span class="text-info">[info]</span> [' + date + '] ' + message + '<br>';
    } else if (logType === 'error') {
      that.log.error(message);
      logMessage = '<span class="text-danger">[error]</span> [' + date + '] ' + message + '<br>';
    } else if (logType === 'success') {
      that.log.info(message);
      logMessage = '<span class="text-success">[success]</span> [' + date + '] ' + message + '<br>';
    }

    //that.logtext[that.logtext.length] = logMessage;
    that.logtext.unshift(logMessage);
    that.liveLogSubject.next(that.logtext);

    const dbLog: any = {};
    dbLog.log = logMessage;

    that.dbService.addApplicationLog(dbLog, (res) => { }, (err) => { });

  }

  _getKey(host: string, port: number): string {
    return `${host}:${port}`;
  }

  getStatusObservable(host: string, port: number): Observable<boolean> {
    const connectionKey = this._getKey(host, port);
    const connectionData = this.connections.get(connectionKey);
    return connectionData.statusSubject.asObservable();
  }

  getConnectionAttemptObservable(host: string, port: number): Observable<boolean> {
    const connectionKey = this._getKey(host, port);
    const connectionData = this.connections.get(connectionKey);
    return connectionData.connectionAttemptStatusSubject.asObservable();
  }

}
