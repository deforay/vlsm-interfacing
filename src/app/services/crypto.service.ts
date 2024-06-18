import { Injectable } from '@angular/core';
import { ElectronService } from '../core/services';
import { ElectronStoreService } from './electron-store.service';

import * as CryptoJS from 'crypto-js';
import * as crypto from 'crypto';

@Injectable({
  providedIn: 'root'
})
export class CryptoService {

  private readonly keyLength = 32;
  private readonly prefix = 'ENC(';
  private readonly suffix = ')';

  constructor(
    private electronService: ElectronService,
    private store: ElectronStoreService
  ) { }

  private getEncryptionKey(): string {
    let key = this.store.get('encryptionKey');
    if (!key) {
      key = this.generateEncryptionKey();
      this.store.set('encryptionKey', key);
    }
    return key;
  }

  private generateEncryptionKey(): string {
    return crypto.randomBytes(this.keyLength).toString('hex');
  }

  encrypt(data: string, key: string = null): string {
    if (!data) {
      throw new Error('No data provided for encryption');
    }
    if (!key) {
      key = this.getEncryptionKey();
    }
    if (this.isEncrypted(data)) {
      //console.error('Data is already encrypted');
      return data;
    }
    const encrypted = CryptoJS.AES.encrypt(data, key).toString();
    return `${this.prefix}${encrypted}${this.suffix}`;
  }

  decrypt(data: string, key: string = null): string {
    if (!data) {
      throw new Error('No data provided for decryption');
    }
    if (!key) {
      key = this.getEncryptionKey();
    }
    if (!this.isEncrypted(data)) {
      //console.error('Data does not appear to be encrypted');
      return data;
    }
    const encryptedData = data.slice(this.prefix.length, -this.suffix.length);
    const bytes = CryptoJS.AES.decrypt(encryptedData, key);
    const decryptedData = bytes.toString(CryptoJS.enc.Utf8);
    if (!decryptedData) {
      throw new Error('Failed to decrypt data');
    }
    return decryptedData;
  }

  isEncrypted(data: string): boolean {
    return data.startsWith(this.prefix) && data.endsWith(this.suffix);
  }
}
