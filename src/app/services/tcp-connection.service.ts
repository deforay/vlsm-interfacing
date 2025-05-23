import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { ElectronService } from '../core/services';
import { ConnectionParams } from '../interfaces/connection-params.interface';
import { InstrumentConnectionStack } from '../interfaces/intrument-connections.interface';
import { UtilitiesService } from './utilities.service';

interface ConnectionHealth {
  lastDataReceived: Date;
  bytesReceived: number;
  bytesSent: number;
  reconnectCount: number;
  lastHeartbeat: Date;
  lastDataSent: Date;
}

@Injectable({
  providedIn: 'root'
})
export class TcpConnectionService implements OnDestroy {

  public connectionParams: ConnectionParams = null;
  private heartbeatIntervals: Map<string, any> = new Map();
  private readonly heartbeatInterval = 30000; // 30 seconds
  private readonly heartbeatTimeout = 10000;  // 10 seconds
  private readonly MAX_RECONNECT_ATTEMPTS = 10; // Maximum reconnection attempts
  protected handleTCPCallback: (connectionIdentifierKey: string, data: any) => void;
  public socketClient = null;
  public server = null;
  public net = null;
  private readonly SEND_BUFFER_SIZE = 65536; // 64KB
  private readonly RECEIVE_BUFFER_SIZE = 262144; // 256KB
  private processingQueue: Map<string, boolean> = new Map();

  protected clientConnectionOptions: any = null;

  public connectionStack: Map<string, InstrumentConnectionStack> = new Map();
  private connectionHealth: Map<string, ConnectionHealth> = new Map();
  private dataQueue: Map<string, Buffer[]> = new Map();

  public connectionTimeout = 300000; // 5 minutes in milliseconds

  constructor(
    public electronService: ElectronService,
    public utilitiesService: UtilitiesService
  ) {
    this.net = this.electronService.net;
  }

  ngOnDestroy() {
    // Clean up all heartbeat intervals
    this.heartbeatIntervals.forEach(interval => clearInterval(interval));
    this.heartbeatIntervals.clear();

    // Disconnect all active connections
    this.connectionStack.forEach((connection, key) => {
      const connectionParams = this.parseConnectionKey(key);
      if (connectionParams) {
        this.disconnect(connectionParams);
      }
    });

    // Clear all maps
    this.connectionHealth.clear();
    this.dataQueue.clear();
  }

  // Helper method to parse connection key back to connection params
  private parseConnectionKey(key: string): ConnectionParams | null {
    const parts = key.split(':');
    if (parts.length < 4) return null;

    // This is a simplified version - you'd need to reconstruct the full ConnectionParams
    return {
      host: parts[0],
      port: parseInt(parts[1]),
      connectionMode: parts[2] as any,
      connectionProtocol: parts[3]
    } as ConnectionParams;
  }

