import { Injectable } from '@angular/core';
import { DatabaseService } from './database.service';
import { LogDisplayService, LogEntry } from './log-display.service';

@Injectable({
  providedIn: 'root'
})
export class LoggingService {
  private logQueue: LogEntry[] = [];
  private isProcessing = false;
  private processingInterval = 10000; // Process queue every 10 seconds

  constructor(
    private dbService: DatabaseService,
    private logDisplayService: LogDisplayService
  ) {
    setInterval(() => this.processQueue(), this.processingInterval);
  }

  log(type: 'info' | 'success' | 'warn' | 'error' | 'verbose', message: string, instrumentId?: string) {
    const logEntry: LogEntry = { type, message, instrumentId, timestamp: new Date() };

    // Push to display immediately
    this.logDisplayService.log(logEntry);

    // Push to persistence queue
    this.logQueue.push(logEntry);
  }

  private async processQueue() {
    if (this.isProcessing || this.logQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const logsToProcess = this.logQueue.splice(0); // Process all logs in the queue

    try {
      await this.dbService.recordLogBatch(logsToProcess);
    } catch (error) {
      console.error('Failed to persist log batch:', error);
      // If persistence fails, you might want to add the logs back to the queue
      // this.logQueue.unshift(...logsToProcess);
    } finally {
      this.isProcessing = false;
    }
  }
}
