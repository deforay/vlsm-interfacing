import { Injectable } from '@angular/core';




import { Socket } from 'net';

import { OrderModel } from '../models/order.model'
import { RawDataModel } from '../models/rawdata.model'
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})


export class CobasService {


  private net = require('net');
  //private serialConnection = null;  

  private statusSubject = new BehaviorSubject(false);
  currentStatus = this.statusSubject.asObservable();

  private connectionTriesSubject = new BehaviorSubject(false);
  stopTrying = this.connectionTriesSubject.asObservable();

  private lastOrdersSubject = new BehaviorSubject([]);
  lastOrders = this.lastOrdersSubject.asObservable();

  private liveLogSubject = new BehaviorSubject([]);
  liveLog = this.liveLogSubject.asObservable();
  private logtext = [];

  private ACK = Buffer.from('06', 'hex');
  private ENQ = Buffer.from('05', 'hex');
  private SOH = Buffer.from('01', 'hex');
  private STX = Buffer.from('02', 'hex');
  private ETX = Buffer.from('03', 'hex');
  private EOT = Buffer.from('04', 'hex');
  private CR = Buffer.from('13', 'hex');
  private LF = Buffer.from('10', 'hex');
  private NAK = Buffer.from('21', 'hex');

  private strData: string = '';
  private connectopts: any = null;
  private settings = null;
  private orderModel = null;
  private rawDataModel = null;
  private timer = null;

  public socketClient = null;
  public server = null;

  public connectionTries = 0;
  public hl7parser = require("hl7parser");

  private log = null;



  constructor() {

    this.orderModel = new OrderModel;
    this.rawDataModel = new RawDataModel;
    this.log = require('electron-log');
    //console.log(this.log.findLogPath());

  }

  // Method used to track machine connection status
  connectionStatus(isRocheConnected: boolean) {
    this.statusSubject.next(isRocheConnected);
  }

  // Method used to track machine connection status
  stopTryingStatus(stopTrying: boolean) {
    this.connectionTriesSubject.next(stopTrying);
  }

  hl7ACK(messageID) {

    if (!messageID || messageID == "") {
      messageID = Math.random();
    }

    var moment = require('moment');
    var date = moment(new Date()).format('YYYYMMDDHHmmss');;

    let ack = String.fromCharCode(11) + "MSH|^~\&|LIS||COBAS6800/8800||" + date + "||ACK^R22|ACK-R22-" + date + "||2.5||||||8859/1" + String.fromCharCode(13);
    ack += "MSA|AA|" + messageID + String.fromCharCode(13) + String.fromCharCode(28) + String.fromCharCode(13);

    return ack;
  }


