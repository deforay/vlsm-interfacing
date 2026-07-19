import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ElectronStoreService {
  private store: any;
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
    // Connection identity and credentials are managed exclusively in Electron
    // main and must not flow through renderer settings snapshots or exports.
    delete storeCopy.intelisConnection;
    delete storeCopy.sourceInstallationId;

    return storeCopy;
  }

  electronStoreObservable(): Observable<any> {
    return this.electronStoreSubject.asObservable();
  }

  exportSettings(): void {
    const settings = this.getAll();
    this.removeSensitiveFields(settings);
    const settingsJSON = JSON.stringify(settings, null, 2);
    (window as any).require('electron').ipcRenderer.invoke('export-settings', settingsJSON)
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

    // Stored settings use commonConfig. Keep the legacy key covered as well so
    // older imported configurations cannot leak credentials when re-exported.
    const commonSettingsObjects = [settings?.commonConfig, settings?.commonSettings].filter(Boolean);
    commonSettingsObjects.forEach(commonSettings => {
      sensitiveFields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(commonSettings, field)) {
          delete commonSettings[field];
        }
      });
    });

    // Remove LIS API credentials
    if (settings && settings.lisApiConfig && settings.lisApiConfig.credentials) {
      delete settings.lisApiConfig.credentials;
    }
    if (settings) {
      delete settings.intelisConnection;
      delete settings.sourceInstallationId;
    }
  }

  showNotification(title: string, message: string): void {
    new Notification(title, { body: message });
  }

}
