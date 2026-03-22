import { Injectable, Injector } from '@angular/core';
import { LogDisplayService, LogEntry } from './log-display.service';
import { ElectronService } from '../core/services';

export interface LogOptions {
  category?: LogEntry['category'];
  displayInConsole?: boolean;
  persist?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class LoggingService {
  private logQueue: LogEntry[] = [];
  private isProcessing = false;
  private processingInterval = 10000; // Process queue every 10 seconds
  private databaseServicePromise: Promise<any> | null = null;

  constructor(
    private injector: Injector,
    private logDisplayService: LogDisplayService,
    private electronService: ElectronService
  ) {
    setInterval(() => this.processQueue(), this.processingInterval);
  }

  log(
    type: 'info' | 'success' | 'warn' | 'error' | 'verbose',
    message: string,
    instrumentId?: string,
    options: LogOptions = {}
  ) {
    const logEntry: LogEntry = {
      type,
      message,
      instrumentId,
      timestamp: new Date(),
      category: options.category ?? 'operational',
      displayInConsole: options.displayInConsole ?? true
    };

    // Push to display immediately
    this.logDisplayService.log(logEntry);

    if (this.electronService?.isElectron) {
      if (type === 'error') {
        this.electronService.logError(message, instrumentId);
      } else if (type === 'warn') {
        this.electronService.logWarning(message, instrumentId);
      } else {
        this.electronService.logInfo(message, instrumentId);
      }
    }

    // WHY: internal/system failures should still be queryable after the fact
    // even when we intentionally suppress them from the live operator console.
    if (options.persist !== false) {
      this.logQueue.push(logEntry);
    }
  }

  logSystemError(message: string, instrumentId?: string, displayInConsole: boolean = false) {
    this.log('error', message, instrumentId, {
      category: 'system',
      displayInConsole
    });
  }

  private async processQueue() {
    if (this.isProcessing || this.logQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const logsToProcess = this.logQueue.splice(0); // Process all logs in the queue

    try {
      const dbService = await this.getDatabaseService();
      await dbService.recordLogBatch(logsToProcess);
    } catch (error) {
      console.error('Failed to persist log batch:', error);
      // If persistence fails, you might want to add the logs back to the queue
      // this.logQueue.unshift(...logsToProcess);
    } finally {
      this.isProcessing = false;
    }
  }

  private async getDatabaseService(): Promise<any> {
    if (!this.databaseServicePromise) {
      // WHY: DatabaseService also logs operational failures. Lazy loading avoids
      // a circular module dependency during startup.
      this.databaseServicePromise = import('./database.service')
        .then(({ DatabaseService }) => this.injector.get(DatabaseService));
    }

    return this.databaseServicePromise;
  }
}
