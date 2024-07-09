import { Injectable } from '@angular/core';
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

  constructor(private store: ElectronStoreService) { }

  private getEncryptionKey(): string {
    let that = this;
    let key = that.store.get('encryptionKey');
    if (!key) {
      key = that.generateEncryptionKey();
      that.store.set('encryptionKey', key);
    }
    return key;
  }

  private generateEncryptionKey(): string {
    return crypto.randomBytes(this.keyLength).toString('hex');
  }

  encrypt(data: string, key: string = null): string {
    let that = this;
    if (!data || that.isEncrypted(data)) {
      //console.error('Cannot encrypt empty or already encrypted data');
      return data;
    }

    if (!key) {
      key = that.getEncryptionKey();
    }

    const encrypted = CryptoJS.AES.encrypt(data, key).toString();
    return `${that.prefix}${encrypted}${that.suffix}`;
  }

  decrypt(data: string, key: string = null): string {
    let that = this;
    if (!data || !that.isEncrypted(data)) {
      //console.error('Data does not appear to be encrypted');
      return data;
    }
    if (!key) {
      key = that.getEncryptionKey();
    }

    const encryptedData = data.slice(that.prefix.length, -that.suffix.length);
    const bytes = CryptoJS.AES.decrypt(encryptedData, key);
    const decryptedData = bytes.toString(CryptoJS.enc.Utf8);
    if (!decryptedData) {
      throw new Error('Failed to decrypt data');
    }
    return decryptedData;
  }

  isEncrypted(data: string): boolean {
    let that = this;
    return data.startsWith(that.prefix) && data.endsWith(that.suffix);
  }
}
