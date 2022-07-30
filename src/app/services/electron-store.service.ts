import { Injectable } from '@angular/core';
import * as Store from 'electron-store';

@Injectable({
  providedIn: 'root'
})
export class ElectronStoreService {
  private store: Store;
  constructor() {
    if (window.require) {
      try {
        const storeClass = window.require('electron-store');
        this.store = new storeClass();
      } catch (e) {
        throw e;
      }
    } else {
      console.warn('electron-store was not loaded');
    }
  }

  // Get a value from the store
  get = (key: string): any => this.store.get(key);

  // Set the value of a key into the electron-store
  // (If the key already exists, the value will be replaced)
  set = (key: string, value: any): void => {
    this.store.set(key, value);
  };
}
