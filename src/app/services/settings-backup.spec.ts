import { describe, expect, it } from 'vitest';
import {
  LEGACY_SETTINGS_EXPORT_SCHEMA_VERSION,
  SETTINGS_EXPORT_SCHEMA_VERSION,
  buildScheduledBackupFileName,
  normalizeBackupConfig,
  parseSettingsExport,
  prepareSettingsForExport,
  selectBackupsToPrune
} from '../../../shared/settings-backup';

function sampleSettings(): any {
  return {
    commonConfig: {
      labID: 'LAB001',
      mysqlHost: '127.0.0.1',
      mysqlPassword: 'ENC(secret)',
      encryptionKey: 'key'
    },
    lisApiConfig: {
      url: 'https://lis.example.test',
      credentials: { token: 'token' }
    },
    encryptionKey: 'top-level-key',
    intelisConnection: { encryptedCredential: 'ciphertext' },
    sourceInstallationId: 'source-id'
  };
}

describe('settings export preparation', () => {
  it('removes database and API credentials from a scrubbed export', () => {
    const settings = prepareSettingsForExport(sampleSettings(), { includeCredentials: false });

    expect(settings.commonConfig).toEqual({ labID: 'LAB001', mysqlHost: '127.0.0.1' });
    expect(settings.lisApiConfig.credentials).toBeUndefined();
    expect(settings.encryptionKey).toBeUndefined();
  });

  it('keeps credentials for an encrypted export', () => {
    const settings = prepareSettingsForExport(sampleSettings(), { includeCredentials: true });

    expect(settings.commonConfig.mysqlPassword).toBe('ENC(secret)');
    expect(settings.lisApiConfig.credentials).toEqual({ token: 'token' });
    // The key the stored ciphertexts are encrypted under has to travel with
    // them, or the restore cannot decrypt anything.
    expect(settings.encryptionKey).toBe('top-level-key');
  });

  it('never exports installation identity, in either mode', () => {
    [true, false].forEach(includeCredentials => {
      const settings = prepareSettingsForExport(sampleSettings(), { includeCredentials });
      expect(settings.intelisConnection).toBeUndefined();
      expect(settings.sourceInstallationId).toBeUndefined();
    });
  });

  it('scrubs the legacy commonSettings key as well as commonConfig', () => {
    const settings = prepareSettingsForExport(
      { commonSettings: { labID: 'LAB002', mysqlPassword: 'ENC(old)' } },
      { includeCredentials: false }
    );

    expect(settings.commonSettings).toEqual({ labID: 'LAB002' });
  });

  it('does not mutate the caller\'s settings object', () => {
    const original = sampleSettings();
    prepareSettingsForExport(original, { includeCredentials: false });

    expect(original.commonConfig.mysqlPassword).toBe('ENC(secret)');
    expect(original.sourceInstallationId).toBe('source-id');
  });
});

