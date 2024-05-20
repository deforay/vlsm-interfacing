import { Injectable } from '@angular/core';
import { ipcRenderer } from 'electron';
import * as Store from 'electron-store';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ElectronStoreService {
  private store: Store;
  private electronStoreSubject: BehaviorSubject<any>;

  constructor() {
    if (window.require) {
      try {
        const storeClass = window.require('electron-store');
        this.store = new storeClass();
        this.electronStoreSubject = new BehaviorSubject<any>(this.getAll());
      } catch (e) {
        console.warn('electron-store was not loaded');
        this.electronStoreSubject = new BehaviorSubject<any>(null);
      }
    } else {
      console.warn('electron-store was not loaded');
      this.electronStoreSubject = new BehaviorSubject<any>(null);
    }
  }

  get = (key: string): any => this.store.get(key);

  set = (key: string, value: any): void => {
    this.store.set(key, value);
    this.electronStoreSubject.next(this.getAll());
  };

  // getAll(): any {
  //   return this.store.store;
  // }

  getAll(): any {
    const storeCopy = { ...this.store.store };

    if (storeCopy.encryptionKey) {
      delete storeCopy.encryptionKey;
    }

    return storeCopy;
  }

  electronStoreObservable(): Observable<any> {
    return this.electronStoreSubject.asObservable();
  }

  exportSettings(): void {
    const settings = this.getAll();
    const sensitiveFields = ['mysqlPassword'];
    this.removeSensitiveFields(settings);
    const settingsJSON = JSON.stringify(settings, null, 2);
    ipcRenderer.invoke('export-settings', settingsJSON)
      .then(response => {
        console.log('Export response:', response);
      })
      .catch(err => {
        console.error('Error exporting settings:', err);
      });
  }
  
  removeSensitiveFields(settings: any): void {
    // List of sensitive fields to be removed
    const sensitiveFields = ['mysqlPassword', 'encryptionKey'];

    // Check if commonSettings exists and remove the sensitive fields
    if (settings && settings.commonSettings) {
      sensitiveFields.forEach(field => {
        if (settings.commonSettings[field]) {
          delete settings.commonSettings[field];
        }
      });
    }
  }
  



  
}