  // Method used to connect to the Testing Machine
  connect(connectionParams: ConnectionParams, handleTCPCallback: (connectionIdentifierKey: string, data: any) => void) {

    const that = this;
    that.handleTCPCallback = handleTCPCallback;
    let instrumentConnectionData: InstrumentConnectionStack = null;

    const connectionIdentifierKey = that._generateConnectionIdentifierKey(connectionParams);

    // Initialize connection health tracking
    if (!that.connectionHealth.has(connectionIdentifierKey)) {
      that.connectionHealth.set(connectionIdentifierKey, {
        lastDataReceived: new Date(),
        bytesReceived: 0,
        bytesSent: 0,
        reconnectCount: 0,
        lastHeartbeat: new Date(),
        lastDataSent: new Date(0) // Initialize to a very old date (epoch). This signifies no data has been sent yet.
      });
    }

    // Initialize data queue for this connection
    if (!that.dataQueue.has(connectionIdentifierKey)) {
      that.dataQueue.set(connectionIdentifierKey, []);
    }

    if (that.connectionStack.has(connectionIdentifierKey)) {
      instrumentConnectionData = that.connectionStack.get(connectionIdentifierKey);
    }
    else {

      const statusSubject = new BehaviorSubject(false);
      const transmissionStatusSubject = new BehaviorSubject(false);
      const connectionAttemptStatusSubject = new BehaviorSubject(false);

      instrumentConnectionData = {
        connectionMode: connectionParams.connectionMode,
        connectionProtocol: connectionParams.connectionProtocol,
        instrumentId: connectionParams.instrumentId,
        labName: connectionParams.labName,
        machineType: connectionParams.machineType,
        statusSubject: statusSubject,
        connectionAttemptStatusSubject: connectionAttemptStatusSubject,
        transmissionStatusSubject: transmissionStatusSubject,
        connectionSocket: null,
        connectionServer: null,
        errorOccurred: false,
        reconnectAttempts: 0,
      };

      that.connectionStack.set(connectionIdentifierKey, instrumentConnectionData);
    }

    instrumentConnectionData.connectionAttemptStatusSubject.next(true);

    if (connectionParams.connectionMode === 'tcpserver') {
      that.utilitiesService.logger('info', 'Listening for connection on port ' + connectionParams.port, instrumentConnectionData.instrumentId);
      instrumentConnectionData.connectionServer = that.net.createServer();
      instrumentConnectionData.connectionServer.listen({
        port: connectionParams.port,
        host: connectionParams.host,
        reuseAddress: true
      });

      const sockets = [];
      instrumentConnectionData.connectionServer.on('connection', function (socket) {
        const clientAddress = socket.remoteAddress;
        that.utilitiesService.logger('info', (new Date()) + ' : A remote client (' + clientAddress + ') has connected to the Interfacing Server', instrumentConnectionData.instrumentId);

        sockets.push(socket);
        that.socketClient = socket;

        // Enable TCP keep-alive with a 1-minute interval
        socket.setKeepAlive(true, 60000);

        // Set socket options for better performance
        socket.setNoDelay(true);
        socket.setRecvBufferSize(that.RECEIVE_BUFFER_SIZE);
        socket.setSendBufferSize(that.SEND_BUFFER_SIZE);

        // Set timeout for the server socket
        socket.setTimeout(that.connectionTimeout);

        socket.on('timeout', () => {
          if (that.connectionTimeout === 300000) {
            that.utilitiesService.logger('info', 'Increasing timeout to 10 minutes after timeout event', instrumentConnectionData.instrumentId);
            that.connectionTimeout = 600000; // 10 minutes
          }
          that.utilitiesService.logger('info', 'Server socket timeout', instrumentConnectionData.instrumentId);
          that._handleClientConnectionIssue(instrumentConnectionData, connectionParams, 'Client socket timeout', true);
          socket.end();
        });

        socket.on('data', function (data: any) {
          instrumentConnectionData.statusSubject.next(true);
          instrumentConnectionData.reconnectAttempts = 0;

          // Update connection health
          const health = that.connectionHealth.get(connectionIdentifierKey);
          if (health) {
            health.lastDataReceived = new Date();
            health.bytesReceived += data.length;
          }

          that.handleTCPCallback(connectionIdentifierKey, data);
          that.connectionTimeout = 300000; // Reset to 5 minutes

          // Process any queued data
          that.processQueuedData(connectionIdentifierKey);
        });

        instrumentConnectionData.connectionSocket = that.socketClient;
        instrumentConnectionData.statusSubject.next(true);

        // Start heartbeat for this connection
        that.startHeartbeat(connectionParams);

        socket.on('close', function () {
          if (instrumentConnectionData.errorOccurred) {
            instrumentConnectionData.errorOccurred = false;
            return;
          }
          const index = sockets.findIndex(function (o) {
            return o.remoteAddress === socket.remoteAddress && o.remotePort === socket.remotePort;
          });
          if (index !== -1) {
            sockets.splice(index, 1);
          }
          console.log('CLOSED: ' + socket.remoteAddress + ' ' + socket.remotePort);
        });

      });

      instrumentConnectionData.connectionServer.on('close', () => {
        that.utilitiesService.logger('info', 'Server closed', instrumentConnectionData.instrumentId);
      });

      instrumentConnectionData.connectionServer.on('error', function (e) {
        instrumentConnectionData.errorOccurred = true;
        if (e.code === 'EADDRINUSE') {
          that.utilitiesService.logger('error', `Error: Port ${connectionParams.port} is already in use. Disconnecting to attempt again later.`, instrumentConnectionData.instrumentId);

          const tempSocket = new that.net.Socket();
          tempSocket.on('error', function () {
            tempSocket.destroy();
          });

          tempSocket.connect(connectionParams.port, connectionParams.host, function () {
            that.utilitiesService.logger('info', `Found process using port ${connectionParams.port}, sending reset signal`, instrumentConnectionData.instrumentId);
            tempSocket.end();
          });
        } else {
          that.utilitiesService.logger('error', 'Error while connecting ' + e.code, instrumentConnectionData.instrumentId);
        }
      });

    } else if (connectionParams.connectionMode === 'tcpclient') {
      instrumentConnectionData.connectionSocket = that.socketClient = new that.net.Socket({
        highWaterMark: that.SEND_BUFFER_SIZE,
        allowHalfOpen: false,
        noDelay: true
      });
      that.clientConnectionOptions = {
        port: connectionParams.port,
        host: connectionParams.host,
        reuseAddress: true
      };

      instrumentConnectionData.connectionServer = null;

      that.utilitiesService.logger('info', 'Trying to connect as client', instrumentConnectionData.instrumentId);

      instrumentConnectionData.connectionSocket.connect(that.clientConnectionOptions);
      instrumentConnectionData.connectionSocket.setTimeout(that.connectionTimeout);
      instrumentConnectionData.connectionSocket.setKeepAlive(true, 60000);

      instrumentConnectionData.connectionSocket.on('timeout', () => {
        if (that.connectionTimeout === 300000) {
          that.utilitiesService.logger('info', 'Increasing timeout to 10 minutes after timeout event', instrumentConnectionData.instrumentId);
          that.connectionTimeout = 600000;
        }
        that.utilitiesService.logger('info', 'Client socket timeout', instrumentConnectionData.instrumentId);
        that._handleClientConnectionIssue(instrumentConnectionData, connectionParams, 'Server socket timeout', true);
      });

      instrumentConnectionData.connectionSocket.on('connect', function () {
        that.connectionTimeout = 300000;
        instrumentConnectionData.statusSubject.next(true);
        instrumentConnectionData.reconnectAttempts = 0;

        instrumentConnectionData.connectionSocket.setRecvBufferSize(that.RECEIVE_BUFFER_SIZE);
        instrumentConnectionData.connectionSocket.setSendBufferSize(that.SEND_BUFFER_SIZE);

        that.utilitiesService.logger('success', 'Connected as client successfully', instrumentConnectionData.instrumentId);

        // Start heartbeat
        that.startHeartbeat(connectionParams);

        // Process any queued data
        that.processQueuedData(connectionIdentifierKey);
      });

      instrumentConnectionData.connectionSocket.on('data', function (data) {
        instrumentConnectionData.statusSubject.next(true);
        instrumentConnectionData.reconnectAttempts = 0;

        // Update connection health
        const health = that.connectionHealth.get(connectionIdentifierKey);
        if (health) {
          health.lastDataReceived = new Date();
          health.bytesReceived += data.length;
        }

        that.handleTCPCallback(connectionIdentifierKey, data);
      });

      instrumentConnectionData.connectionSocket.on('error', (err) => {
        instrumentConnectionData.errorOccurred = true;
        that._handleClientConnectionIssue(instrumentConnectionData, connectionParams, `Connection error: ${err.message}`, true);
      });

      instrumentConnectionData.connectionSocket.on('close', (hadError) => {
        if (instrumentConnectionData.errorOccurred) {
          instrumentConnectionData.errorOccurred = false;
          return;
        }
        const message = hadError ? 'Connection closed due to a transmission error' : 'Connection closed';
        that._handleClientConnectionIssue(instrumentConnectionData, connectionParams, message, hadError);
      });
    }
  }

