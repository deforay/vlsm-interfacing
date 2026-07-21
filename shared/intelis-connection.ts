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

export interface IntelisResultRow {
  id: number;
  order_id: string;
  test_id: string;
  results: string | null;
  test_unit: string | null;
  machine_used: string;
  instrument_id?: string | null;
  tested_by?: string | null;
  authorised_date_time?: string | null;
  result_accepted_date_time?: string | null;
  raw_text?: string | null;
}

export type IntelisResultOutcome = 'accepted' | 'unchanged' | 'rejected' | 'retry';

export interface IntelisResultAcknowledgement {
  id: number;
  outcome: IntelisResultOutcome;
  limsSyncStatus: 0 | 1 | 2;
  reason: string;
}

export interface IntelisResultSubmissionResponse {
  status: 'success';
  imported: number;
  results: IntelisResultAcknowledgement[];
}

export interface IntelisResultDeliveryLimits {
  maxItems: number;
  maxBodyBytes: number;
}

export interface IntelisResultBatchPlan {
  batches: IntelisResultRow[][];
  oversizedResultIds: number[];
}

export interface IntelisActivityEvent {
  event_id: string;
  event_type: string;
  event_category: string;
  occurred_at: string;
  instrument_id?: string | null;
  machine_type?: string | null;
  protocol?: string | null;
  connection_mode?: string | null;
  test_type?: string | null;
  outcome?: string | null;
  failure_code?: string | null;
  event_count?: number;
  app_version?: string | null;
}

export interface IntelisActivitySubmissionResponse {
  status: 'success';
  stored: number;
  duplicates: number;
  skipped: number;
}

export interface IntelisUsageSummary {
  aggregate_id: string;
  activity_date: string;
  instrument_id?: string | null;
  machine_type?: string | null;
  test_type?: string | null;
  total_tests: number;
  successful_tests: number;
  failed_tests: number;
  first_test_at?: string | null;
  last_test_at?: string | null;
  revision: number;
}

export type IntelisUsageSummaryOutcome = 'stored' | 'updated' | 'duplicate' | 'stale' | 'rejected';

export interface IntelisUsageSummaryAcknowledgement {
  aggregate_id: string;
  revision: number;
  outcome: IntelisUsageSummaryOutcome;
}

export interface IntelisUsageSubmissionResponse {
  status: 'success';
  stored: number;
  updated: number;
  duplicates: number;
  stale: number;
  rejected: number;
  summaries: IntelisUsageSummaryAcknowledgement[];
}

export interface IntelisDeliveryLimits {
  maxItems: number;
  maxBodyBytes: number;
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

export function buildIntelisApiUrl(
  baseUrl: string,
  endpoint: 'activate' | 'connection' | 'results' | 'activity' | 'usage-statistics'
): string {
  return `${normalizeIntelisBaseUrl(baseUrl)}/api/v1/interface/${endpoint}`;
}

function getIntelisDeliveryLimits(
  profile: IntelisConnectionProfile | undefined,
  operation: string,
  limitName: string
): IntelisDeliveryLimits | null {
  const operations = profile?.capabilities?.['operations'];
  const limits = profile?.limits?.[limitName];
  if (
    !operations
    || typeof operations !== 'object'
    || (operations as Record<string, unknown>)[operation] !== true
    || !limits
    || typeof limits !== 'object'
  ) {
    return null;
  }

  const maxItems = (limits as Record<string, unknown>)['maxItems'];
  const maxBodyBytes = (limits as Record<string, unknown>)['maxBodyBytes'];
  if (!Number.isInteger(maxItems) || !Number.isInteger(maxBodyBytes) || Number(maxItems) <= 0 || Number(maxBodyBytes) <= 0) {
    return null;
  }
  return { maxItems: Number(maxItems), maxBodyBytes: Number(maxBodyBytes) };
}

export function getIntelisActivityDeliveryLimits(profile?: IntelisConnectionProfile): IntelisDeliveryLimits | null {
  return getIntelisDeliveryLimits(profile, 'activityWrite', 'activity');
}

export function getIntelisUsageDeliveryLimits(profile?: IntelisConnectionProfile): IntelisDeliveryLimits | null {
  return getIntelisDeliveryLimits(profile, 'usageStatisticsWrite', 'usageStatistics');
}

export function getIntelisResultDeliveryLimits(
  profile?: IntelisConnectionProfile
): IntelisResultDeliveryLimits | null {
  return getIntelisDeliveryLimits(profile, 'resultsWrite', 'results');
}

export function requestBytes(field: 'events' | 'summaries', rows: unknown[]): number {
  return new TextEncoder().encode(JSON.stringify({ [field]: rows })).byteLength;
}

export function planIntelisResultBatches(
  rows: IntelisResultRow[],
  limits: IntelisResultDeliveryLimits
): IntelisResultBatchPlan {
  const groups = new Map<string, IntelisResultRow[]>();
  for (const row of rows) {
    // The server compares copies and log-unit rows within this exact pair.
    // Keeping the group intact prevents a later batch from overwriting it.
    const key = JSON.stringify([row.order_id, row.test_id]);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const batches: IntelisResultRow[][] = [];
  const oversizedResultIds: number[] = [];
  let currentBatch: IntelisResultRow[] = [];

  for (const group of groups.values()) {
    if (
      group.length > limits.maxItems
      || resultRequestBytes(group) > limits.maxBodyBytes
    ) {
      oversizedResultIds.push(...group.map(row => row.id));
      continue;
    }

    const candidate = [...currentBatch, ...group];
    if (
      currentBatch.length > 0
      && (candidate.length > limits.maxItems || resultRequestBytes(candidate) > limits.maxBodyBytes)
    ) {
      batches.push(currentBatch);
      currentBatch = [...group];
    } else {
      currentBatch = candidate;
    }
  }

  if (currentBatch.length > 0) batches.push(currentBatch);
  return { batches, oversizedResultIds };
}

export function resultRequestBytes(rows: IntelisResultRow[]): number {
  return new TextEncoder().encode(JSON.stringify({ results: rows })).byteLength;
}
