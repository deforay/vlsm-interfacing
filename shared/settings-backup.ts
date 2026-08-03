// Settings export/backup format, shared by the Electron main process (which
// writes and reads the files) and the renderer (which shows what a file
// contains before importing it).
//
// Kept free of `fs`, `crypto` and Electron imports so it can be bundled into
// the renderer. Anything needing those lives in app/settings-backup.main.ts.

/**
 * Bumped whenever the envelope or the shape of `settings` changes in a way an
 * older build cannot read. Files written before versioning existed are bare
 * settings objects with no envelope; those are reported as version 0.
 */
export const SETTINGS_EXPORT_SCHEMA_VERSION = 1;

/** Pre-versioning exports: the settings object was the whole file. */
export const LEGACY_SETTINGS_EXPORT_SCHEMA_VERSION = 0;

/**
 * Enforced in main before writing, and in the renderer so the user is told
 * before the save dialog rather than after choosing a filename.
 */
export const MIN_PASSPHRASE_LENGTH = 8;

export type SettingsBackupInterval = 'hourly' | 'daily' | 'weekly';

export interface SettingsBackupConfig {
  enabled: boolean;
  interval: SettingsBackupInterval;
  /** How many automatic backups to keep. Older ones are pruned after a write. */
  retention: number;
}

export const DEFAULT_SETTINGS_BACKUP_CONFIG: SettingsBackupConfig = {
  enabled: true,
  interval: 'daily',
  retention: 10
};

export const SETTINGS_BACKUP_CONFIG_KEY = 'backupConfig';

/** Directory under userData that automatic backups are written to. */
export const SETTINGS_BACKUP_DIR_NAME = 'settings-backups';

export const SETTINGS_BACKUP_INTERVAL_MS: Record<SettingsBackupInterval, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000
};

/** Key holding the timestamp of the last successful automatic backup. */
export const LAST_SETTINGS_BACKUP_AT_KEY = 'lastSettingsBackupAt';

export interface SettingsExportEnvelopeBase {
  schemaVersion: number;
  /** ISO timestamp, for humans reading a folder of backups. */
  exportedAt: string;
  /** App version that wrote the file, to explain shape differences later. */
  appVersion: string;
  /** How the file was produced, so an unattended file is distinguishable. */
  source: 'manual' | 'scheduled';
  encrypted: boolean;
}

export interface PlainSettingsExport extends SettingsExportEnvelopeBase {
  encrypted: false;
  /** Credentials are absent: see scrubSensitiveSettings. */
  settings: Record<string, any>;
}

export interface EncryptedSettingsExport extends SettingsExportEnvelopeBase {
  encrypted: true;
  kdf: {
    name: 'scrypt';
    salt: string;
    keyLength: number;
    N: number;
    r: number;
    p: number;
  };
  cipher: {
    name: 'aes-256-gcm';
    iv: string;
    authTag: string;
  };
  /** Base64 ciphertext of JSON.stringify(settings). */
  payload: string;
}

export type SettingsExport = PlainSettingsExport | EncryptedSettingsExport;

/**
 * Never leaves this machine, in either export mode.
 *
 * The installation identity is what the Intelis backend uses to attribute
 * results and usage. Copying it to a second machine produces two installs
 * claiming to be the same one, which breaks result idempotency — so unlike
 * credentials, there is no "include these" option.
 */
export const INSTALLATION_IDENTITY_KEYS = ['intelisConnection', 'sourceInstallationId'] as const;

/** Credential fields, omitted unless the export is encrypted with a passphrase. */
const SENSITIVE_COMMON_CONFIG_FIELDS = ['mysqlPassword', 'encryptionKey'] as const;

/**
 * Top-level `encryptionKey` is the key `mysqlPassword` and the LIS credentials
 * are encrypted under. A full export has to carry it or the restored copies
 * are undecryptable on the target machine; a scrubbed export must not.
 */
const SENSITIVE_TOP_LEVEL_FIELDS = ['encryptionKey'] as const;

/** Deep clone via JSON: settings are plain JSON already (they live in a JSON store). */
function cloneSettings(settings: Record<string, any>): Record<string, any> {
  return JSON.parse(JSON.stringify(settings ?? {}));
}

/**
 * Removes the installation identity. Applied to every export and to every
 * import, so neither writing nor reading a crafted file can clone an install.
 */
export function stripInstallationIdentity<T extends Record<string, any>>(settings: T): T {
  INSTALLATION_IDENTITY_KEYS.forEach(key => {
    delete settings[key];
  });
  return settings;
}

/**
 * Removes credentials from a settings snapshot, in place.
 *
 * Stored settings use `commonConfig`; `commonSettings` was the older name and
 * is still covered so an old file that gets imported and re-exported cannot
 * leak credentials through the legacy key.
 */
export function scrubSensitiveSettings<T extends Record<string, any>>(settings: T): T {
  if (!settings) {
    return settings;
  }

  SENSITIVE_TOP_LEVEL_FIELDS.forEach(field => {
    delete settings[field];
  });

  [settings.commonConfig, settings.commonSettings]
    .filter(Boolean)
    .forEach((commonSettings: Record<string, any>) => {
      SENSITIVE_COMMON_CONFIG_FIELDS.forEach(field => {
        delete commonSettings[field];
      });
    });

  if (settings.lisApiConfig?.credentials) {
    delete settings.lisApiConfig.credentials;
  }

  return settings;
}

