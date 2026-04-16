import { Injectable } from '@angular/core';

interface MySQLConnection {
  query: (q: string, args: any, cb: (err: any, res?: any) => void) => void;
  release: () => void;
}

interface MySQLPool {
  query: MySQLConnection['query'];
  getConnection: (cb: (err: any, conn: MySQLConnection) => void) => void;
  on: (event: string, handler: Function) => void;
}

interface MySQLClient {
  createPool: (config: any) => MySQLPool;
  createConnection: (config: any) => {
    connect: (cb: (err: any | null) => void) => void;
    query: (q: string, cb: (err: any, res?: any) => void) => void;
    destroy: () => void;
  };
}

@Injectable({
  providedIn: 'root'
})
export class ElectronService {
  ipcRenderer: any;
  webFrame: any;
  childProcess: any;
  fs: any;
  mysql: MySQLClient;
  net: any;

  constructor() {
    const that = this;

    if (that.isElectron) {
      that.ipcRenderer = window.require('electron').ipcRenderer;
      that.webFrame = window.require('electron').webFrame;
      that.childProcess = window.require('child_process');
      that.fs = window.require('fs');
      that.net = window.require('net');

      // Simplified MySQL implementation
      that.mysql = {
        createPool: (config) => ({
          on: () => { },
          query: (q, args, cb) => this.executeQuery(config, q, args, cb),
          getConnection: (cb) => {
            const connection = {
              query: (q, args, cb2) => this.executeQuery(config, q, args, cb2),
              release: () => { }
            };
            cb(null, connection);
          }
        }),
        createConnection: (config) => ({
          connect: (cb) => this.testConnection(config, cb),
          query: (q, cb) => this.executeQuery(config, q, [], cb),
          destroy: () => { }
        })
      };
    }
  }

  private sanitizeConfig(config: any) {
    return {
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      connectionLimit: config.connectionLimit,
      waitForConnections: config.waitForConnections,
      queueLimit: config.queueLimit
    };
  }

  private createMySQLError(err: any): any {
    if (typeof err === 'string') {
      return { message: err, code: 'UNKNOWN_ERROR' };
    }

    if (err && typeof err === 'object') {
      return {
        message: err.message || 'MySQL error',
        code: err.code || 'UNKNOWN_ERROR'
      };
    }

    return { message: 'Unknown MySQL error', code: 'UNKNOWN_ERROR' };
  }

  private executeQuery(config: any, query: string, args: any, callback: (err: any, res?: any) => void) {
    try {
      this.ipcRenderer.invoke('mysql-query', this.sanitizeConfig(config), query, args)
        .then(res => callback(null, res))
        .catch(err => callback(this.createMySQLError(err)));
    } catch (error) {
      console.error('Error invoking IPC for MySQL query:', error);
      callback(this.createMySQLError(error));
    }
  }

  private testConnection(config: any, callback: (err: any) => void) {
    try {
      this.ipcRenderer.invoke('mysql-query', this.sanitizeConfig(config), 'SELECT 1')
        .then(() => callback(null))
        .catch(err => callback(this.createMySQLError(err)));
    } catch (error) {
      console.error('Error invoking IPC for MySQL connection:', error);
      callback(this.createMySQLError(error));
    }
  }

  get isElectron(): boolean {
    return !!(window && window.process && window.process.type);
  }

  getUserDataPath(): Promise<string> {
    return this.ipcRenderer.invoke('getUserDataPath');
  }

  isForceMigrationReplayRequested(): Promise<boolean> {
    return this.ipcRenderer.invoke('is-force-migration-replay-requested');
  }

  clearForceMigrationReplayRequest(): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke('clear-force-migration-replay-request');
  }

  openDialog(method: any, config: any): any {
    this.ipcRenderer.invoke('dialog', method, config);
  }

  execSqliteQuery(sql: any, args?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const uniqueEvent = `sqlite3-reply-${Date.now()}-${Math.random()}`;
      this.ipcRenderer.once(uniqueEvent, (_, arg) => {
        if (arg && arg.__sqliteError) {
          reject(new Error(arg.message || 'Unknown SQLite error'));
        } else {
          resolve(arg);
        }
      });
      this.ipcRenderer.send('sqlite3-query', sql, args, uniqueEvent);
    });
  }

  executeSqliteWalCheckpoint(): Promise<any> {
    return this.ipcRenderer.invoke('sqlite3-wal-checkpoint');
  }

  logInfo(message: string, instrumentId: string = null) {
    this.ipcRenderer.invoke('log-info', message, instrumentId);
  }

  logError(message: string, instrumentId: string = null) {
    this.ipcRenderer.invoke('log-error', message, instrumentId);
  }

  logWarning(message: string, instrumentId: string = null) {
    this.ipcRenderer.invoke('log-warning', message, instrumentId);
  }
}
