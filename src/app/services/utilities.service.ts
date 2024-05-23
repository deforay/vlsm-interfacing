import { Injectable } from '@angular/core';
import { DatabaseService } from './database.service';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { ElectronService } from '../core/services';

@Injectable({
  providedIn: 'root'
})

export class UtilitiesService {



  protected timer = null;
  protected logtext = [];

  protected logTextMap = new Map<string, BehaviorSubject<string[]>>();

  protected lastOrdersSubject = new BehaviorSubject([]);
  lastOrders = this.lastOrdersSubject.asObservable();

  protected lastrawDataSubject = new BehaviorSubject([]);
  lastrawData = this.lastrawDataSubject.asObservable();



  constructor(
    public electronService: ElectronService,
    public dbService: DatabaseService) {



  }








  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  hex2ascii(hexx) {
    const hex = hexx.toString(); // force conversion
    let str = '';
    for (let i = 0; i < hex.length; i += 2) {
      str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }

    return str;
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

  replaceControlCharacters(astmData) {
    const controlCharMap = {
      '\x05': '',
      '\x02': '',
      '\x03': '',
      '\x04': '',
      '\x17': '<ETB>',
      '\n': '<LF>',
      '\r': '<CR>'
    };

    // Replace control characters based on the mapping
    astmData = astmData.replace(/[\x05\x02\x03\x04\x17\n\r]/g, match => controlCharMap[match]);

    // Remove the transmission blocks
    return astmData.replace(/<ETB>\w{2}<CR><LF>/g, '');
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

  fetchrawData() {
    const that = this;
    that.dbService.fetchrawData((res) => {
      res = [res]; // converting it into an array
      that.lastrawDataSubject.next(res);
    }, (err) => {
      that.logger('error', 'Failed to fetch data ' + JSON.stringify(err));
    });
  }


  fetchRecentLogs(instrumentId = null) {
    this.dbService.fetchRecentLogs(instrumentId, (res) => {
      const logs = res.map(r => r.log); // Assuming r.log is the log message
      this.getInstrumentLogSubject(instrumentId).next(logs);
    }, (err) => {
      this.logger('error', 'Failed to fetch recent logs: ' + JSON.stringify(err));
    });
  }




  clearLiveLog(instrumentId = null) {
    if (instrumentId) {
      // Clear logs for a specific instrument
      const logSubject = this.getInstrumentLogSubject(instrumentId);
      logSubject.next([]);
    } else {
      // Clear logs for all instruments
      this.logTextMap.forEach((subject) => {
        subject.next([]);
      });
    }
  }

  reSyncRecord(orderId: string): Observable<any> {
    return of(this.dbService.reSyncRecord(orderId));
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

  getInstrumentLogSubject(instrumentId: string): BehaviorSubject<string[]> {
    if (!this.logTextMap.has(instrumentId)) {
      this.logTextMap.set(instrumentId, new BehaviorSubject<string[]>([]));
    }
    return this.logTextMap.get(instrumentId);
  }

  logger(logType = null, message = null, instrumentId = null) {
    const that = this;
    if (message) {
      const moment = require('moment');
      const date = moment(new Date()).format('DD-MMM-YYYY HH:mm:ss');
      let logFor = ` [${date}] `;
      if (instrumentId) {
        logFor = ` [${instrumentId}]  [${date}] `;
      }

      let logMessage = '';

      if (logType === 'info') {
        that.electronService.logInfo(message, instrumentId);
        logMessage = `<span class="text-info">[info]</span> ${logFor}${message}`;
      } else if (logType === 'error') {
        that.electronService.logError(message, instrumentId);
        logMessage = `<span class="text-danger">[error]</span> ${logFor}${message}`;
      } else if (logType === 'success') {
        that.electronService.logInfo(message, instrumentId);
        logMessage = `<span class="text-success">[success]</span> ${logFor}${message}`;
      } else if (logType === 'ignore') {
        logMessage = `${message}`;
      }

      //console.log(`${logFor}${message}`);

      //that.logtext[that.logtext.length] = logMessage;
      const logSubject = that.getInstrumentLogSubject(instrumentId);
      const currentLogs = logSubject.value;
      logSubject.next([logMessage, ...currentLogs]);

      if (logType !== 'ignore') {
        const dbLog: any = {};
        dbLog.log = logMessage;

        that.dbService.addApplicationLog(dbLog, (res) => { }, (err) => { });
      }
    }
  }

}