  private startHeartbeat(connectionParams: ConnectionParams) {
    const key = this._generateConnectionIdentifierKey(connectionParams);
    const instrumentConnectionData = this.connectionStack.get(key);

    if (!instrumentConnectionData) return;

    // Adaptive heartbeat interval based on connection type
    let adaptiveHeartbeatInterval = this.heartbeatInterval;

    if (connectionParams.connectionMode === 'tcpserver') {
      adaptiveHeartbeatInterval = 60000; // 60 seconds for server connections
    }

    this.stopHeartbeat(connectionParams);

    const interval = setInterval(() => {
      if (instrumentConnectionData.statusSubject.getValue()) {
        this.sendHeartbeat(connectionParams);
      } else {
        this.stopHeartbeat(connectionParams);
      }
    }, adaptiveHeartbeatInterval); // Fixed: Use adaptive interval

    this.heartbeatIntervals.set(key, interval);
  }

  private stopHeartbeat(connectionParams: ConnectionParams) {
    const key = this._generateConnectionIdentifierKey(connectionParams);
    if (this.heartbeatIntervals.has(key)) {
      clearInterval(this.heartbeatIntervals.get(key));
      this.heartbeatIntervals.delete(key);
    }
  }

  private sendHeartbeat(connectionParams: ConnectionParams) {
    const key = this._generateConnectionIdentifierKey(connectionParams);
    const health = this.connectionHealth.get(key); // health is fetched here
    const instrumentConnectionData = this.connectionStack.get(key);

    if (!instrumentConnectionData || !instrumentConnectionData.connectionSocket || !health) return;

    const now = Date.now();
    const lastReceived = health.lastDataReceived.getTime();
    // Use health.lastDataSent directly, it's initialized to new Date(0)
    const lastSent = health.lastDataSent.getTime();

    // Check for critical inactivity from peer first
    if (now - lastReceived > this.heartbeatTimeout) {
      console.warn(`No data received from ${connectionParams.instrumentId} in ${this.heartbeatTimeout / 1000}s`);
      this._handleDisconnection(connectionParams, 'Inactivity timeout');
      return;
    }

    const adaptiveHeartbeatInterval = connectionParams.connectionMode === 'tcpserver' ? 60000 : this.heartbeatInterval;
    const activeCommunicationThreshold = adaptiveHeartbeatInterval / 2; // Or a fixed value e.g. 10000 (10s)

    if ((now - lastReceived < activeCommunicationThreshold) || (now - lastSent < activeCommunicationThreshold)) {
      // console.log(`Heartbeat skipped for ${connectionParams.instrumentId} due to recent traffic.`);
      health.lastHeartbeat = new Date(); // Update to show heartbeat cycle was considered
      return;
    }

    try {
      let sentHeartbeatDataLength = 0;
      if (connectionParams.connectionProtocol.includes('astm')) {
        const astmData = String.fromCharCode(5); // ENQ
        instrumentConnectionData.connectionSocket.write(astmData);
        sentHeartbeatDataLength = Buffer.byteLength(astmData, 'utf8');
      } else if (connectionParams.connectionProtocol.includes('hl7')) {
        const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').substring(0, 14);
        const hl7Data = '\x0B' + `MSH|^~\\&|||||${timestamp}||ACK^A01|1|P|2.5.1\r` + '\x1C' + '\x0D';
        instrumentConnectionData.connectionSocket.write(hl7Data);
        sentHeartbeatDataLength = Buffer.byteLength(hl7Data, 'utf8');
      } else {
        const emptyData = Buffer.from([]);
        instrumentConnectionData.connectionSocket.write(emptyData);
        sentHeartbeatDataLength = emptyData.length; // Will be 0
      }

      // Update health for sent heartbeat data
      // 'health' is already available from the top of the function
      health.bytesSent += sentHeartbeatDataLength;
      health.lastDataSent = new Date(); // <--- ADD THIS LINE (heartbeat is sent data)

    } catch (err) {
      console.error(`Failed to send heartbeat to ${connectionParams.instrumentId}:`, err);
      this._handleDisconnection(connectionParams, 'Heartbeat send error');
      return; // Ensure execution stops if disconnection is handled
    }

    health.lastHeartbeat = new Date(); // This marks that the heartbeat logic/cycle completed
  }