/**
 * Builds the settings object to export. Identity is always stripped;
 * credentials survive only when the caller is producing an encrypted file.
 */
export function prepareSettingsForExport(
  rawSettings: Record<string, any>,
  options: { includeCredentials: boolean }
): Record<string, any> {
  const settings = stripInstallationIdentity(cloneSettings(rawSettings));
  return options.includeCredentials ? settings : scrubSensitiveSettings(settings);
}

/** `settings-20260803-021500.json` — lexical order matches chronological order. */
export function formatBackupTimestamp(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('') + '-' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
}

const SCHEDULED_BACKUP_PREFIX = 'settings-';
const SCHEDULED_BACKUP_SUFFIX = '.json';

export function buildScheduledBackupFileName(date: Date): string {
  return `${SCHEDULED_BACKUP_PREFIX}${formatBackupTimestamp(date)}${SCHEDULED_BACKUP_SUFFIX}`;
}

export function buildManualExportFileName(date: Date, encrypted: boolean): string {
  const suffix = encrypted ? '-full' : '';
  return `interface-settings-${formatBackupTimestamp(date)}${suffix}${SCHEDULED_BACKUP_SUFFIX}`;
}

export function isScheduledBackupFileName(fileName: string): boolean {
  return fileName.startsWith(SCHEDULED_BACKUP_PREFIX) && fileName.endsWith(SCHEDULED_BACKUP_SUFFIX);
}

/**
 * Given the files in the backup directory, returns the ones to delete so that
 * `retention` newest remain. Names sort chronologically, so this is a slice.
 * Unrecognised files are ignored rather than deleted — the directory is the
 * user's, and deleting something we did not write would be a bad surprise.
 */
export function selectBackupsToPrune(fileNames: string[], retention: number): string[] {
  const keep = Math.max(1, Math.floor(retention));
  const backups = fileNames.filter(isScheduledBackupFileName).sort();
  return backups.slice(0, Math.max(0, backups.length - keep));
}

export function normalizeBackupConfig(raw: any): SettingsBackupConfig {
  const interval: SettingsBackupInterval =
    raw?.interval === 'hourly' || raw?.interval === 'weekly' || raw?.interval === 'daily'
      ? raw.interval
      : DEFAULT_SETTINGS_BACKUP_CONFIG.interval;

  const parsedRetention = Number(raw?.retention);
  const retention = Number.isFinite(parsedRetention)
    ? Math.min(100, Math.max(1, Math.floor(parsedRetention)))
    : DEFAULT_SETTINGS_BACKUP_CONFIG.retention;

  return {
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : DEFAULT_SETTINGS_BACKUP_CONFIG.enabled,
    interval,
    retention
  };
}

export interface ParsedSettingsExport {
  schemaVersion: number;
  encrypted: boolean;
  /** Present only for unencrypted files. Encrypted payloads need a passphrase. */
  settings?: Record<string, any>;
  envelope?: EncryptedSettingsExport;
  exportedAt?: string;
  appVersion?: string;
}

function looksLikeEnvelope(raw: any): boolean {
  return raw && typeof raw === 'object'
    && typeof raw.schemaVersion === 'number'
    && typeof raw.encrypted === 'boolean';
}

/**
 * Reads either format: a v1 envelope, or a pre-versioning bare settings object.
 *
 * Throws on anything else rather than guessing, so a truncated or unrelated
 * JSON file fails loudly instead of half-importing.
 */
export function parseSettingsExport(raw: any): ParsedSettingsExport {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Not a settings file: expected a JSON object.');
  }

  if (!looksLikeEnvelope(raw)) {
    // Pre-versioning export: the file is the settings object itself.
    return {
      schemaVersion: LEGACY_SETTINGS_EXPORT_SCHEMA_VERSION,
      encrypted: false,
      settings: raw as Record<string, any>
    };
  }

  if (raw.schemaVersion > SETTINGS_EXPORT_SCHEMA_VERSION) {
    throw new Error(
      `This settings file was written by a newer version of the app `
      + `(format v${raw.schemaVersion}, this build reads v${SETTINGS_EXPORT_SCHEMA_VERSION}). Update the app and try again.`
    );
  }

  if (raw.encrypted) {
    const envelope = raw as EncryptedSettingsExport;
    if (!envelope.payload || !envelope.kdf?.salt || !envelope.cipher?.iv || !envelope.cipher?.authTag) {
      throw new Error('Encrypted settings file is incomplete or corrupted.');
    }
    return {
      schemaVersion: envelope.schemaVersion,
      encrypted: true,
      envelope,
      exportedAt: envelope.exportedAt,
      appVersion: envelope.appVersion
    };
  }

  const plain = raw as PlainSettingsExport;
  if (!plain.settings || typeof plain.settings !== 'object') {
    throw new Error('Settings file is missing its settings section.');
  }

  return {
    schemaVersion: plain.schemaVersion,
    encrypted: false,
    settings: plain.settings,
    exportedAt: plain.exportedAt,
    appVersion: plain.appVersion
  };
}
