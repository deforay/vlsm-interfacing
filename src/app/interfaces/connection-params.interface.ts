// src/app/interfaces/connection-params.interface.ts

import { CommunicationProtocol, ConnectionMode } from '../constants/domain.constants';

export interface ConnectionParams {
  instrumentIndex?: number;
  connectionMode?: ConnectionMode;
  connectionProtocol: CommunicationProtocol;
  host: string;
  port: number;
  instrumentId: string;
  machineType: string;
  labName: string;
  displayorder?: number;
  interfaceAutoConnect: string;
}
