import { Injectable } from '@angular/core';
import { DatabaseService } from './database.service';
import { BehaviorSubject } from 'rxjs';
import { ElectronStoreService } from './electron-store.service';
import { ElectronService } from '../core/services';


@Injectable({
  providedIn: 'root'
})


export class InterfaceService {


  public socketClient = null;
  public server = null;
  public net = null;

  public connectionTries = 0;
  public hl7parser = require('hl7parser');

  protected ACK = Buffer.from('06', 'hex');
  protected ENQ = Buffer.from('05', 'hex');
  protected SOH = Buffer.from('01', 'hex');
  protected STX = Buffer.from('02', 'hex');
  protected ETX = Buffer.from('03', 'hex');
  protected EOT = Buffer.from('04', 'hex');
  protected CR = Buffer.from('13', 'hex');
  protected FS = Buffer.from('25', 'hex');
  protected LF = Buffer.from('10', 'hex');
  protected NAK = Buffer.from('21', 'hex');

  protected log = null;
  protected strData = '';
  protected connectopts: any = null;
  protected settings = null;
  protected timer = null;
  protected logtext = [];

  // protected serialConnection = null;

  protected statusSubject = new BehaviorSubject(false);
  // eslint-disable-next-line @typescript-eslint/member-ordering
  currentStatus = this.statusSubject.asObservable();

  //protected connectionTriesSubject = new BehaviorSubject(false);
  // eslint-disable-next-line @typescript-eslint/member-ordering
  //stopTrying = this.connectionTriesSubject.asObservable();

  protected lastOrdersSubject = new BehaviorSubject([]);
  // eslint-disable-next-line @typescript-eslint/member-ordering
  lastOrders = this.lastOrdersSubject.asObservable();

  protected liveLogSubject = new BehaviorSubject([]);
  // eslint-disable-next-line @typescript-eslint/member-ordering
  liveLog = this.liveLogSubject.asObservable();


  constructor(public electronService: ElectronService,
    public dbService: DatabaseService,
    public store: ElectronStoreService) {
    this.log = this.electronService.log;
    // console.log(this.log.findLogPath());
    this.net = this.electronService.net;

  }

  // Method used to track machine connection status
  connectionStatus(interfaceConnected: boolean) {
    this.statusSubject.next(interfaceConnected);
  }

  // Method used to track machine connection status
  // stopTryingStatus(stopTrying: boolean) {
  //   this.connectionTriesSubject.next(stopTrying);
  // }

  hl7ACK(messageID) {

    const that = this;

    if (!messageID || messageID === '') {
      messageID = Math.random();
    }

    const moment = require('moment');
    const date = moment(new Date()).format('YYYYMMDDHHmmss');

    let ack = String.fromCharCode(11)
      + 'MSH|^~\\&|VLSM|VLSM|VLSM|VLSM|'
      + date + '||ACK^R22^ACK|'
      + self.crypto.randomUUID() + '|P|2.5.1||||||UNICODE UTF-8'
      + String.fromCharCode(13);

    ack += 'MSA|AA|' + messageID
      + String.fromCharCode(13)
      + String.fromCharCode(28)
      + String.fromCharCode(13);

    that.logger('info', 'Sending HL7 ACK : ' + ack);
    return ack;
  }


