import { ipcMain, net, safeStorage } from 'electron';
import { randomUUID } from 'crypto';
import * as os from 'os';
import {
  buildIntelisApiUrl,
  IntelisConnectRequest,
  IntelisConnectionError,
  IntelisConnectionProfile,
  IntelisConnectionState,
  IntelisInstallationProfile,
  IntelisIpcResult,
  normalizeIntelisBaseUrl
} from '../shared/intelis-connection';

interface StoreLike {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
}

interface StoredIntelisConnection extends Omit<IntelisConnectionState, 'configured'> {
  schemaVersion: 1;
  encryptedCredential: string;
}

interface ActivationResponse {
  status: 'success';
  installation: IntelisInstallationProfile & { credential: string };
}

interface ConnectionResponse {
  status: 'success';
  connection: IntelisConnectionProfile;
}

class IntelisApiRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus?: number
  ) {
    super(message);
  }
}

const CONNECTION_KEY = 'intelisConnection';
const SOURCE_INSTALLATION_ID_KEY = 'sourceInstallationId';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15000;

function getStoredConnection(store: StoreLike): StoredIntelisConnection | null {
  const value = store.get(CONNECTION_KEY);
  if (!value || typeof value !== 'object') return null;
  return value as StoredIntelisConnection;
}

function publicState(connection: StoredIntelisConnection | null): IntelisConnectionState {
  if (!connection) return { configured: false };
  const { encryptedCredential: _credential, schemaVersion: _schemaVersion, ...state } = connection;
  return { configured: true, ...state };
}

function getOrCreateSourceInstallationId(store: StoreLike): string {
  const stored = store.get(SOURCE_INSTALLATION_ID_KEY);
  if (typeof stored === 'string' && stored.length >= 8) return stored;

  const sourceInstallationId = `interface-${randomUUID()}`;
  store.set(SOURCE_INSTALLATION_ID_KEY, sourceInstallationId);
  return sourceInstallationId;
}

function encryptCredential(credential: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new IntelisApiRequestError(
      'secure_storage_unavailable',
      'Secure credential storage is unavailable on this computer.'
    );
  }
  return safeStorage.encryptString(credential).toString('base64');
}

function decryptCredential(encryptedCredential: string): string {
  try {
    return safeStorage.decryptString(Buffer.from(encryptedCredential, 'base64'));
  } catch {
    throw new IntelisApiRequestError(
      'credential_unavailable',
      'The saved InteLIS credential cannot be read. Reconnect this installation from InteLIS.'
    );
  }
}

async function readJsonResponse(response: Response): Promise<any> {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new IntelisApiRequestError('response_too_large', 'InteLIS returned an unexpectedly large response.');
  }

  const reader = response.body?.getReader();
  if (!reader) return {};

  const chunks: Buffer[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new IntelisApiRequestError('response_too_large', 'InteLIS returned an unexpectedly large response.');
    }
    chunks.push(Buffer.from(value));
  }

  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new IntelisApiRequestError('invalid_response', 'InteLIS returned an invalid JSON response.');
  }
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await net.fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-store',
        ...(init.headers || {})
      }
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      const apiError = payload?.error;
      throw new IntelisApiRequestError(
        typeof apiError?.code === 'string' ? apiError.code : `http_${response.status}`,
        typeof apiError?.message === 'string' ? apiError.message : `InteLIS request failed with HTTP ${response.status}.`,
        response.status
      );
    }
    return payload as T;
  } catch (error) {
    if (error instanceof IntelisApiRequestError) throw error;
    if ((error as Error)?.name === 'AbortError') {
      throw new IntelisApiRequestError('request_timeout', 'The InteLIS request timed out.');
    }
    throw new IntelisApiRequestError('connection_failed', 'Unable to connect securely to InteLIS.');
  } finally {
    clearTimeout(timeout);
  }
}

function validateActivation(response: ActivationResponse): ActivationResponse['installation'] {
  const installation = response?.installation;
  if (
    response?.status !== 'success'
    || !installation?.installationId
    || !installation?.sourceInstallationId
    || !installation?.credential
    || !Array.isArray(installation?.scopes)
  ) {
    throw new IntelisApiRequestError('invalid_response', 'InteLIS returned an incomplete activation response.');
  }
  return installation;
}

function validateConnection(response: ConnectionResponse): IntelisConnectionProfile {
  const connection = response?.connection;
  if (
    response?.status !== 'success'
    || !connection?.facility
    || !Number.isInteger(connection.facility.id)
    || !Array.isArray(connection.instruments)
    || !Array.isArray(connection.supportedTests)
  ) {
    throw new IntelisApiRequestError('invalid_response', 'InteLIS returned an incomplete connection profile.');
  }
  return connection;
}

