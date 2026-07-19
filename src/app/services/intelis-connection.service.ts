import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { ElectronService } from '../core/services';
import {
  IntelisConnectRequest,
  IntelisConnectionState,
  IntelisIpcResult
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