describe('settings export parsing', () => {
  it('reads a versioned plain export', () => {
    const parsed = parseSettingsExport({
      schemaVersion: SETTINGS_EXPORT_SCHEMA_VERSION,
      exportedAt: '2026-08-03T02:00:00.000Z',
      appVersion: '4.1.10',
      source: 'scheduled',
      encrypted: false,
      settings: { commonConfig: { labID: 'LAB001' } }
    });

    expect(parsed.encrypted).toBe(false);
    expect(parsed.settings.commonConfig.labID).toBe('LAB001');
  });

  it('reads a pre-versioning export as a bare settings object', () => {
    const parsed = parseSettingsExport({ commonConfig: { labID: 'LAB001' } });

    expect(parsed.schemaVersion).toBe(LEGACY_SETTINGS_EXPORT_SCHEMA_VERSION);
    expect(parsed.encrypted).toBe(false);
    expect(parsed.settings.commonConfig.labID).toBe('LAB001');
  });

  it('reports an encrypted export without exposing settings', () => {
    const parsed = parseSettingsExport({
      schemaVersion: SETTINGS_EXPORT_SCHEMA_VERSION,
      exportedAt: '2026-08-03T02:00:00.000Z',
      appVersion: '4.1.10',
      source: 'manual',
      encrypted: true,
      kdf: { name: 'scrypt', salt: 'c2FsdA==', keyLength: 32, N: 32768, r: 8, p: 1 },
      cipher: { name: 'aes-256-gcm', iv: 'aXY=', authTag: 'dGFn' },
      payload: 'cGF5bG9hZA=='
    });

    expect(parsed.encrypted).toBe(true);
    expect(parsed.settings).toBeUndefined();
    expect(parsed.envelope.payload).toBe('cGF5bG9hZA==');
  });

  it('refuses a file written by a newer format', () => {
    expect(() => parseSettingsExport({
      schemaVersion: SETTINGS_EXPORT_SCHEMA_VERSION + 1,
      encrypted: false,
      settings: {}
    })).toThrow(/newer version/i);
  });

  it('refuses a truncated encrypted file rather than half-importing', () => {
    expect(() => parseSettingsExport({
      schemaVersion: SETTINGS_EXPORT_SCHEMA_VERSION,
      encrypted: true,
      kdf: { name: 'scrypt', salt: 'c2FsdA==', keyLength: 32, N: 32768, r: 8, p: 1 },
      cipher: { name: 'aes-256-gcm', iv: 'aXY=', authTag: 'dGFn' }
    })).toThrow(/incomplete or corrupted/i);
  });

  it('refuses input that is not an object', () => {
    expect(() => parseSettingsExport(null)).toThrow(/expected a JSON object/i);
    expect(() => parseSettingsExport([])).toThrow(/expected a JSON object/i);
  });
});

describe('scheduled backup housekeeping', () => {
  it('names backups so lexical order is chronological', () => {
    const earlier = buildScheduledBackupFileName(new Date(2026, 7, 3, 2, 0, 0));
    const later = buildScheduledBackupFileName(new Date(2026, 7, 3, 14, 30, 5));

    expect(earlier).toBe('settings-20260803-020000.json');
    expect(later).toBe('settings-20260803-143005.json');
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });

  it('prunes the oldest backups beyond the retention count', () => {
    const files = [
      'settings-20260801-020000.json',
      'settings-20260802-020000.json',
      'settings-20260803-020000.json',
      'settings-20260804-020000.json'
    ];

    expect(selectBackupsToPrune(files, 2)).toEqual([
      'settings-20260801-020000.json',
      'settings-20260802-020000.json'
    ]);
  });

  it('leaves unrelated files in the folder alone', () => {
    const files = ['notes.txt', 'interface-settings-20260803-020000.json', 'settings-20260801-020000.json'];

    expect(selectBackupsToPrune(files, 1)).toEqual([]);
  });

  it('never prunes everything, even with a nonsense retention', () => {
    const files = ['settings-20260801-020000.json', 'settings-20260802-020000.json'];

    expect(selectBackupsToPrune(files, 0)).toEqual(['settings-20260801-020000.json']);
    expect(selectBackupsToPrune(files, -5)).toEqual(['settings-20260801-020000.json']);
  });

  it('falls back to defaults for missing or invalid backup config', () => {
    expect(normalizeBackupConfig(undefined)).toEqual({ enabled: true, interval: 'daily', retention: 10 });
    expect(normalizeBackupConfig({ interval: 'fortnightly', retention: 'lots' }))
      .toEqual({ enabled: true, interval: 'daily', retention: 10 });
    expect(normalizeBackupConfig({ enabled: false, interval: 'weekly', retention: 3 }))
      .toEqual({ enabled: false, interval: 'weekly', retention: 3 });
  });

  it('clamps retention to a sane range', () => {
    expect(normalizeBackupConfig({ retention: 0 }).retention).toBe(1);
    expect(normalizeBackupConfig({ retention: 5000 }).retention).toBe(100);
  });
});