  // Method used to connect to the Testing Machine
  connect() {

    const that = this;
    that.settings = that.store.get('appSettings');

    if (that.settings.interfaceConnectionMode === 'tcpserver') {
      that.logger('info', 'Listening for connection on port ' + that.settings.analyzerMachinePort);
      that.server = that.net.createServer();
      that.server.listen(that.settings.analyzerMachinePort);

      const sockets = [];

      that.server.on('connection', function (socket) {
        // confirm socket connection from client
        that.logger('info', (new Date()) + ' : A remote client has connected to the Interfacing Server');
        that.connectionStatus(true);
        sockets.push(socket);
        that.socketClient = socket;
        socket.on('data', function (data) {
          that.handleTCPResponse(data);
        });

        // Add a 'close' event handler to this instance of socket
        socket.on('close', function (data) {
          const index = sockets.findIndex(function (o) {
            return o.analyzerMachineHost === socket.analyzerMachineHost && o.analyzerMachinePort === socket.analyzerMachinePort;
          })
          if (index !== -1) {
            sockets.splice(index, 1);
          }
          console.log('CLOSED: ' + socket.analyzerMachineHost + ' ' + socket.analyzerMachineHost);
        });

      });


      this.server.on('error', function (e) {
        that.connectionStatus(false);
        //that.stopTryingStatus(true);
        that.logger('error', 'Error while connecting ' + e.code);
      });

    } else if (that.settings.interfaceConnectionMode === 'tcpclient') {

      that.socketClient = new that.net.Socket();
      that.connectopts = {
        port: that.settings.analyzerMachinePort,
        host: that.settings.analyzerMachineHost
      };

      that.logger('info', 'Trying to connect as client');
      that.connectionTries++; // incrementing the connection tries

      that.socketClient.connect(that.connectopts, function () {
        that.connectionTries = 0; // resetting connection tries to 0
        that.connectionStatus(true);
        that.logger('success', 'Connected as client successfully');
      });

      that.socketClient.on('data', function (data) {
        that.connectionStatus(true);
        that.handleTCPResponse(data);
      });

      that.socketClient.on('close', function () {
        that.socketClient.destroy();
        that.connectionStatus(false);
        that.logger('info', 'Client Disconnected');
      });

      that.socketClient.on('error', (e) => {
        that.connectionStatus(false);
        //that.stopTryingStatus(true);
        that.logger('error', e);
      });
    } else {

    }

  }

  reconnect() {
    this.closeConnection();
    this.connect();
  }

  closeConnection() {
    this.settings = this.store.get('appSettings');

    if (this.settings.interfaceConnectionMode === 'tcpclient') {
      if (this.socketClient) {
        this.socketClient.destroy();
        this.connectionStatus(false);
        this.logger('info', 'Disconnected');
      }

    } else {
      if (this.server) {
        this.socketClient.destroy();
        this.server.close();
        this.connectionStatus(false);
        this.logger('info', 'Disconnected');
      }
    }
  }



  hex2ascii(hexx) {
    const hex = hexx.toString(); // force conversion
    let str = '';
    for (let i = 0; i < hex.length; i += 2) {
      str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }

    return str;
  }


  processHL7Data(rawText) {

    const that = this;
    const message = that.hl7parser.create(rawText);
    const msgID = message.get('MSH.10').toString();
    that.socketClient.write(that.hl7ACK(msgID));
    // let result = null;
    //console.log(message.get('OBX'));

    const obx = message.get('OBX').toArray();

    //obx.forEach(function (singleObx) {
    //  console.log(singleObx);
    //});

    const spm = message.get('SPM');
    let sampleNumber = 0;

    //console.log(obx[1]);
    spm.forEach(function (singleSpm) {
      //sampleNumber = (singleSpm.get(1).toInteger());
      //const singleObx = obx[(sampleNumber * 2) - 1]; // there are twice as many OBX .. so we take the even number - 1 OBX for each SPM
      const singleObx = obx[0]; // there are twice as many OBX .. so we take the even number - 1 OBX for each SPM

      //console.log(singleObx.get('OBX.19').toString());

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
      order.test_location = that.settings.labName;
      order.machine_used = that.settings.analyzerMachineName;

      if (order.results) {
        that.dbService.addOrderTest(order, (res) => {
          that.logger('success', 'Result Successfully Added : ' + order.test_id);
        }, (err) => {
          that.logger('error', 'Failed to add result : ' + order.test_id + ' ' + JSON.stringify(err));
        });
      } else {
        that.logger('error', 'Unable to store data into the database');
      }

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
      // order.test_location = this.settings.labName;
      // order.machine_used = this.settings.analyzerMachineName;
    });
  }

