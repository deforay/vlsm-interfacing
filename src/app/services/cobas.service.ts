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

  public socketClient = null;
  public server = null;

  public connectionTries = 0;
  public hl7parser = require("hl7parser");


  constructor() {

    this.orderModel = new OrderModel;
    this.rawDataModel = new RawDataModel;

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
    var date = moment(new Date()).format('YYYYMMDDhms');;

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
      console.log('Trying to create a server connection');
      that.server = that.net.createServer(function (socket) {
        // confirm socket connection from client
        console.log((new Date()) + 'A client has connected to this server');
        that.connectionStatus(true);
        that.socketClient = socket;
        socket.on('data', function (data) {

          that.handleTCPResponse(data);


        });
      }).listen(that.settings.rochePort, that.settings.rocheHost);


      this.server.on('error', function (e) {
        that.connectionStatus(false);
        that.stopTryingStatus(true);
        console.log('Error while connecting ' + e.code);
      });

    } else if (that.settings.rocheConnectionType == "tcpclient") {


      that.socketClient = new Socket();
      this.connectopts = {
        port: this.settings.rochePort,
        host: this.settings.rocheHost
      }



      console.log('Roche Cobas - Trying to connect as client');
      this.connectionTries++; // incrementing the connection tries

      that.socketClient.connect(that.connectopts, function () {
        this.connectionTries = 0; // resetting connection tries to 0
        that.connectionStatus(true);
        console.log('Roche Cobas - Connected as client');
      });

      that.socketClient.on('data', function (data) {
        that.connectionStatus(true);
        that.handleTCPResponse(data);
      });

      that.socketClient.on('close', function () {
        that.socketClient.destroy();
        that.connectionStatus(false);
        console.log('Roche Cobas - Client Disconnected');
      });

      that.socketClient.on('error', (e) => {
        that.connectionStatus(false);
        that.stopTryingStatus(true);
        console.log(e);
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
        console.log('Disconnected');
      }

    } else {
      if (this.server) {
        this.socketClient.destroy();
        this.server.close();
        this.connectionStatus(false);
        console.log('Disconnected');
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

    // Let us store this Raw Data before we process it
    var rData: any = {};
    rData.data = rawText;
    rData.machine = this.settings.rocheMachine;
    this.rawDataModel.addRawData(rData, (res) => {
      console.log("Raw Data successfully added");
    }, (err) => {
      console.log("Not able to save Raw Data", JSON.stringify(err), "error");
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
        console.log("Result Successfully Added : " + order.order_id);
      }, (err) => {
        console.log("cobas add result : ", JSON.stringify(err), "error");
      });
    } else {
      console.log("Unable to store data into the database");
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

  handleTCPResponse(data) {


    if (this.settings.rocheProtocol === 'hl7') {

      //console.log('INSIDE HL7 IF');
      this.parseHl7Data(data);

    } else if (this.settings.rocheProtocol === 'astm') {

      //console.log('INSIDE ASTM ELSE IF');

      let that = this;
      var d = data.toString("hex");

      //console.log(d);

      if (d === "04") {
        that.socketClient.write(that.ACK);
        
        console.log('READY TO SEND');
        //console.log(that.strData);

        // Let us store this Raw Data before we process it
        var rData: any = {};
        rData.data = that.strData;
        rData.machine = that.settings.rocheMachine;
        this.rawDataModel.addRawData(rData, (res) => {
          console.log("Raw Data successfully added");
        }, (err) => {
          console.log("Not able to save Raw Data", JSON.stringify(err), "error");
        });



        that.processASTMData(that.strData);
        that.strData = "";
      } else if (d == "21") {
        that.socketClient.write(that.ACK);
        console.log('NAK Received');
      } else {
        let text = that.hex2ascii(d);

        if (d === "02") {
          // if(that.strData != ''){
          //   that.processASTMData(that.strData);
          //   that.strData = '';
          // }
          text = "<STX>";
        }
        else if (d === "17") text = "<ETB>"
        else if (d === "0D") text = "<CR>"
        else if (d === "0A") text = "<LF>"
        else if (d === "03") text = "<ETX>"
        else if (d == "5E") text = "::";
        that.strData += text;
        //console.log("Cobas_ACK_PPROCESS", that.strData);
        that.socketClient.write(that.ACK);
      }
    }
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

    //console.log(astmData);

    let that = this;

    let fullDataArray = astmData.split('<STX>');

    fullDataArray.forEach(function (partData) {
      
      let data = partData.replace(/[\x05\x02\x03]/g, '');

      let astmArray = data.split(/\r?\n/);

      let dataArray = []

      astmArray.forEach(function (element) {
        if (element != '') {
          
          if(dataArray[element.substring(1, 2)] == undefined){
            dataArray[element.substring(1, 2)] = element.split("|");
          }else{
            var arr = element.split("|");
            arr.shift();
            dataArray[element.substring(1, 2)] += arr;
          }
          
        }
      });

      console.log(dataArray);

      var order: any = {};

      order.order_id = dataArray['O'][3];
      order.test_id = dataArray['O'][2];
      order.test_type = (dataArray['R'][2]) ? dataArray['R'][2].replace("^^^", "") : dataArray['R'][2];
      order.test_unit = dataArray['R'][4];
      order.raw_text = astmData;
      order.results = dataArray['R'][3];
      order.tested_by = dataArray['R'][10];
      order.result_status = 1;
      order.analysed_date_time = that.formatRawDate(dataArray['R'][12]);
      order.lims_sync_status = 0;
      order.authorised_date_time = that.formatRawDate(dataArray['R'][12]);
      order.result_accepted_date_time = that.formatRawDate(dataArray['R'][12]);
      order.test_location = that.settings.labName;
      order.machine_used = that.settings.rocheMachine;

      if (order.order_id) {
        console.log("Trying to add order :", JSON.stringify(order));
        that.orderModel.addOrderTest(order, (res) => {
          console.log("Result Successfully Added : " + order.order_id);
        }, (err) => {
          console.log("ADDING FAILED", JSON.stringify(err), "error");
        });
      }
    });
          
  }


  fetchLastOrders(){   
    let that = this; 
    that.orderModel.fetchLastOrders((res) => {
      res = [res]; // converting it into an array
      that.lastOrdersSubject.next(res);
    }, (err) => {
      console.log("ADDING FAILED", JSON.stringify(err), "error");
    });

    
    
  }

}
