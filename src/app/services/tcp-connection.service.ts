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
  lastDataSent: Date;
}

@Injectable({
  providedIn: 'root'
})
export class TcpConnectionService implements OnDestroy {

  public connectionParams: ConnectionParams = null;
  protected handleTCPCallback: (connectionIdentifierKey: string, data: any) => void;
  public socketClient = null; // Restored from old code
  public server = null;
  public net = null;

  protected clientConnectionOptions: any = null;

  public connectionStack: Map<string, InstrumentConnectionStack> = new Map();
  private connectionHealth: Map<string, ConnectionHealth> = new Map();

  public connectionTimeout = 300000; // 5 minutes in milliseconds

  constructor(
    public electronService: ElectronService,
    public utilitiesService: UtilitiesService
  ) {
    this.net = this.electronService.net;
  }

  ngOnDestroy() {
    // Disconnect all active connections
    this.connectionStack.forEach((connection, key) => {
      const connectionParams = this.parseConnectionKey(key);
      if (connectionParams) {
        this.disconnect(connectionParams);
      }
    });

    // Clear all maps
    this.connectionHealth.clear();
  }

  // Helper method to parse connection key back to connection params
  private parseConnectionKey(key: string): ConnectionParams | null {
    const parts = key.split(':');
    if (parts.length < 4) return null;

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
        lastDataSent: new Date(0)
      });
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

        // confirm socket connection from client
        sockets.push(socket);
        that.socketClient = socket; // Restored from old code

        // Enable TCP keep-alive with a 1-minute interval (kept as it's essential)
        socket.setKeepAlive(true, 60000);

        // No timeout for medical devices - they can have hours-long silent periods
        // TCP keep-alive will handle real disconnections
        socket.setTimeout(0); // Infinite timeout

        socket.on('timeout', () => {
          // This should never fire now with setTimeout(0), but keep for safety
          that.utilitiesService.logger('warn', 'Unexpected socket timeout event', instrumentConnectionData.instrumentId);
        });

        socket.on('data', function (data: any) {
          // Only update status to true if it's currently false (connection recovery)
          if (!instrumentConnectionData.statusSubject.value) {
            instrumentConnectionData.statusSubject.next(true);
          }

          // Update connection health
          const health = that.connectionHealth.get(connectionIdentifierKey);
          if (health) {
            health.lastDataReceived = new Date();
            health.bytesReceived += data.length;
          }

          that.handleTCPCallback(connectionIdentifierKey, data);
          // No need to reset timeout since we're using infinite timeout
        });

        instrumentConnectionData.connectionSocket = that.socketClient;
        instrumentConnectionData.statusSubject.next(true);

        // Add a 'close' event handler to this instance of socket
        socket.on('close', function (hadError) {
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
          const msg = hadError
            ? `Client ${socket.remoteAddress}:${socket.remotePort} disconnected with error`
            : `Client ${socket.remoteAddress}:${socket.remotePort} disconnected normally`;

          const logType = hadError ? 'error' : 'info';
          that.utilitiesService.logger(logType, msg, instrumentConnectionData.instrumentId);
        });

      });

      instrumentConnectionData.connectionServer.on('close', () => {
        that.utilitiesService.logger('info', 'Server closed', instrumentConnectionData.instrumentId);
      });

      instrumentConnectionData.connectionServer.on('error', function (e) {
        instrumentConnectionData.errorOccurred = true;
        that._handleClientConnectionIssue(instrumentConnectionData, connectionParams, 'Error while connecting ' + e.code, true);
      });

    } else if (connectionParams.connectionMode === 'tcpclient') {
      instrumentConnectionData.connectionSocket = that.socketClient = new that.net.Socket();
      that.clientConnectionOptions = {
        port: connectionParams.port,
        host: connectionParams.host,
        reuseAddress: true
      };

      // since this is a CLIENT connection, we don't need a server object, so we set it to null
      instrumentConnectionData.connectionServer = null;

      that.utilitiesService.logger('info', 'Trying to connect as client', instrumentConnectionData.instrumentId);

      // Attempt to connect
      instrumentConnectionData.connectionSocket.connect(that.clientConnectionOptions);

      // Set connection timeout for client - disabled for medical devices
      instrumentConnectionData.connectionSocket.setTimeout(0); // Infinite timeout

      // Enable TCP keep-alive with a 1-minute interval (kept as it's essential)
      instrumentConnectionData.connectionSocket.setKeepAlive(true, 60000);

      instrumentConnectionData.connectionSocket.on('timeout', () => {
        // This should never fire now with setTimeout(0), but keep for safety
        that.utilitiesService.logger('warn', 'Unexpected client socket timeout event', instrumentConnectionData.instrumentId);
      });

      // Successful connection
      instrumentConnectionData.connectionSocket.on('connect', function () {
        instrumentConnectionData.statusSubject.next(true);
        instrumentConnectionData.reconnectAttempts = 0; // Reset retry attempts
        that.utilitiesService.logger('success', 'Connected as client successfully', instrumentConnectionData.instrumentId);
      });

      instrumentConnectionData.connectionSocket.on('data', function (data) {
        // Only update status to true if it's currently false (connection recovery)
        if (!instrumentConnectionData.statusSubject.value) {
          instrumentConnectionData.statusSubject.next(true);
        }

        // Update connection health
        const health = that.connectionHealth.get(connectionIdentifierKey);
        if (health) {
          health.lastDataReceived = new Date();
          health.bytesReceived += data.length;
        }

        that.handleTCPCallback(connectionIdentifierKey, data);
      });

      // Connection closed
      instrumentConnectionData.connectionSocket.on('error', (err) => {
        instrumentConnectionData.errorOccurred = true;
        that._handleClientConnectionIssue(instrumentConnectionData, connectionParams, `Connection error: ${err.message}`, true);
      });

      instrumentConnectionData.connectionSocket.on('close', (hadError) => {
        if (instrumentConnectionData.errorOccurred) {
          // Since the error has already been handled, reset the flag and exit
          instrumentConnectionData.errorOccurred = false;
          return;
        }
        const message = hadError ? 'Connection closed due to a transmission error' : 'Connection closed';
        that._handleClientConnectionIssue(instrumentConnectionData, connectionParams, message, hadError);
      });
    } else {
      // handle other connection modes if any
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
      instrumentConnectionData.connectionAttemptStatusSubject.next(true);
      const attempt = instrumentConnectionData.reconnectAttempts || 0;
      const delay = that.getRetryDelay(attempt);
      that.utilitiesService.logger('info', `Interface AutoConnect is enabled: Will re-attempt connection in ${delay / 1000} seconds`, instrumentConnectionData.instrumentId);
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
    that.disconnect(connectionParams);
    that.connect(connectionParams, handleTCPCallback);
  }

  // Simplified disconnect method - back to original approach
  disconnect(connectionParams: ConnectionParams) {
    const that = this;
    const connectionIdentifierKey = that._generateConnectionIdentifierKey(connectionParams);

    const instrumentConnectionData = that.connectionStack.get(connectionIdentifierKey);
    if (instrumentConnectionData) {
      try {
        instrumentConnectionData.statusSubject.next(false);
        instrumentConnectionData.connectionAttemptStatusSubject.next(false);

        if (instrumentConnectionData.connectionSocket) {
          // Remove all event listeners
          instrumentConnectionData.connectionSocket.removeAllListeners();

          // Register the 'close' event listener before ending the socket
          instrumentConnectionData.connectionSocket.on('close', () => {
            // Check if the socket is not null before destroying
            if (instrumentConnectionData.connectionSocket) {
              instrumentConnectionData.connectionSocket.destroy();
            }
          });

          // Register an 'error' event listener
          instrumentConnectionData.connectionSocket.on('error', (error) => {
            that.utilitiesService.logger('error', `Socket error: ${error}`, instrumentConnectionData.instrumentId);
          });

          // End the socket connection
          instrumentConnectionData.connectionSocket.end();
        }

        if (instrumentConnectionData.connectionServer) {
          // Remove all listeners for the server to avoid any leaks or potential issues
          instrumentConnectionData.connectionServer.removeAllListeners();

          instrumentConnectionData.connectionServer.close(() => {
            that.utilitiesService.logger('info', 'Server Stopped', instrumentConnectionData.instrumentId);
          });

          // Handle errors during close
          instrumentConnectionData.connectionServer.on('error', (error) => {
            that.utilitiesService.logger('error', `Error while closing server: ${error.message}`, instrumentConnectionData.instrumentId);
          });
        }
      } catch (error) {
        that.utilitiesService.logger('error', `Error during disconnection: ${error}`, instrumentConnectionData.instrumentId);
      } finally {
        // Clean up resources
        instrumentConnectionData.connectionSocket = null;
        instrumentConnectionData.connectionServer = null;
      }
    }
  }

  sendData(connectionParams: ConnectionParams, data: string) {
    const that = this;
    const connectionIdentifierKey = that._generateConnectionIdentifierKey(connectionParams);

    const instrumentConnectionData = that.connectionStack.get(connectionIdentifierKey);

    if (instrumentConnectionData) {
      instrumentConnectionData.transmissionStatusSubject.next(true); // Set flag when transmission starts

      instrumentConnectionData.connectionSocket.write(data, 'utf8', (err) => {
        instrumentConnectionData.transmissionStatusSubject.next(false); // Reset flag when transmission ends

        if (err) {
          console.error('Failed to send data:', err);
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
    }
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

  // Keep the useful health tracking methods
  getConnectionHealth(connectionParams: ConnectionParams): ConnectionHealth | null {
    const key = this._generateConnectionIdentifierKey(connectionParams);
    return this.connectionHealth.get(key) || null;
  }

  getAllConnectionHealth(): Map<string, ConnectionHealth> {
    return new Map(this.connectionHealth);
  }

  // Conservative connection checking - only checks obvious failures
  isActuallyConnected(connectionParams: ConnectionParams): boolean {
    const key = this._generateConnectionIdentifierKey(connectionParams);
    const instrumentConnectionData = this.connectionStack.get(key);

    if (!instrumentConnectionData || !instrumentConnectionData.connectionSocket) {
      return false;
    }

    try {
      // Only check for obvious failures - don't check writable status as it can be temporarily false
      return !instrumentConnectionData.connectionSocket.destroyed &&
        instrumentConnectionData.connectionSocket.readyState !== 'closed';
    } catch (e) {
      return false;
    }
  }

  // Safe verification for UI components - doesn't trigger automatic reconnections
  verifyConnection(connectionParams: ConnectionParams): boolean {
    const key = this._generateConnectionIdentifierKey(connectionParams);
    const instrumentConnectionData = this.connectionStack.get(key);

    if (!instrumentConnectionData) {
      return false;
    }

    const isConnected = this.isActuallyConnected(connectionParams);

    // Only update status if there's an OBVIOUS problem (socket destroyed or closed)
    // This is safe for UI components to call without disrupting connections
    if (!isConnected && instrumentConnectionData.connectionSocket?.destroyed) {
      instrumentConnectionData.statusSubject.next(false);
    }

    // Don't auto-trigger reconnections from verification - let the UI or natural error handling do it
    return isConnected;
  }
}