  handleTCPResponse(data) {
    const that = this;

    if (that.settings.interfaceCommunicationProtocol === 'hl7') {

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
        rData.machine = that.settings.analyzerMachineName;

        that.dbService.addRawData(rData, (res) => {
          that.logger('success', 'Raw data successfully saved');
        }, (err) => {
          that.logger('error', 'Not able to save raw data ' + JSON.stringify(err));
        });

        that.strData = that.strData.replace(/[\x0b\x1c]/g, '');
        that.strData = that.strData.trim();
        that.strData = that.strData.replace(/[\r\n\x0B\x0C\u0085\u2028\u2029]+/gm, '\r');

        that.processHL7Data(that.strData);
        that.strData = '';
      }


    } else if (that.settings.interfaceCommunicationProtocol === 'astm-elecsys') {

      that.logger('info', 'Processing ASTM Elecsys');

      const d = data.toString('hex');

      //this.logger('info',"HEX :" + d);
      //this.logger('info', "TEXT :" + that.hex2ascii(d));

      if (d === '04') {

        that.socketClient.write(that.ACK);
        that.logger('info', 'Received EOT. Ready to Process');
        //clearTimeout(that.timer);
        //this.logger('info',that.strData);

        // Let us store this Raw Data before we process it
        const rData: any = {};
        rData.data = that.strData;
        rData.machine = that.settings.analyzerMachineName;
        that.dbService.addRawData(rData, (res) => {
          that.logger('success', 'Raw data successfully saved');
        }, (err) => {
          that.logger('error', 'Not able to save raw data : ' + JSON.stringify(err));
        });

        that.logger('info', that.strData);
        that.processASTMElecsysData(that.strData);
        that.strData = "";
      } else if (d === '21') {
        that.socketClient.write(that.ACK);
        that.logger('error', 'NAK Received');
      } else {

        let text = that.hex2ascii(d);
        if (text.match(/^\d*H/)) {
          text = '##START##' + text;
        }
        that.strData += text;
        that.logger('info', 'Receiving....');
        that.socketClient.write(that.ACK);
      }
    } else if (that.settings.interfaceCommunicationProtocol === 'astm-concatenated') {

      that.logger('info', 'Processing ASTM Concatenated');

      const d = data.toString('hex');

      if (d === '04') {

        that.socketClient.write(that.ACK);

        that.logger('info', 'Received EOT. Ready to Process');
        //clearTimeout(that.timer);
        //this.logger('info',that.strData);

        // Let us store this Raw Data before we process it
        const rData: any = {};
        rData.data = that.strData;
        rData.machine = that.settings.analyzerMachineName;
        that.dbService.addRawData(rData, (res) => {
          that.logger('success', 'Raw data successfully saved');
        }, (err) => {
          that.logger('error', 'Not able to save raw data : ' + JSON.stringify(err));
        });

        that.processASTMConcatenatedData(that.strData);
        that.strData = "";
      } else if (d === '21') {
        that.socketClient.write(that.ACK);
        that.logger('error', 'NAK Received');
      } else {

        let text = that.hex2ascii(d);
        if (text.match(/^\d*H/)) {
          text = '##START##' + text;
        }
        that.strData += text;
        that.logger('info', that.strData);
        that.socketClient.write(that.ACK);
      }
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

  processASTMElecsysData(astmData: string) {

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


          console.warn(dataArray['O']);
          console.warn(dataArray['R']);

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
            order.test_location = that.settings.labName;
            order.machine_used = that.settings.analyzerMachineName;

            if (order.order_id) {
              that.logger('info', "Trying to add order :" + JSON.stringify(order));
              that.dbService.addOrderTest(order, (res) => {
                that.logger('success', 'Result Successfully Added : ' + order.order_id);
              }, (err) => {
                that.logger('error', 'Failed to add : ' + JSON.stringify(err));
              });
            } else {
              that.logger('error', "Could NOT add order :" + JSON.stringify(order));
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
        that.logger('error', "Could NOT add order :" + JSON.stringify(astmData));
      }
    });

  }

  processASTMConcatenatedData(astmData: string) {

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
            order.test_location = that.settings.labName;
            order.machine_used = that.settings.analyzerMachineName;

            if (order.order_id) {
              that.logger('info', "Trying to add order :" + JSON.stringify(order));
              that.dbService.addOrderTest(order, (res) => {
                that.logger('success', 'Result Successfully Added : ' + order.order_id);
              }, (err) => {
                that.logger('error', 'Failed to add : ' + JSON.stringify(err));
              });
            } else {
              that.logger('error', "Could NOT add order :" + JSON.stringify(order));
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

}
