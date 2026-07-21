import { Injectable, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  getIntelisActivityDeliveryLimits,
  getIntelisUsageDeliveryLimits
} from '../../../shared/intelis-connection';
import { BACKGROUND_INTERVAL_MS } from '../constants/domain.constants';
import { DatabaseService } from './database.service';
import { IntelisConnectionService } from './intelis-connection.service';
import { LoggingService } from './logging.service';

@Injectable({ providedIn: 'root' })
export class IntelisUsageSyncService implements OnDestroy {
  private started = false;
  private inFlight = false;
  private rerunRequested = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private subscription: Subscription | null = null;
  private retryDelayMs: number = BACKGROUND_INTERVAL_MS.RESULT_API_RETRY_INITIAL;
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
    this.subscription = this.database.usageRecorded$.subscribe(() => this.schedule(1_000));
    this.schedule(2_000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.subscription?.unsubscribe();
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
    if (this.inFlight) return;
    this.timer = null;
    this.inFlight = true;
    let completed = false;
    try {
      completed = await this.synchronize();
    } catch (error) {
      this.logFailure('usage_sync_error', `Usage reporting could not update its local queue: ${error?.message ?? error}`);
    } finally {
      this.inFlight = false;
    }

    if (this.rerunRequested) {
      this.rerunRequested = false;
      this.schedule(1_000);
      return;
    }
    if (!completed) {
      const delay = this.retryDelayMs;
      this.retryDelayMs = Math.min(this.retryDelayMs * 2, BACKGROUND_INTERVAL_MS.RESULT_API_RETRY_MAX);
      this.schedule(delay);
      return;
    }
    this.retryDelayMs = BACKGROUND_INTERVAL_MS.RESULT_API_RETRY_INITIAL;
    this.schedule(BACKGROUND_INTERVAL_MS.RESULT_API_IDLE);
  }

  private async synchronize(): Promise<boolean> {
    let stateResult = await this.connection.load();
    if (!stateResult.ok || !stateResult.data?.configured) return true;

    if (!this.profileRefreshedThisSession) {
      stateResult = await this.connection.refresh();
      if (!stateResult.ok) {
        this.logFailure(stateResult.error?.code || 'connection_refresh_failed', stateResult.error?.message);
        return false;
      }
      this.profileRefreshedThisSession = true;
    }

    const profile = stateResult.data?.connection;
    const activityLimits = getIntelisActivityDeliveryLimits(profile);
    const usageLimits = getIntelisUsageDeliveryLimits(profile);
    if (activityLimits && !(await this.synchronizeActivity(activityLimits.maxItems))) return false;
    if (usageLimits && !(await this.synchronizeDailyUsage(usageLimits.maxItems))) return false;

    this.lastFailureCode = null;
    return true;
  }

  private async synchronizeActivity(maxItems: number): Promise<boolean> {
    const events = await this.database.fetchPendingIntelisActivity(maxItems);
    if (events.length === 0) return true;
    const response = await this.connection.submitActivity(events);
    if (!response.ok || !response.data) {
      this.logFailure(response.error?.code || 'activity_submission_failed', response.error?.message);
      return false;
    }
    await this.database.acknowledgeIntelisActivity(events);
    if (events.length === maxItems) this.rerunRequested = true;
    return true;
  }

  private async synchronizeDailyUsage(maxItems: number): Promise<boolean> {
    const summaries = await this.database.fetchPendingIntelisUsageStatistics(maxItems);
    if (summaries.length === 0) return true;
    const response = await this.connection.submitUsageStatistics(summaries);
    if (!response.ok || !response.data) {
      this.logFailure(response.error?.code || 'usage_submission_failed', response.error?.message);
      return false;
    }

    const accepted = response.data.summaries.filter(summary => summary.outcome !== 'rejected');
    await this.database.acknowledgeIntelisUsageStatistics(accepted);
    if (response.data.rejected > 0) {
      this.logFailure(
        'usage_summary_rejected',
        `${response.data.rejected} daily usage summary row(s) need attention and remain queued.`
      );
      return false;
    }
    if (summaries.length === maxItems) this.rerunRequested = true;
    return true;
  }

  private logFailure(code: string, message?: string): void {
    if (this.lastFailureCode === code) return;
    this.lastFailureCode = code;
    this.logging.logSystemError(
      `Usage reporting needs attention (${code}): ${message || 'The request will be retried automatically.'}`,
      undefined,
      true
    );
  }
}