  private _handleDisconnection(connectionParams: ConnectionParams, reason: string) {
    console.warn(`Disconnecting ${connectionParams.instrumentId} due to: ${reason}`);

    const key = this._generateConnectionIdentifierKey(connectionParams);
    const instrumentConnectionData = this.connectionStack.get(key);

    if (instrumentConnectionData) {
      instrumentConnectionData.statusSubject.next(false);
      instrumentConnectionData.errorOccurred = true;

      this.utilitiesService.logger('warning', `Connection lost: ${reason}`, connectionParams.instrumentId);

      this.disconnect(connectionParams);

      if (connectionParams.interfaceAutoConnect === 'yes') {
        this._handleClientConnectionIssue(instrumentConnectionData, connectionParams, `Connection lost: ${reason}`, true);
      }
    }
  }

  private _handleClientConnectionIssue(instrumentConnectionData, connectionParams, message, isError) {
    let that = this;
    instrumentConnectionData.statusSubject.next(false);
    that.disconnect(connectionParams);

    if (isError) {
      that.utilitiesService.logger('error', message, instrumentConnectionData.instrumentId);
    }

    if (connectionParams.interfaceAutoConnect === 'yes') {
      // Check if we've exceeded max reconnection attempts
      if (instrumentConnectionData.reconnectAttempts >= that.MAX_RECONNECT_ATTEMPTS) {
        that.utilitiesService.logger('error',
          `Max reconnection attempts (${that.MAX_RECONNECT_ATTEMPTS}) reached for ${instrumentConnectionData.instrumentId}. Stopping auto-reconnect.`,
          instrumentConnectionData.instrumentId
        );

        // Update connection health
        const key = that._generateConnectionIdentifierKey(connectionParams);
        const health = that.connectionHealth.get(key);
        if (health) {
          health.reconnectCount = instrumentConnectionData.reconnectAttempts;
        }

        // Reset attempts counter but don't try to reconnect
        instrumentConnectionData.reconnectAttempts = 0;
        instrumentConnectionData.connectionAttemptStatusSubject.next(false);
        return;
      }

      instrumentConnectionData.connectionAttemptStatusSubject.next(true);
      const attempt = instrumentConnectionData.reconnectAttempts || 0;
      const delay = that.getRetryDelay(attempt);

      that.utilitiesService.logger('info',
        `Interface AutoConnect is enabled: Will re-attempt connection in ${delay / 1000} seconds (attempt ${attempt + 1}/${that.MAX_RECONNECT_ATTEMPTS})`,
        instrumentConnectionData.instrumentId
      );

      instrumentConnectionData.reconnectAttempts = attempt + 1;

      setTimeout(() => {
        that.connect(connectionParams, that.handleTCPCallback);
      }, delay);
    }
  }

