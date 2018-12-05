import { Injectable } from '@angular/core';
import { Socket } from 'net';

import { OrderModel } from '../models/order.model'

@Injectable({
  providedIn: 'root'
})


export class CobasService {


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
  private socketClient = null;
  private orderModel = null;


  constructor() {

    const Store = require('electron-store');
    const store = new Store();

    this.settings = store.get('appSettings');

    this.connectopts = {
      port: this.settings.rochePort,
      host: this.settings.rocheHost
    }

    this.orderModel = new OrderModel;

  }

  connect() {
    let that = this;

    let client = new Socket();

    this.socketClient = client;

    client.connect(that.connectopts, function () {
      console.log('Connected');
    });

    client.on('data', function (data) {
      that.dataFeedBackTCP(client, data, false);
    });

    client.on('close', function () {
      console.log('Disconnected');
    });

    client.on('error', (e) => {
      console.log(e);
      if (e) {
        setTimeout(() => {
          client.connect(that.connectopts, function () {
            console.log('Connected again !');
            console.log("cobas ", "ConnectSerial Connected");

          });
        }, 15000);
      }
    })

  }

  disconnect() {
    this.socketClient.destroy();
    setTimeout(() => {
      this.connect();
    }, 1000);
  }



  hex2ascii(hexx) {
    var hex = hexx.toString();//force conversion
    var str = '';
    for (var i = 0; i < hex.length; i += 2)
      str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    return str;
  }


  dataFeedBackTCP(client, data, isServer) {

    var d = data.toString("hex");

    if (d === "04") {
      client.write(this.ACK);
      console.log("Cobas EOT", this.strData);
      if (this.settings.rocheConnectionType == 'server') {
        this.processServerData(this.strData);
      } else if (this.settings.rocheConnectionType == 'client') {
        this.processClientData(this.strData);
      }

      this.strData = "";
    } else if (d == "21") {
      client.write(this.ACK);
      console.log('NAK Received');
    } else {
      let text = this.hex2ascii(d);

      if (d === "02") text = "<STX>";
      if (d === "17") text = "<ETB>";
      if (d === "0D") text = "<CR>";
      if (d === "0A") text = "<LF>";
      if (d === "03") text = "<ETX>";
      if (d == "5E") text = "::";
      this.strData += text;
      console.log("Cobas_ACK_PPROCESS", this.strData);
      client.write(this.ACK);
    }

  }

