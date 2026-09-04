import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { AvailableRelease, resolveUpdateNudge } from '../../../shared/update-check';
import { ElectronService } from '../core/services';
import { ElectronStoreService } from './electron-store.service';

/** How long between asking. A release is not news that needs to arrive quickly. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Long enough after startup that connecting instruments comes first. */
const FIRST_CHECK_DELAY_MS = 30_000;
const DISMISSED_VERSION_KEY = 'dismissedUpdateVersion';

/**
 * Tells the operator when a newer version has been published, and nothing else.
 *
 * WHY the release feed rather than the laboratory's own system: this tool is
 * meant to stand on its own in front of any information system, and a version
 * check routed through one vendor's server would quietly make it that vendor's
 * tool. The releases are public; anyone running this can ask about them without
 * asking anyone's permission, and a laboratory with no LIS connection
 * configured at all is told just the same.
 *
 * WHY not automatic updates: the Windows and macOS builds would need signing
 * certificates for an unattended install to be anything but alarming, the
 * portable build cannot be updated in place at all, and on Debian the package
 * is the distribution's to manage. More to the point, a machine sitting between
 * an analyzer and a laboratory information system should not restart itself
 * mid-run because a release happened. So this says there is one, and leaves the
 * decision with the laboratory.
 */
@Injectable({ providedIn: 'root' })
export class UpdateCheckService implements OnDestroy {
  private readonly available = new BehaviorSubject<AvailableRelease | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  constructor(
    private readonly electron: ElectronService,
    private readonly store: ElectronStoreService
  ) {}

  /** What to show, or null when there is nothing worth saying. */
  availableUpdate(): Observable<AvailableRelease | null> {
    return this.available.asObservable();
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.schedule(FIRST_CHECK_DELAY_MS);
  }

  ngOnDestroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }

  /**
   * Stops this version being mentioned again. A later one still will: the
   * version is remembered rather than the fact of dismissing.
   */
  dismiss(version: string): void {
    this.store.set(DISMISSED_VERSION_KEY, version);
    this.available.next(null);
  }

  async openReleasesPage(): Promise<void> {
    if (!this.electron.isElectron || !this.electron.ipcRenderer) {
      return;
    }
    try {
      await this.electron.ipcRenderer.invoke('update-check-open-releases');
    } catch {
      // Nothing to recover: the version is on screen either way.
    }
  }

  /** Asks what the newest published release is, and works out whether to say so. */
  async check(): Promise<void> {
    const currentVersion = this.store.get('appVersion');
    if (!currentVersion) {
      return;
    }

    this.available.next(resolveUpdateNudge({
      currentVersion,
      publishedVersion: await this.fetchPublishedVersion(),
      dismissedVersion: this.store.get(DISMISSED_VERSION_KEY)
    }));
  }

  private async fetchPublishedVersion(): Promise<string | null> {
    if (!this.electron.isElectron || !this.electron.ipcRenderer) {
      return null;
    }
    try {
      const result = await this.electron.ipcRenderer.invoke('update-check-latest-release');
      return typeof result?.version === 'string' ? result.version : null;
    } catch {
      // No route out is the normal state in many laboratories, not a fault.
      return null;
    }
  }

  private schedule(delayMs: number): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      void this.check().finally(() => this.schedule(CHECK_INTERVAL_MS));
    }, delayMs);
  }
}
