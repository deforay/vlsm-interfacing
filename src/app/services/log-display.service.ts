import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export interface LogEntry {
  type: 'info' | 'success' | 'warn' | 'error' | 'verbose';
  message: string;
  instrumentId?: string;
  timestamp: Date;
  category?: 'operational' | 'system' | 'database' | 'migration';
  displayInConsole?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class LogDisplayService {
  private logSubject = new Subject<LogEntry>();
  private clearLogSubject = new Subject<string | null>();

  log$ = this.logSubject.asObservable();
  clear$ = this.clearLogSubject.asObservable();

  log(logEntry: LogEntry) {
    if (logEntry.displayInConsole === false) {
      return;
    }

    this.logSubject.next(logEntry);
  }

  clearLogs(instrumentId?: string) {
    this.clearLogSubject.next(instrumentId);
  }
}
