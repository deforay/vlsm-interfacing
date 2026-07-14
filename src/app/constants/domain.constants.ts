export const CONNECTION_MODE = {
  SERVER: 'tcpserver',
  CLIENT: 'tcpclient'
} as const;

export type ConnectionMode = typeof CONNECTION_MODE[keyof typeof CONNECTION_MODE];

export const COMMUNICATION_PROTOCOL = {
  HL7: 'hl7',
  ASTM_CHECKSUM: 'astm-checksum',
  ASTM_NON_CHECKSUM: 'astm-nonchecksum'
} as const;

export type CommunicationProtocol = typeof COMMUNICATION_PROTOCOL[keyof typeof COMMUNICATION_PROTOCOL];

export const AUTO_CONNECT = {
  ENABLED: 'yes',
  DISABLED: 'no'
} as const;

export const LIMS_SYNC_STATUS = {
  PENDING: 0,
  SYNCED: 1,
  FAILED: 2
} as const;

export const BACKGROUND_INTERVAL_MS = {
  CONNECTION_STATUS: 5_000,
  MYSQL_HEALTH: 15_000,
  LIMS_STATUS_PULL: 30_000,
  RESULT_REFRESH: 5 * 60_000,
  WAL_CHECKPOINT: 30 * 60_000
} as const;
