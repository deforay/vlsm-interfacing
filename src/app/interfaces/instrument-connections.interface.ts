// src/app/interfaces/instrument-connections.interface.ts

import { BehaviorSubject } from 'rxjs';
import { CommunicationProtocol, ConnectionMode } from '../constants/domain.constants';

export interface InstrumentConnectionStack {
  connectionMode?: ConnectionMode;
  connectionProtocol?: CommunicationProtocol;
  instrumentId?: string;
  labName?: string;
  machineType?: string;
  statusSubject: BehaviorSubject<boolean>;
  connectionAttemptStatusSubject: BehaviorSubject<boolean>;
  transmissionStatusSubject: BehaviorSubject<boolean>;
  connectionSocket?: any;
  connectionServer?: any;
  errorOccurred: boolean;
  reconnectAttempts: number;
  idleHeartbeatTimer?: any;
  listeningSince?: Date;
  pendingReconnectTimer?: any;
}
