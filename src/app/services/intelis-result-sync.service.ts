import { Injectable, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  getIntelisResultDeliveryLimits,
  planIntelisResultBatches
} from '../../../shared/intelis-connection';
import { BACKGROUND_INTERVAL_MS } from '../constants/domain.constants';
import { DatabaseService } from './database.service';
import { IntelisConnectionService } from './intelis-connection.service';
import { LoggingService } from './logging.service';

@Injectable({ providedIn: 'root' })
export class IntelisResultSyncService implements OnDestroy {
  private started = false;
  private inFlight = false;
  private rerunRequested = false;
  private retryDelayMs: number = BACKGROUND_INTERVAL_MS.RESULT_API_RETRY_INITIAL;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private resultRecordedSubscription: Subscription | null = null;
  private lastFailureCode: string | null = null;
  private profileRefreshedThisSession = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly connection: IntelisConnectionService,
    private readonly logging: LoggingService
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.resultRecordedSubscription = this.database.resultRecorded$.subscribe(() => this.schedule(1_000));
    this.schedule(1_000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.resultRecordedSubscription?.unsubscribe();
  }

  private schedule(delayMs: number): void {
    if (!this.started) return;
    if (this.inFlight) {
      this.rerunRequested = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), delayMs);
  }

  private async run(): Promise<void> {
    if (this.inFlight) {
      this.rerunRequested = true;
      return;
    }

    this.timer = null;
    this.inFlight = true;
    let retryRequired = false;

    try {
      retryRequired = !(await this.synchronize());
    } catch (error) {
      retryRequired = true;
      this.logFailure('local_sync_error', `Result delivery could not read or update its local queue: ${error?.message ?? error}`);
    } finally {
      this.inFlight = false;
    }

    if (this.rerunRequested) {
      this.rerunRequested = false;
      this.schedule(1_000);
      return;
    }

    if (retryRequired) {
      const delay = this.retryDelayMs;
      this.retryDelayMs = Math.min(
        this.retryDelayMs * 2,
        BACKGROUND_INTERVAL_MS.RESULT_API_RETRY_MAX
      );
      this.schedule(delay);
      return;
    }

    this.retryDelayMs = BACKGROUND_INTERVAL_MS.RESULT_API_RETRY_INITIAL;
    this.schedule(BACKGROUND_INTERVAL_MS.RESULT_API_IDLE);
  }

  private async synchronize(): Promise<boolean> {
    let stateResult = await this.connection.load();
    if (!stateResult.ok || !stateResult.data?.configured) return true;

    let limits = getIntelisResultDeliveryLimits(stateResult.data.connection);
    if (!this.profileRefreshedThisSession || !limits) {
      // Refresh once per application session so cached limits cannot outlive a
      // server change, and older installations gain new capabilities without
      // being paired again.
      stateResult = await this.connection.refresh();
      if (!stateResult.ok) {
        this.logFailure(stateResult.error?.code || 'connection_refresh_failed', stateResult.error?.message);
        return false;
      }
      this.profileRefreshedThisSession = true;
      limits = getIntelisResultDeliveryLimits(stateResult.data?.connection);
      if (!limits) return true;
    }

    const pendingPage = await this.database.fetchPendingIntelisResults(limits.maxItems);
    const pendingRows = pendingPage.rows;
    if (pendingPage.oversizedResultCount > 0) {
      this.logFailure(
        'local_result_group_too_large',
        `At least ${pendingPage.oversizedResultCount} pending results belong to one run that exceeds the server item limit.`
      );
      return false;
    }
    if (pendingRows.length === 0) return true;

    const plan = planIntelisResultBatches(pendingRows, limits);
    let retryAcknowledged = false;
    if (plan.oversizedResultIds.length > 0) {
      this.logFailure(
        'local_result_group_too_large',
        `${plan.oversizedResultIds.length} pending result(s) exceed the server limits and require review.`
      );
    }

    for (const batch of plan.batches) {
      const response = await this.connection.submitResults(batch);
      if (!response.ok || !response.data) {
        this.logFailure(response.error?.code || 'result_submission_failed', response.error?.message);
        return false;
      }

      // Status values are authoritative server acknowledgements. Never infer a
      // local status from HTTP success or from the textual outcome.
      await this.database.applyIntelisResultAcknowledgements(response.data.results);
      retryAcknowledged ||= response.data.results.some(result => result.limsSyncStatus === 0);
      await this.database.recordTelemetryEvent({
        eventType: 'result.delivery_completed',
        category: 'test',
        outcome: 'success',
        count: response.data.results.length
      });
    }

    this.lastFailureCode = null;
    this.database.resyncTestResultsToMySQL(() => {}, () => {});
    this.database.resyncIntelisStatusesToMySQL(() => {}, () => {});
    if (pendingPage.hasMore) this.rerunRequested = true;
    return plan.oversizedResultIds.length === 0 && !retryAcknowledged;
  }

  private logFailure(code: string, message?: string): void {
    if (this.lastFailureCode === code) return;
    this.lastFailureCode = code;
    this.logging.logSystemError(
      `Result delivery needs attention (${code}): ${message || 'The request will be retried automatically.'}`,
      undefined,
      true
    );
    void this.database.recordTelemetryEvent({
      eventType: 'result.delivery_failed',
      category: 'failure',
      outcome: 'failed',
      failureCode: code
    });
  }
}
