// src/app/interfaces/instrument-connections.interface.ts

import { BehaviorSubject } from 'rxjs';

export interface InstrumentConnections {
  connectionMode?: 'tcpserver' | 'tcpclient';
  connectionProtocol?: string;
  instrumentId?: string;
  labName?: string;
  machineType?: string;
  statusSubject: BehaviorSubject<boolean>;
  connectionAttemptStatusSubject: BehaviorSubject<boolean>;
  connectionSocket?: any;
  connectionServer?: any;
}