  private getRetryDelay(attempt: number): number {
    const maxDelay = 300000; // Maximum delay of 5 minutes
    const baseDelay = 1000; // Start with 1 second
    return Math.min(maxDelay, baseDelay * Math.pow(2, attempt));
  }

  reconnect(connectionParams: ConnectionParams, handleTCPCallback: (connectionIdentifierKey: string, data: any) => void) {
    let that = this;

    // Reset reconnection attempts when manually reconnecting
    const key = that._generateConnectionIdentifierKey(connectionParams);
    const instrumentConnectionData = that.connectionStack.get(key);
    if (instrumentConnectionData) {
      instrumentConnectionData.reconnectAttempts = 0;
    }

    that.disconnect(connectionParams);
    that.connect(connectionParams, handleTCPCallback);
  }

  disconnect(connectionParams: ConnectionParams) {
    this.stopHeartbeat(connectionParams);
    const that = this;
    const connectionIdentifierKey = that._generateConnectionIdentifierKey(connectionParams);

    const instrumentConnectionData = that.connectionStack.get(connectionIdentifierKey);
    if (instrumentConnectionData) {
      try {
        console.log(`Disconnecting ${connectionParams.instrumentId} (${connectionParams.host}:${connectionParams.port})`);

        instrumentConnectionData.statusSubject.next(false);
        instrumentConnectionData.connectionAttemptStatusSubject.next(false);
        instrumentConnectionData.transmissionStatusSubject.next(false);

        if (instrumentConnectionData.connectionServer) {
          try {
            instrumentConnectionData.connectionServer.removeAllListeners();

            instrumentConnectionData.connectionServer.close(() => {
              console.log(`Server for ${connectionParams.instrumentId} closed`);
              instrumentConnectionData.connectionServer = null;
            });

            instrumentConnectionData.connectionServer.unref();

            setTimeout(() => {
              if (instrumentConnectionData.connectionServer) {
                console.warn(`Server for ${connectionParams.instrumentId} didn't close properly, forcing termination`);
                instrumentConnectionData.connectionServer = null;
              }
            }, 1000);
          } catch (serverError) {
            console.error(`Error closing server for ${connectionParams.instrumentId}:`, serverError);
            instrumentConnectionData.connectionServer = null;
          }
        }

        if (instrumentConnectionData.connectionSocket) {
          try {
            instrumentConnectionData.connectionSocket.removeAllListeners();
            instrumentConnectionData.connectionSocket.unref();

            instrumentConnectionData.connectionSocket.end(() => {
              console.log(`Socket for ${connectionParams.instrumentId} ended`);

              if (instrumentConnectionData.connectionSocket) {
                instrumentConnectionData.connectionSocket.destroy();
                instrumentConnectionData.connectionSocket = null;
                console.log(`Socket for ${connectionParams.instrumentId} destroyed`);
              }
            });

            setTimeout(() => {
              if (instrumentConnectionData.connectionSocket) {
                instrumentConnectionData.connectionSocket.destroy();
                instrumentConnectionData.connectionSocket = null;
                console.log(`Socket for ${connectionParams.instrumentId} force destroyed after timeout`);
              }
            }, 1000);
          } catch (socketError) {
            console.error(`Error closing socket for ${connectionParams.instrumentId}:`, socketError);
            if (instrumentConnectionData.connectionSocket) {
              instrumentConnectionData.connectionSocket.destroy();
              instrumentConnectionData.connectionSocket = null;
            }
          }
        }

        that.connectionStack.delete(connectionIdentifierKey);
        that.dataQueue.delete(connectionIdentifierKey)
        that.utilitiesService.logger('info', 'Disconnection complete', connectionParams.instrumentId);

      } catch (error) {
        that.utilitiesService.logger('error', `Error during disconnection: ${error}`, connectionParams.instrumentId);
        instrumentConnectionData.connectionSocket = null;
        instrumentConnectionData.connectionServer = null;
        that.connectionStack.delete(connectionIdentifierKey);
      }
    }
  }

