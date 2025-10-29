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

  decodeHtmlEntities(text: string): string {
    if (!text || typeof text !== 'string') return text;

    // Only decode if HTML entities are detected
    if (text.includes('&')) {
      return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');
    }
    return text;
  }

  /**
 * Formats raw date strings from medical instruments (YYYYMMDD or YYYYMMDDHHmmss format)
 * @param rawDate Raw date string from instrument
 * @returns Formatted date string (YYYY-MM-DD HH:mm:ss) or null if invalid
 */
  /**
 * Universal date formatter - handles raw instrument dates, ISO dates, Date objects, and more
 * @param rawDate Date in any format (YYYYMMDD, YYYYMMDDHHmmss, ISO string, Date object, etc.)
 * @param outputFormat Optional output format (defaults to 'YYYY-MM-DD HH:mm:ss')
 * @returns Formatted date string or null if invalid
 */
  formatRawDate(rawDate: string | Date | null | undefined, outputFormat: string = 'YYYY-MM-DD HH:mm:ss'): string | null {
    // Early return for falsy values
    if (!rawDate) {
      return null;
    }

    try {
      let momentDate;

      // Handle Date objects directly
      if (rawDate instanceof Date) {
        momentDate = this.moment(rawDate);
      }
      // Handle strings
      else if (typeof rawDate === 'string') {
        const trimmed = rawDate.trim();

        if (trimmed === '') {
          return null;
        }

        // Define all possible input formats
        const formats = [
          // Raw instrument formats (most specific first)
          'YYYYMMDDHHmmss',     // 20250110111212
          'YYYYMMDDHHmm',       // 202501101112
          'YYYYMMDD',           // 20250110

          // ISO and common formats
          'YYYY-MM-DD HH:mm:ss',
          'YYYY-MM-DDTHH:mm:ss',
          'YYYY-MM-DDTHH:mm:ssZ',
          'YYYY-MM-DD',

          // Other common formats
          'DD-MMM-YYYY HH:mm:ss',
          'DD/MM/YYYY HH:mm:ss',
          'MM/DD/YYYY HH:mm:ss',
        ];

        // Try strict parsing with known formats first
        momentDate = this.moment(trimmed, formats, true);

        // If strict parsing fails, try lenient parsing as fallback
        if (!momentDate.isValid()) {
          momentDate = this.moment(trimmed);
        }
      } else {
        // Unsupported type
        return null;
      }

      // Validate the parsed date
      if (!momentDate.isValid()) {
        this.logger('warn', `Invalid date - failed validation: ${rawDate}`, null);
        return null;
      }

      // Return in requested format
      return momentDate.format(outputFormat);
    } catch (error) {
      this.logger('error', `Error parsing date: ${rawDate} - ${error}`, null);
      return null;
    }
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
    const trimmedSearchParam = (searchParam || '').trim();

    console.log('UtilitiesService.fetchRecentResults called with:', {
      original: `"${searchParam}"`,
      trimmed: `"${trimmedSearchParam}"`,
      isEmpty: trimmedSearchParam === ''
    });

    // Pass empty string if trimmed search is empty, otherwise pass trimmed value
    const finalSearchParam = trimmedSearchParam === '' ? '' : trimmedSearchParam;

    that.dbService.fetchRecentResults((res) => {
      console.log('Database returned results:', res?.length || 0, 'records for search:', `"${finalSearchParam}"`);

      // Log first few results to see if search is working
      if (res && res.length > 0) {
        console.log('Sample results:', res.slice(0, 3).map(r => r.order_id));
      }

      res = [res];
      that.lastOrdersSubject.next(res);
    }, (err) => {
      console.error('Failed to fetch recent results:', err);
      that.logger('error', 'Failed to fetch recent results ' + JSON.stringify(err));
    }, finalSearchParam);
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
      setTimeout(() => {
        const dbLog: any = { log: logMessage };
        that.dbService.recordConsoleLogs(dbLog, () => { }, () => { });
      }, 0);
    }
  }

  humanReadableDateTime(date: Date | string | null): string {
    if (!date) {
      return '';
    }

    return this.formatRawDate(date, 'DD-MMM-YYYY HH:mm:ss') || '';
  }

}