  formatRawDate(rawDate) {
    let d = rawDate;
    if (rawDate != null) {
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

  processClientData(t) {
    //  console.log(t);
    let sp = t.split("R|1|");
    let r: any = {};
    let s = [];
    let u = [];
    if (sp[1]) {
      var sd = "1|" + sp[1];
      var ss = sp[0];
      console.log("SS " + ss);
      ss = ss.replace(/\u001707\r\n\u000221/g, "").replace(/\r\n/g, "").replace(/\rC/g, "").replace(/\u001767\u0002237/g, "")
        .replace(/\u0003BD/g, "").replace(/\u000309/g, "");
      sd = sd.replace(/\u001707\r\n\u000221/g, "").replace(/\r\n/g, "").replace("\rC", "").replace(/\u001767\u0002237/g, "")
        .replace(/\u0003BD/g, "").replace(/\u000309/g, "");
      s = sd.split("|");
      u = ss.split("|");
      // console.log(s);
      var l = s.length;
      r.leng = s.length;
      if (u[16]) r.lotNo = u[16];
      if (u[17]) {
        r.sampleID = u[17]; r.sampleID17 = u[17]
      };
      if (u[20]) r.orderDate = this.formatRawDate(u[20]);
      if (!r.sampleID && u[32]) r.lotNo = u[32];
      if (!r.sampleID && u[33]) r.sampleID = u[33];

      if (!r.orderDate && u[36]) r.orderDate = this.formatRawDate(u[36]);

      if (s[1]) r.test = s[1];
      if (s[2]) r.results = s[2];
      if (s[3]) r.unit = s[3];
      if (s[9]) r.operator = s[9];
      if (s[10]) r.timestamp2 = s[10];
      if (s[11]) r.timestamp = s[11];
      if (r.timestamp2) {
        if (r.timestamp2.length === 14) r.timestamp = r.timestamp2;
      }
      r.timestamp = this.formatRawDate(r.timestamp);
      // if(s[l-2]) r.sampleID=s[l-2];
      if (s[12]) r.machine = s[12];
      if (s[15]) r.status = s[15];
      let v = [];
      v.push(r.operator);
      v.push(r.unit);
      v.push(r.results);
      v.push(r.timestamp);
      v.push(r.orderDate);
      v.push(r.timestamp);
      v.push(this.settings.rocheMachine);
      v.push(this.settings.labName);
      v.push(0);
      v.push(r.sampleID);

      let vv = v;
      vv.push(r.test);
      vv.push(r.lotNo);
      console.log(vv);
      console.log("PROCCEES FEEDcobas", JSON.stringify(vv));
      this.orderModel.addOrderTestLog(vv, (res) => {
        console.log("cobas processAddResultLog ", "ResultLog Succesful Added : " + r.sampleID);
      }, (err) => {
        console.log("cobas processAddResultLog ", JSON.stringify(err), "error");
      });
      this.orderModel.addResults(v, (res) => {
        console.log("cobas processAddResult", "Result Successful Added : " + r.sampleID);
      }, (err) => {
        console.log("cobas processAddResult", JSON.stringify(err), "error");
      });


    }
    //console.log(r);
    return r;
  }



  processServerData(t) {
    var sp = t.split("O|1|");
    var dd: any = {};
    var out = [], resIn = [], resLog = [];
    var speDate = "", analysDate = "", acceptDate = "";
    for (var i = 0; i < sp.length; i++) {
      var v = [], vv = [];
      var p1 = [], p2 = [], sa = [];
      var spp = sp[i].split("R|1|");
      if (spp[0])
        p1 = spp[0].split("|");
      if (spp[1])
        p2 = spp[1].split("|");
      //get sample ID
      if (p1[0])
        sa = p1[0].split("^");
      if (sa[0])
        dd.sampleID = sa[0];
      if (p1[5] && p1[5].length == 14) speDate = this.formatRawDate(p1[5]);
      if (p2[9] && p2[9].length == 14) analysDate = this.formatRawDate(p2[9]);
      if (p2[10] && p2[10].length == 14) acceptDate = this.formatRawDate(p2[10]);
      dd.specimenDate = speDate;
      dd.testName = (p2[0]) ? p2[0].replace("^^^", "") : p2[0];
      var result0 = (p2[1]) ? p2[1].replace("cp/mL", "") : p2[1];
      var result1 = parseFloat(result0);
      var result = (result1) ? result1 : result0;
      var rres = result + "";
      if (rres && rres.toLowerCase().indexOf("target") != -1) result = "Target Not Detected";
      if (rres && rres.toLowerCase().indexOf("detected") != -1) result = "Target Not Detected";

      if (rres && rres.toLowerCase().indexOf("titer") != -1) {
        if (rres && (rres.toLowerCase().indexOf("min") != -1 || rres.toLowerCase().indexOf("<") != -1)) result = "<20";
        if (rres && (rres.toLowerCase().indexOf("max") != -1 || rres.toLowerCase().indexOf(">") != -1)) result = ">10000000";
      } //result="<20";

      dd.result = result;
      dd.unit = p2[2];
      dd.flag = p2[6];
      dd.analysDate = analysDate;
      dd.acceptDate = acceptDate;
      dd.operator = p2[8];

      v.push(dd.operator);
      v.push(dd.unit);
      v.push(result);
      v.push(analysDate);
      v.push(dd.specimenDate);
      v.push(acceptDate);
      v.push(this.settings.rocheMachine);
      v.push(this.settings.labName);
      v.push(0);
      v.push(dd.sampleID);
      //logs
      vv.push(dd.operator);
      vv.push(dd.unit);
      vv.push(result);
      vv.push(analysDate);
      vv.push(dd.specimenDate);
      vv.push(acceptDate);
      vv.push(this.settings.rocheMachine);
      vv.push(this.settings.labName);
      vv.push(0);
      vv.push(dd.sampleID);
      vv.push("HIVVL");
      vv.push("");
      console.log("Cobas48_resultLog ", JSON.stringify(vv));
      console.log("Cobas48_results ", JSON.stringify(v));
      if (dd.sampleID) {
        this.orderModel.addResults(v, (res) => {
          console.log("cobas48 processAddResult: ", "Result Succesful Added :" + dd.sampleID);
        }, (err) => {
          console.log("cobas48 processAddResult: ", JSON.stringify(err), "error");
          console.log("cobas48 processAddResult: ", JSON.stringify(v), "error");
        });
      }
      this.orderModel.addOrderTestLog(vv, (res) => {
        console.log("cobas48 processAddResultLog: ", "ResultLog Successful added: " + dd.sampleID);
      }, (err) => {

        console.log("cobas48 processAddResultLog: ", JSON.stringify(err), "error");
        console.log("cobas48 processAddResultLog: ", JSON.stringify(vv), "error");
      });
    }
  }


  insertData(data) {

  }

}
