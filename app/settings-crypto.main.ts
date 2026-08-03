// Passphrase encryption for full settings exports.
//
// Split out from settings-backup.main.ts so it can be exercised on its own: a
// bug here is not visible until someone tries to restore a backup, by which
// point the original machine is usually gone. Imports node crypto only — no
// Electron, no fs.

import * as crypto from 'crypto';

import {
  EncryptedSettingsExport,
  MIN_PASSPHRASE_LENGTH,
  SETTINGS_EXPORT_SCHEMA_VERSION
} from '../shared/settings-backup';

export { MIN_PASSPHRASE_LENGTH };

// scrypt cost. N=2^15 keeps derivation to roughly a tenth of a second on the
// low-end machines this runs on — negligible for a once-per-export operation,
// and expensive enough to make guessing a passphrase unattractive.
export const SCRYPT_N = 32768;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_KEY_LENGTH = 32;

const SCRYPT_SALT_LENGTH = 16;
const GCM_IV_LENGTH = 12;

// scrypt needs memory proportional to 128 * N * r; the default 32 MB cap is
// below what N=2^15 requires, so it has to be raised explicitly or derivation
// throws.
const SCRYPT_MAX_MEMORY = 256 * 1024 * 1024;

export interface ExportMeta {
  appVersion: string;
  exportedAt: string;
  source: 'manual' | 'scheduled';
}

export function encryptSettings(
  settings: Record<string, any>,
  passphrase: string,
  meta: ExportMeta
): EncryptedSettingsExport {
  const salt = crypto.randomBytes(SCRYPT_SALT_LENGTH);
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const key = crypto.scryptSync(passphrase, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAX_MEMORY
  });

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(settings), 'utf8'),
    cipher.final()
  ]);

  return {
    schemaVersion: SETTINGS_EXPORT_SCHEMA_VERSION,
    exportedAt: meta.exportedAt,
    appVersion: meta.appVersion,
    source: meta.source,
    encrypted: true,
    // Recorded rather than assumed, so a future change to the cost parameters
    // does not make today's files unreadable.
    kdf: {
      name: 'scrypt',
      salt: salt.toString('base64'),
      keyLength: SCRYPT_KEY_LENGTH,
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P
    },
    cipher: {
      name: 'aes-256-gcm',
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64')
    },
    payload: ciphertext.toString('base64')
  };
}

/**
 * Reverses encryptSettings.
 *
 * A wrong passphrase fails GCM authentication and throws, so there is no way
 * to silently import a partially decrypted config. Callers must treat any
 * throw as "wrong passphrase or damaged file" and say nothing more specific —
 * distinguishing the two only helps someone guessing.
 */
export function decryptSettings(
  envelope: EncryptedSettingsExport,
  passphrase: string
): Record<string, any> {
  const key = crypto.scryptSync(
    passphrase,
    Buffer.from(envelope.kdf.salt, 'base64'),
    envelope.kdf.keyLength || SCRYPT_KEY_LENGTH,
    {
      N: envelope.kdf.N,
      r: envelope.kdf.r,
      p: envelope.kdf.p,
      maxmem: SCRYPT_MAX_MEMORY
    }
  );

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(envelope.cipher.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(envelope.cipher.authTag, 'base64'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.payload, 'base64')),
    decipher.final()
  ]).toString('utf8');

  return JSON.parse(plaintext);
}
