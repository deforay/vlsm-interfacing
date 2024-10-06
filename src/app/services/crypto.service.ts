import { Injectable } from '@angular/core';
import { ElectronStoreService } from './electron-store.service';
import * as crypto from 'crypto';

@Injectable({
  providedIn: 'root'
})
export class CryptoService {

  private readonly keyLength = 32; // Key length should be 32 bytes for AES-256
  private readonly prefix = 'ENC(';
  private readonly suffix = ')';
  private readonly algorithm = 'aes-256-gcm';
  private readonly ivLength = 16;  // AES-GCM requires a 16-byte IV

  constructor(private readonly store: ElectronStoreService) { }

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
    if (!data || this.isEncrypted(data)) {
      return data; // Return as is if it's already encrypted
    }

    if (!key) {
      key = this.getEncryptionKey();
    }

    // Ensure key is 32 bytes (64 hex characters) long for AES-256
    const encryptionKey = Buffer.from(key, 'hex');

    // Generate a random initialization vector (IV)
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(this.algorithm, encryptionKey, iv);

    let encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Combine the IV, auth tag, and encrypted data
    const encryptedDataWithIv = iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted.toString('hex');

    return `${this.prefix}${encryptedDataWithIv}${this.suffix}`;
  }

  decrypt(data: string, key: string = null): string {
    if (!data || !this.isEncrypted(data)) {
      return data;
    }

    if (!key) {
      key = this.getEncryptionKey();
    }

    // Ensure key is 32 bytes (64 hex characters) long for AES-256
    const encryptionKey = Buffer.from(key, 'hex');

    const encryptedData = data.slice(this.prefix.length, -this.suffix.length);
    const [ivHex, authTagHex, encrypted] = encryptedData.split(':');

    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(this.algorithm, encryptionKey, iv);
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  isEncrypted(data: string): boolean {
    return data.startsWith(this.prefix) && data.endsWith(this.suffix);
  }
}