  sendData(connectionParams: ConnectionParams, data: string) {
    const that = this;
    const connectionIdentifierKey = that._generateConnectionIdentifierKey(connectionParams);
    const instrumentConnectionData = that.connectionStack.get(connectionIdentifierKey);

    if (instrumentConnectionData && instrumentConnectionData.connectionSocket &&
      instrumentConnectionData.connectionSocket.writable) {

      instrumentConnectionData.transmissionStatusSubject.next(true);

      instrumentConnectionData.connectionSocket.write(data, 'utf8', (err) => {
        instrumentConnectionData.transmissionStatusSubject.next(false);

        if (err) {
          console.error('Failed to send data:', err);
          // Queue the data for retry
          that.queueData(connectionIdentifierKey, Buffer.from(data, 'utf8'));
        } else {
          console.log('Data sent successfully');

          // Update connection health
          const health = that.connectionHealth.get(connectionIdentifierKey);
          if (health) {
            health.bytesSent += Buffer.byteLength(data, 'utf8');
            health.lastDataSent = new Date();
          }
        }
      });
    } else {
      // Connection not available, queue the data
      console.warn(`Connection not available for ${connectionParams.instrumentId}, queueing data`);
      that.queueData(connectionIdentifierKey, Buffer.from(data, 'utf8'));
    }
  }

  private queueData(connectionKey: string, data: Buffer) {
    const queue = this.dataQueue.get(connectionKey) || [];
    queue.push(data);

    // Limit queue size to prevent memory issues
    const MAX_QUEUE_SIZE = 100;
    if (queue.length > MAX_QUEUE_SIZE) {
      queue.shift(); // Remove oldest data
      console.warn(`Data queue for ${connectionKey} exceeded max size, removed oldest entry`);
    }

    this.dataQueue.set(connectionKey, queue);
  }

