import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { ElectronService } from '../core/services';
import {
  IntelisConnectRequest,
  IntelisActivityEvent,
  IntelisActivitySubmissionResponse,
  IntelisConnectionState,
  IntelisIpcResult,
  IntelisResultRow,
  IntelisResultSubmissionResponse,
  IntelisUsageSubmissionResponse,
  IntelisUsageSummary
} from '../../../shared/intelis-connection';

@Injectable({ providedIn: 'root' })
export class IntelisConnectionService {
  private readonly state = new BehaviorSubject<IntelisConnectionState>({ configured: false });

  constructor(private readonly electron: ElectronService) {}

  stateChanges(): Observable<IntelisConnectionState> {
    return this.state.asObservable();
  }

  currentState(): IntelisConnectionState {
    return this.state.getValue();
  }

  async load(): Promise<IntelisIpcResult<IntelisConnectionState>> {
    return this.invoke('intelis-connection-get');
  }

  async connect(request: IntelisConnectRequest): Promise<IntelisIpcResult<IntelisConnectionState>> {
    return this.invoke('intelis-connection-connect', request);
  }

  async refresh(): Promise<IntelisIpcResult<IntelisConnectionState>> {
    return this.invoke('intelis-connection-refresh');
  }

  async forget(): Promise<IntelisIpcResult<IntelisConnectionState>> {
    return this.invoke('intelis-connection-forget');
  }

  async submitResults(results: IntelisResultRow[]): Promise<IntelisIpcResult<IntelisResultSubmissionResponse>> {
    if (!this.electron.isElectron || !this.electron.ipcRenderer) {
      return {
        ok: false,
        error: {
          code: 'desktop_required',
          message: 'Result submission is available in the desktop application.'
        }
      };
    }

    try {
      return await this.electron.ipcRenderer.invoke('intelis-results-submit', { results });
    } catch {
      return {
        ok: false,
        error: {
          code: 'connection_unavailable',
          message: 'The result submission service is unavailable.'
        }
      };
    }
  }

  async submitActivity(events: IntelisActivityEvent[]): Promise<IntelisIpcResult<IntelisActivitySubmissionResponse>> {
    return this.invokeSubmission('intelis-activity-submit', { events }, 'activity');
  }

  async submitUsageStatistics(
    summaries: IntelisUsageSummary[]
  ): Promise<IntelisIpcResult<IntelisUsageSubmissionResponse>> {
    return this.invokeSubmission('intelis-usage-statistics-submit', { summaries }, 'usage statistics');
  }

  private async invokeSubmission<T>(
    channel: string,
    payload: unknown,
    label: string
  ): Promise<IntelisIpcResult<T>> {
    if (!this.electron.isElectron || !this.electron.ipcRenderer) {
      return {
        ok: false,
        error: { code: 'desktop_required', message: `${label} submission is available in the desktop application.` }
      };
    }

    try {
      return await this.electron.ipcRenderer.invoke(channel, payload);
    } catch {
      return {
        ok: false,
        error: { code: 'connection_unavailable', message: `The ${label} submission service is unavailable.` }
      };
    }
  }

  private async invoke(channel: string, payload?: unknown): Promise<IntelisIpcResult<IntelisConnectionState>> {
    if (!this.electron.isElectron || !this.electron.ipcRenderer) {
      return {
        ok: false,
        error: {
          code: 'desktop_required',
          message: 'InteLIS connection management is available in the desktop application.'
        }
      };
    }

    try {
      const result = await this.electron.ipcRenderer.invoke(channel, payload) as IntelisIpcResult<IntelisConnectionState>;
      if (result.data) this.state.next(result.data);
      return result;
    } catch {
      return {
        ok: false,
        error: {
          code: 'connection_unavailable',
          message: 'The InteLIS connection service is unavailable.'
        }
      };
    }
  }
}
