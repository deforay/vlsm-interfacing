// src/app/interfaces/connection-params.interface.ts

export interface ConnectionParams {
  instrumentIndex?: number;
  connectionMode?: 'tcpserver' | 'tcpclient';
  connectionProtocol: string;
  host: string;
  port: number;
  instrumentId: string;
  machineType: string;
  labName: string;
  displayorder?: number;
  interfaceAutoConnect: string;
}