  private processQueuedData(connectionKey: string) {
    let that = this; // 'this' is already correctly captured by arrow functions if used consistently
    if (that.processingQueue.get(connectionKey)) return;
    that.processingQueue.set(connectionKey, true);

    const queue = that.dataQueue.get(connectionKey);
    const instrumentConnectionData = that.connectionStack.get(connectionKey);
    if (!queue || !instrumentConnectionData?.connectionSocket?.writable) {
      that.processingQueue.set(connectionKey, false);
      return;
    }

    const processNext = () => {
      if (queue.length === 0) {
        that.processingQueue.set(connectionKey, false);
        return;
      }

      const dataToSend = queue.shift(); // This is the Buffer to send
      // const dataBuffer = queue.shift(); // REMOVE THIS ERRONEOUS LINE

      const success = instrumentConnectionData.connectionSocket.write(dataToSend, (err) => {
        if (err) {
          // Consider unshift to retry sooner for transient errors:
          // queue.unshift(dataToSend);
          that.queueData(connectionKey, dataToSend); // Re-queues the correct data
          that.processingQueue.set(connectionKey, false);
          return;
        }
        // Data from queue sent successfully
        const health = that.connectionHealth.get(connectionKey); // or this.connectionHealth.get if 'that' is not needed
        if (health) {
          health.bytesSent += dataToSend.length; // USE dataToSend.length
          health.lastDataSent = new Date();
        }
        processNext(); // recursively process next
      });

      if (!success) {
        queue.unshift(dataToSend); // Correctly unshift the data that couldn't be written immediately
        instrumentConnectionData.connectionSocket.once('drain', () => {
          processNext();
        });
        return;
      }
    };

    processNext();
  }


  verifyConnection(connectionParams: ConnectionParams): void {
    const key = this._generateConnectionIdentifierKey(connectionParams);
    const instrumentConnectionData = this.connectionStack.get(key);

    if (!instrumentConnectionData) return;

    console.log(`Verifying connection for ${connectionParams.instrumentId}`);
    this.sendHeartbeat(connectionParams);
  }

  private _generateConnectionIdentifierKey(connectionParams: ConnectionParams): string {
    return `${connectionParams.host}:${connectionParams.port}:${connectionParams.connectionMode}:${connectionParams.connectionProtocol}`;
  }

  getStatusObservable(connectionParams: ConnectionParams): Observable<boolean> {
    const connectionIdentifierKey = this._generateConnectionIdentifierKey(connectionParams);
    const instrumentConnectionData = this.connectionStack.get(connectionIdentifierKey);
    return instrumentConnectionData?.statusSubject.asObservable();
  }

  getConnectionAttemptObservable(connectionParams: ConnectionParams): Observable<boolean> {
    const connectionIdentifierKey = this._generateConnectionIdentifierKey(connectionParams);
    const instrumentConnectionData = this.connectionStack.get(connectionIdentifierKey);
    return instrumentConnectionData?.connectionAttemptStatusSubject.asObservable();
  }

  getTransmissionStatusObservable(connectionParams: ConnectionParams): Observable<boolean> {
    const connectionIdentifierKey = this._generateConnectionIdentifierKey(connectionParams);
    const instrumentConnectionData = this.connectionStack.get(connectionIdentifierKey);
    return instrumentConnectionData?.transmissionStatusSubject.asObservable();
  }

  isActuallyConnected(connectionParams: ConnectionParams): boolean {
    const key = this._generateConnectionIdentifierKey(connectionParams);
    const instrumentConnectionData = this.connectionStack.get(key);

    if (!instrumentConnectionData) return false;

    if (connectionParams.connectionMode === 'tcpserver') {
      if (instrumentConnectionData.connectionSocket) {
        try {
          return instrumentConnectionData.connectionSocket.writable &&
            !instrumentConnectionData.connectionSocket.destroyed;
        } catch (e) {
          return false;
        }
      }
      return false;
    }

    if (connectionParams.connectionMode === 'tcpclient') {
      if (instrumentConnectionData.connectionSocket) {
        try {
          return instrumentConnectionData.connectionSocket.writable &&
            !instrumentConnectionData.connectionSocket.destroyed &&
            instrumentConnectionData.connectionSocket.connecting !== true;
        } catch (e) {
          return false;
        }
      }
      return false;
    }

    return false;
  }

  // Get connection health metrics
  getConnectionHealth(connectionParams: ConnectionParams): ConnectionHealth | null {
    const key = this._generateConnectionIdentifierKey(connectionParams);
    return this.connectionHealth.get(key) || null;
  }

  // Get all connection health metrics
  getAllConnectionHealth(): Map<string, ConnectionHealth> {
    return new Map(this.connectionHealth);
  }
}