function errorResult(error: unknown): IntelisIpcResult<never> {
  const normalized = error instanceof IntelisApiRequestError
    ? error
    : new IntelisApiRequestError('unexpected_error', 'The InteLIS connection could not be completed.');
  return {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      httpStatus: normalized.httpStatus
    }
  };
}

async function fetchConnection(baseUrl: string, credential: string): Promise<IntelisConnectionProfile> {
  const response = await requestJson<ConnectionResponse>(buildIntelisApiUrl(baseUrl, 'connection'), {
    method: 'GET',
    headers: { Authorization: `Bearer ${credential}` }
  });
  return validateConnection(response);
}

export function registerIntelisConnectionIpc(store: StoreLike): void {
  ipcMain.handle('intelis-connection-get', () => ({
    ok: true,
    data: publicState(getStoredConnection(store))
  } satisfies IntelisIpcResult<IntelisConnectionState>));

  ipcMain.handle('intelis-connection-connect', async (_event, request: IntelisConnectRequest) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new IntelisApiRequestError(
          'secure_storage_unavailable',
          'Secure credential storage is unavailable on this computer.'
        );
      }

      let baseUrl: string;
      try {
        baseUrl = normalizeIntelisBaseUrl(request?.baseUrl);
      } catch (urlError) {
        throw new IntelisApiRequestError(
          'invalid_base_url',
          urlError instanceof Error ? urlError.message : 'Enter a valid InteLIS URL.'
        );
      }
      const connectionCode = (request?.connectionCode || '').trim();
      const displayName = (request?.displayName || os.hostname() || 'Laboratory computer').trim();
      if (!connectionCode || connectionCode.length > 128) {
        throw new IntelisApiRequestError('invalid_connection_code', 'Enter a valid InteLIS Connection Code.');
      }
      if (!displayName || displayName.length > 150) {
        throw new IntelisApiRequestError('invalid_display_name', 'Enter a computer name of 150 characters or fewer.');
      }

      const sourceInstallationId = getOrCreateSourceInstallationId(store);
      const activationResponse = await requestJson<ActivationResponse>(buildIntelisApiUrl(baseUrl, 'activate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // WHY: reconnect codes ignore these extra values server-side, while new
        // connections require them. One request therefore supports both flows.
        body: JSON.stringify({ activationCode: connectionCode, sourceInstallationId, displayName })
      });
      const activated = validateActivation(activationResponse);
      const now = new Date().toISOString();
      const stored: StoredIntelisConnection = {
        schemaVersion: 1,
        baseUrl,
        installation: {
          installationId: activated.installationId,
          sourceInstallationId: activated.sourceInstallationId,
          displayName: activated.displayName,
          scopes: activated.scopes,
          credentialVersion: activated.credentialVersion || 1
        },
        encryptedCredential: encryptCredential(activated.credential),
        health: 'attention',
        connectedAt: now
      };

      // Persist immediately: the one-time code has been consumed and the returned
      // credential must survive even if the follow-up profile request is interrupted.
      store.set(CONNECTION_KEY, stored);
      store.set(SOURCE_INSTALLATION_ID_KEY, activated.sourceInstallationId);

      try {
        stored.connection = await fetchConnection(baseUrl, activated.credential);
        stored.health = 'connected';
        stored.lastCheckedAt = new Date().toISOString();
        delete stored.lastError;
      } catch (profileError) {
        const failure = errorResult(profileError).error;
        stored.lastError = failure;
      }
      store.set(CONNECTION_KEY, stored);
      return { ok: true, data: publicState(stored) } satisfies IntelisIpcResult<IntelisConnectionState>;
    } catch (error) {
      return errorResult(error);
    }
  });

  ipcMain.handle('intelis-connection-refresh', async () => {
    const stored = getStoredConnection(store);
    if (!stored) {
      return errorResult(new IntelisApiRequestError('not_connected', 'This Interface Tool is not connected to InteLIS.'));
    }

    try {
      const credential = decryptCredential(stored.encryptedCredential);
      stored.connection = await fetchConnection(stored.baseUrl, credential);
      stored.health = 'connected';
      stored.lastCheckedAt = new Date().toISOString();
      delete stored.lastError;
      store.set(CONNECTION_KEY, stored);
      return { ok: true, data: publicState(stored) } satisfies IntelisIpcResult<IntelisConnectionState>;
    } catch (error) {
      const failure = errorResult(error).error;
      stored.health = failure?.httpStatus === 401 ? 'revoked' : 'attention';
      stored.lastError = failure;
      stored.lastCheckedAt = new Date().toISOString();
      store.set(CONNECTION_KEY, stored);
      return { ok: false, data: publicState(stored), error: failure } satisfies IntelisIpcResult<IntelisConnectionState>;
    }
  });

  ipcMain.handle('intelis-connection-forget', () => {
    store.delete(CONNECTION_KEY);
    return { ok: true, data: { configured: false } } satisfies IntelisIpcResult<IntelisConnectionState>;
  });
}
