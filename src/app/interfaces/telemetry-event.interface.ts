export type TelemetryCategory = 'usage' | 'instrument' | 'test' | 'failure';
export type TelemetryOutcome = 'success' | 'failed' | 'started' | 'stopped';

export interface TelemetryEventInput {
  eventType: string;
  category: TelemetryCategory;
  occurredAt?: Date | string;
  instrumentId?: string;
  machineType?: string;
  protocol?: string;
  connectionMode?: string;
  testType?: string;
  outcome?: TelemetryOutcome;
  failureCode?: string;
  count?: number;
}
