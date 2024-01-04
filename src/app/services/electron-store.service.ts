import { Injectable } from '@angular/core';
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

  getAll(): any {
    return this.store.store;
  }

  electronStoreObservable(): Observable<any> {
    return this.electronStoreSubject.asObservable();
  }
}
