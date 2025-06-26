import { Injectable } from '@angular/core';
import { DatabaseService } from './database.service';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { ElectronService } from '../core/services';

@Injectable({
  providedIn: 'root'
})

export class UtilitiesService {


  private readonly moment = require('moment');
  protected timer = null;
  protected logtext = [];

  protected logTextMap = new Map<string, BehaviorSubject<string[]>>();

  protected lastOrdersSubject = new BehaviorSubject([]);
  lastOrders = this.lastOrdersSubject.asObservable();


  protected lastrawDataSubject = new BehaviorSubject([]);
  lastrawData = this.lastrawDataSubject.asObservable();

  constructor(
    private readonly electronService: ElectronService,
    private readonly dbService: DatabaseService
  ) {
  }

  checkMysqlConnection(mysqlParams: { host: string, user: string, password: string, port: string }, successCallback: Function, errorCallback: Function): void {
    this.dbService.checkMysqlConnection(mysqlParams, successCallback, errorCallback);
  }


  resyncTestResultsToMySQL(success, errorf) {
    this.dbService.resyncTestResultsToMySQL(success, errorf);
  }

  syncLimsStatusToSQLite(success, errorf) {
    this.dbService.syncLimsStatusToSQLite(success, errorf);
  }

  sqlite3WalCheckpoint() {
    this.dbService.sqlite3WalCheckpoint();
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

  removeControlCharacters(astmData: string, withChecksum = true) {
    const controlCharMap = {
      '\x05': '',       // ENQ (Enquiry)
      '\x02': '',       // STX (Start of Text)
      '\x03': '<ETX>',  // ETX (End of Text)
      '\x04': '',       // EOT (End of Transmission)
      '\x17': '<ETB>',  // ETB (End of Transmission Block)
      '\n': '<CR>',     // Line Feed to <CR>
      '\r': '<CR>'      // Carriage Return to <CR>
    };

    // Replace control characters, but conditionally handle <ETB>
    astmData = astmData.replace(
      withChecksum ? /[\x05\x02\x03\x04\x17\n\r]/g : /[\x05\x02\x03\n\r]/g,
      match => controlCharMap[match]
    );

    // Replace consecutive <CR>
    astmData = astmData.replace(/(<CR>)+/g, '<CR>');

    // Conditionally remove checksums associated with <ETB> or <ETX>
    if (withChecksum) {
      // Match <ETB> or <ETX> followed by a 2-character checksum and optional <CR>
      astmData = astmData.replace(/<(ETB|ETX)>\w{2}(<CR>)?/g, '');
    }

    // Always remove remaining <ETX>
    astmData = astmData.replace(/<ETX>/g, ''); // Ensure <ETX> is removed completely

    return astmData;
  }


  fetchRecentResults(searchParam?: string) {
    const that = this;
    that.dbService.fetchRecentResults((res) => {
      res = [res];
      that.lastOrdersSubject.next(res);
    }, (err) => {
      that.logger('error', 'Failed to fetch recent results ' + JSON.stringify(err));
    }, searchParam);
  }


  fetchrawData(searchParam: string = '') {
    const that = this;
    this.dbService.fetchrawData((res) => {
      res = [res];
      that.lastrawDataSubject.next(res);
    }, (err) => {
      that.logger('error', 'Failed to fetch raw data ' + JSON.stringify(err));
    }, searchParam)
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
      callback(res[0]);
    }, (err) => {
      that.logger('error', 'Failed to fetch last sync time ' + JSON.stringify(err));
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
    if (!message) return;

    // Generate timestamp and format message
    const date = this.moment(new Date()).format('DD-MMM-YYYY HH:mm:ss');
    let logFor = ` [${date}] `;
    if (instrumentId) {
      logFor = ` [${instrumentId}] [${date}] `;
    }

    let logMessage = '';
    if (logType === 'info') {
      that.electronService.logInfo(message, instrumentId);
      logMessage = `<span style="color:rgb(129, 209, 247) !important;">[info]</span>${logFor}${message}`;
    } else if (logType === 'error') {
      that.electronService.logError(message, instrumentId);
      logMessage = `<span style="color: #ff5252 !important;">[error]</span>${logFor}${message}`;
    } else if (logType === 'success') {
      that.electronService.logInfo(message, instrumentId);
      logMessage = `<span style="color: #00e676 !important;">[success]</span>${logFor}${message}`;
    } else if (logType === 'ignore') {
      logMessage = `${message}`;
    } else if (logType === 'warn') {
      that.electronService.logWarning(message, instrumentId);
      logMessage = `<span style="color:orange !important;">[warn]</span>${logFor}${message}`;
    }


    // Update UI immediately
    const logSubject = that.getInstrumentLogSubject(instrumentId);
    const currentLogs = logSubject.value;
    logSubject.next([logMessage, ...currentLogs]);

    // THE ONLY CHANGE: Make database logging async
    if (logType !== 'ignore') {
      process.nextTick(() => {
        const dbLog: any = { log: logMessage };
        that.dbService.recordConsoleLogs(dbLog, () => { }, () => { });
      });
    }
  }

}
