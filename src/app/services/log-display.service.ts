import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { DatabaseService } from './database.service';

export interface LogEntry {
  type: 'info' | 'success' | 'warn' | 'error' | 'verbose';
  message: string;
  instrumentId?: string;
  timestamp: Date;
}

@Injectable({
  providedIn: 'root'
})
export class LogDisplayService {
  private logSubject = new Subject<LogEntry>();
  private clearLogSubject = new Subject<string | null>();

  log$ = this.logSubject.asObservable();
  clear$ = this.clearLogSubject.asObservable();

  constructor(private dbService: DatabaseService) { }

  loadInitialLogs(instrumentId: string, limit: number = 100) {
    this.dbService.fetchRecentLogs(instrumentId, limit).subscribe(logs => {
      // Sort logs by timestamp ascending before emitting
      logs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      logs.forEach(log => this.logSubject.next(log));
    });
  }

  log(logEntry: LogEntry) {
    this.logSubject.next(logEntry);
  }

  clearLogs(instrumentId?: string) {
    this.clearLogSubject.next(instrumentId);
  }
}