  // Method used to connect to the Roche Machine
  connect() {

    let that = this;

    const Store = require('electron-store');
    const store = new Store();
    this.settings = store.get('appSettings');


    if (that.settings.rocheConnectionType == "tcpserver") {
      that.logger('info', 'Trying to create a server connection');
      that.server = that.net.createServer(function (socket) {
        // confirm socket connection from client
        that.logger('info', (new Date()) + ' - a client has connected to this server');
        that.connectionStatus(true);
        that.socketClient = socket;
        socket.on('data', function (data) {
          that.handleTCPResponse(data);
        });
      }).listen(that.settings.rochePort, that.settings.rocheHost);


      this.server.on('error', function (e) {
        that.connectionStatus(false);
        that.stopTryingStatus(true);
        that.logger('error', 'Error while connecting ' + e.code);
      });

    } else if (that.settings.rocheConnectionType == "tcpclient") {

      that.socketClient = new Socket();
      this.connectopts = {
        port: this.settings.rochePort,
        host: this.settings.rocheHost
      }

      this.logger('info', 'Trying to connect as client');
      this.connectionTries++; // incrementing the connection tries

      that.socketClient.connect(that.connectopts, function () {
        this.connectionTries = 0; // resetting connection tries to 0
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
        that.stopTryingStatus(true);
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
    const Store = require('electron-store');
    const store = new Store();
    this.settings = store.get('appSettings');

    if (this.settings.rocheConnectionType == "tcpclient") {
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
    var hex = hexx.toString();//force conversion
    var str = '';
    for (var i = 0; i < hex.length; i += 2)
      str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    return str;
  }


  parseHl7Data(data) {
    let d = data.toString("hex");
    let rawText = this.hex2ascii(d);
    let order: any = {};
    let that = this;

    // Let us store this Raw Data before we process it
    var rData: any = {};
    rData.data = rawText;
    rData.machine = this.settings.rocheMachine;
    this.rawDataModel.addRawData(rData, (res) => {
      that.logger('success', "Raw Data successfully added");
    }, (err) => {
      that.logger('error', "Not able to save Raw Data " + JSON.stringify(err));
    });


    order.raw_text = rawText;

    rawText = rawText.replace(/[\x0b\x1c]/g, '');
    rawText = rawText.trim();
    rawText = rawText.replace(/[\r\n\x0B\x0C\u0085\u2028\u2029]+/gm, "\r");

    var message = this.hl7parser.create(rawText);
    var msgID = message.get("MSH.10").toString();
    this.socketClient.write(this.hl7ACK(msgID));

    //var result = null;
    var resultOutcome = message.get('OBX').get(2).get('OBX.5.1').toString();

    order.order_id = message.get('SPM.2').toString();
    order.test_id = message.get('SPM.2').toString();
    order.test_type = 'HIVVL';

    if (resultOutcome == 'Titer') {
      order.test_unit = message.get('OBX').get(0).get('OBX.6.1').toString();
      order.results = message.get('OBX').get(0).get('OBX.5.1').toString();
    } else if (resultOutcome == '< Titer min') {
      order.test_unit = '';
      order.results = '< Titer min';
    } else if (resultOutcome == '> Titer max') {
      order.test_unit = '';
      order.results = '> Titer max';
    } else if (resultOutcome == 'Target Not Detected') {
      order.test_unit = '';
      order.results = 'Target Not Detected';
    } else if (resultOutcome == 'Invalid') {
      order.test_unit = '';
      order.results = 'Invalid';
    } else {
      order.test_unit = message.get('OBX').get(0).get('OBX.6.1').toString();
      order.results = resultOutcome;
    }

    order.tested_by = message.get('OBX').get(0).get('OBX.16').toString();
    order.result_status = 1;
    order.lims_sync_status = 0;
    order.analysed_date_time = this.formatRawDate(message.get('OBX').get(0).get('OBX.19').toString());
    //order.specimen_date_time = this.formatRawDate(message.get('OBX').get(0).get('OBX.19').toString());
    order.authorised_date_time = this.formatRawDate(message.get('OBX').get(0).get('OBX.19').toString());
    order.result_accepted_date_time = this.formatRawDate(message.get('OBX').get(0).get('OBX.19').toString());
    order.test_location = this.settings.labName;
    order.machine_used = this.settings.rocheMachine;

    if (order.results) {
      this.orderModel.addOrderTest(order, (res) => {
        that.logger('success', "Result Successfully Added : " + order.order_id);
      }, (err) => {
        that.logger('error', "Failed to add result : " + JSON.stringify(err));
      });
    } else {
      that.logger('error', "Unable to store data into the database");
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
    // order.machine_used = this.settings.rocheMachine;    
  }

  forceSaveRawData(t) {
    let that = this;
    // Let us store this Raw Data before we process it
    var rData: any = {};
    rData.data = t.strData;
    rData.machine = 'MACHINE';
    let rawDataModel = new RawDataModel;
    rawDataModel.addRawData(rData, (res) => {
      that.logger('success', "Raw Data successfully added - forced");
    }, (err) => {
      that.logger('error', "Not able to save Raw Data - forced" + JSON.stringify(err));
    });

    t.processASTMData(t.strData)
  }

  handleTCPResponse(data) {

    if (this.timer != null) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(this.forceSaveRawData, 5000, this);

    // this.logger('info',this.timer);
    //}else{
    //  clearTimeout(this.timer);
    //}



    if (this.settings.rocheProtocol === 'hl7') {

      this.logger('info','Processing HL7');
      this.parseHl7Data(data);

    } else if (this.settings.rocheProtocol === 'astm') {

      this.logger('info','Processing ASTM');

      let that = this;
      var d = data.toString("hex");

      //this.logger('info',"HEX :" + d);
      //this.logger('info', "TEXT :" + that.hex2ascii(d));

      if (d === "04") {

        that.socketClient.write(that.ACK);

        this.logger('info', 'Received EOT. READY TO SEND');
        clearTimeout(that.timer);
        //this.logger('info',that.strData);

        // Let us store this Raw Data before we process it
        var rData: any = {};
        rData.data = that.strData;
        rData.machine = that.settings.rocheMachine;
        this.rawDataModel.addRawData(rData, (res) => {
          that.logger('success', "Raw Data successfully added");
        }, (err) => {
          that.logger('error', "Not able to save Raw Data : " + JSON.stringify(err));
        });

        that.processASTMData(that.strData);
        that.strData = "";
      } else if (d == "21") {
        that.socketClient.write(that.ACK);
        that.logger('error', 'NAK Received');
      } else {

        let text = that.hex2ascii(d);
        if (d === "02") text = "<STX>"
        //else if (d === "05") text = "<ENQ>"
        else if (d === "17") text = "<ETB>"
        else if (d === "0D") text = "<CR>"
        else if (d === "0A") text = "<LF>"
        else if (d === "03") text = "<ETX>"
        else if (d == "5E") text = "::";

        if (text.includes("H|")) {
          text = '##START##' + text
        }

        that.strData += text;
        that.logger('info', that.strData);
        that.socketClient.write(that.ACK);
      }
    }
  }

  array_key_exists (key, search) { // eslint-disable-line camelcase
    //  discuss at: http://locutus.io/php/array_key_exists/
    // original by: Kevin van Zonneveld (http://kvz.io)
    // improved by: Felix Geisendoerfer (http://www.debuggable.com/felix)
    //   example 1: array_key_exists('kevin', {'kevin': 'van Zonneveld'})
    //   returns 1: true
  
    if (!search || (search.constructor !== Array && search.constructor !== Object)) {
      return false
    }
  
    return key in search
  }  

  formatRawDate(rawDate) {
    let d = rawDate;
    if (!rawDate) {
      let len = rawDate.length;

      let year = rawDate.substring(0, 4);
      let month = rawDate.substring(4, 6);
      let day = rawDate.substring(6, 8);
      d = year + "-" + month + "-" + day;
      if (len > 9) {
        let h = rawDate.substring(8, 10);
        let m = rawDate.substring(10, 12);
        let s = "00";
        if (len > 11)
          s = rawDate.substring(12, 14);
        d += " " + h + ":" + m + ":" + s;
      }

    }
    return d;
  }

  processASTMData(astmData) {

    //this.logger('info',astmData);

    let that = this;
    let fullDataArray = astmData.split('##START##');

    //that.logger('info',"AFTER SPLITTING USING ##START##");
    //this.logger('info',fullDataArray);

    fullDataArray.forEach(function (partData) {
      let data = partData.replace(/[\x05\x02\x03]/g, '');
      let astmArray = data.split(/\r?\n/);
      let dataArray = []

      astmArray.forEach(function (element) {
        if (element != '') {

          if (dataArray[element.substring(1, 2)] == undefined) {
            dataArray[element.substring(1, 2)] = element.split("|");
          } else {
            var arr = element.split("|");
            arr.shift();
            dataArray[element.substring(1, 2)] += arr;
          }

        }
      });
      // this.logger('info',dataArray);
      //this.logger('info',dataArray['R']);

      if (dataArray === []) {
        that.logger('info', 'dataArray blank');
        return;
      }

      var order: any = {};

      try {

        if (that.array_key_exists('R', dataArray) && typeof dataArray['R'] == 'string') {
          dataArray['R'] = dataArray['R'].split(",");
        }

        if (that.array_key_exists('O', dataArray) && typeof dataArray['O'] == 'string') {
          dataArray['O'] = dataArray['O'].split(",");
        }

        if (that.array_key_exists('C', dataArray) && typeof dataArray['C'] == 'string') {
          dataArray['C'] = dataArray['C'].split(",");
        } 

        console.log(dataArray);
        // this.logger('info',typeof dataArray['O']);
        //
        //dataArray['O'] = dataArray['O'].split(",");
        // this.logger('info',JSON.stringify(dataArray));
        // this.logger('info',JSON.stringify(dataArray['R']));

        // this.logger('info','Result in position 3 ' + dataArray['R'][3]);
        // this.logger('info','Unit in position 2' + dataArray['R'][2]);
        // this.logger('info','tested_by in position 10' + dataArray['R'][10]);


        if(dataArray['O'] !== undefined && dataArray['O']  != []){
          order.order_id = dataArray['O'][3];
          order.test_id = dataArray['O'][2];
          if(dataArray['R'] !== undefined && dataArray['R']  != []){
            order.test_type = (dataArray['R'][2]) ? dataArray['R'][2].replace("^^^", "") : dataArray['R'][2];
            order.test_unit = dataArray['R'][4];
            order.results = dataArray['R'][3];
            order.tested_by = dataArray['R'][10];
            order.analysed_date_time = that.formatRawDate(dataArray['R'][12]);
            order.authorised_date_time = that.formatRawDate(dataArray['R'][12]);
            order.result_accepted_date_time = that.formatRawDate(dataArray['R'][12]);
          }else{
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
          order.machine_used = that.settings.rocheMachine;
  
          if (order.order_id) {
            //that.logger('info',"Trying to add order :", JSON.stringify(order));
            that.orderModel.addOrderTest(order, (res) => {
              that.logger('success', "Result Successfully Added : " + order.order_id);
            }, (err) => {
              that.logger('error', "Failed to add : " + JSON.stringify(err));
            });
          }          
        }
        
      }
      catch (error) {
        that.logger("error",error);
        console.error(error);
        return;

      }

      //if (dataArray == undefined || dataArray['0'] == undefined || dataArray['O'][3] == undefined || dataArray['O'][3] == null || dataArray['O'][3] == '') return;
      //if (dataArray == undefined || dataArray['R'] == undefined || dataArray['R'][2] == undefined || dataArray['R'][2] == null || dataArray['R'][2] == '') return;


    });

  }


  fetchLastOrders() {
    let that = this;
    that.orderModel.fetchLastOrders((res) => {
      res = [res]; // converting it into an array
      that.lastOrdersSubject.next(res);
    }, (err) => {
      that.logger('error', "Failed to fetch data " + JSON.stringify(err));
    });
  }


  logger(logType, message) {
    let that = this;
    var moment = require('moment');
    var date = moment(new Date()).format('DD-MMM-YYYY HH:mm:ss');
    if (logType == 'info') {
      that.log.info(message);
      that.logtext[that.logtext.length] = "<span class='text-info'>[info]</span> [" + date + "] " + message + "<br>"
    } else if (logType == 'error') {
      that.log.error(message);
      that.logtext[that.logtext.length] = "<span class='text-danger'>[error]</span> [" + date + "] " + message + "<br>"
    } else if (logType == 'success') {
      that.log.info(message);
      that.logtext[that.logtext.length] = "<span class='text-success'>[success]</span> [" + date + "] " + message + "<br>"
    }
    that.liveLogSubject.next(that.logtext);
  }

}
