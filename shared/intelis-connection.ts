export type IntelisConnectionHealth = 'connected' | 'attention' | 'revoked';

export interface IntelisFacilityProfile {
  id: number;
  code: string;
  name: string;
}

export interface IntelisMachineProfile {
  id: number;
  name: string;
}

export interface IntelisInstrumentProfile {
  id: string;
  name: string;
  supportedTests: string[];
  aliases: string[];
  machines: IntelisMachineProfile[];
}

export interface IntelisConnectionProfile {
  facility: IntelisFacilityProfile;
  supportedTests: string[];
  instruments: IntelisInstrumentProfile[];
  capabilities: Record<string, unknown>;
  limits: Record<string, unknown>;
}

export interface IntelisInstallationProfile {
  installationId: string;
  sourceInstallationId: string;
  displayName: string;
  scopes: string[];
  credentialVersion: number;
}

export interface IntelisConnectionState {
  configured: boolean;
  health?: IntelisConnectionHealth;
  baseUrl?: string;
  installation?: IntelisInstallationProfile;
  connection?: IntelisConnectionProfile;
  connectedAt?: string;
  lastCheckedAt?: string;
  lastError?: IntelisConnectionError;
}

export interface IntelisConnectRequest {
  baseUrl: string;
  connectionCode: string;
  displayName: string;
}

export interface IntelisConnectionError {
  code: string;
  message: string;
  httpStatus?: number;
}

export interface IntelisIpcResult<T> {
  ok: boolean;
  data?: T;
  error?: IntelisConnectionError;
}

export const INTELIS_CONNECTION_CODE_LENGTH = 12;

export function normalizeIntelisConnectionCode(value: string): string {
  const normalized = (value || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  return normalized.replace(/[IL]/g, '1').replace(/O/g, '0').replace(/U/g, 'V');
}

export function formatIntelisConnectionCode(value: string): string {
  return normalizeIntelisConnectionCode(value)
    .slice(0, INTELIS_CONNECTION_CODE_LENGTH)
    .match(/.{1,4}/g)?.join('-') || '';
}

export function isValidIntelisConnectionCode(value: string): boolean {
  return normalizeIntelisConnectionCode(value).length === INTELIS_CONNECTION_CODE_LENGTH;
}

export function normalizeIntelisBaseUrl(value: string): string {
  const trimmed = (value || '').trim();
  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Enter a valid InteLIS URL, including https://.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('InteLIS connections require HTTPS.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('The InteLIS URL cannot contain credentials, query parameters, or a fragment.');
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

export function buildIntelisApiUrl(baseUrl: string, endpoint: 'activate' | 'connection'): string {
  return `${normalizeIntelisBaseUrl(baseUrl)}/api/v1/interface/${endpoint}`;
}
