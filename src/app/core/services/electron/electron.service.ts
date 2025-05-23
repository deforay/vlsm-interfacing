import { Injectable } from '@angular/core';

// If you import a module but never use any of the imported values other than as TypeScript types,
// the resulting javascript file will look as if you never imported the module at all.
import { ipcRenderer, net, webFrame } from 'electron';
import * as childProcess from 'child_process';
import * as fs from 'fs';

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
    destroy: () => void;
  };
}

@Injectable({
  providedIn: 'root'
})
export class ElectronService {
  ipcRenderer: typeof ipcRenderer;
  webFrame: typeof webFrame;
  childProcess: typeof childProcess;
  fs: typeof fs;
  mysql: MySQLClient;
  net: typeof net;

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

  openDialog(method: any, config: any): any {
    this.ipcRenderer.invoke('dialog', method, config);
  }

  execSqliteQuery(sql: any, args?: any): any {
    return new Promise((resolve) => {
      const uniqueEvent = `sqlite3-reply-${Date.now()}-${Math.random()}`;
      this.ipcRenderer.once(uniqueEvent, (_, arg) => {
        resolve(arg);
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
