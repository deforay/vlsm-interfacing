// src/app/interfaces/connection-params.interface.ts

export interface ConnectionParams {
  connectionMode?: 'tcpserver' | 'tcpclient';
  connectionProtocol: string;
  host: string;
  port: number;
  instrumentId: string;
  machineType: string;
  labName: string;
  interfaceAutoConnect: string;
}
