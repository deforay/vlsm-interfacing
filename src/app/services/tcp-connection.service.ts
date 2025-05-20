import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { ElectronService } from '../core/services';
import { ConnectionParams } from '../interfaces/connection-params.interface';
import { InstrumentConnectionStack } from '../interfaces/intrument-connections.interface';
import { UtilitiesService } from './utilities.service';

@Injectable({
  providedIn: 'root'
})

export class TcpConnectionService {

  public connectionParams: ConnectionParams = null;
  private heartbeatIntervals: Map<string, any> = new Map();
  private readonly heartbeatInterval = 30000; // 30 seconds
  private readonly heartbeatTimeout = 10000;  // 10 seconds
  protected handleTCPCallback: (connectionIdentifierKey: string, data: any) => void;
  public socketClient = null;
  public server = null;
  public net = null;

  protected clientConnectionOptions: any = null;

  public connectionStack: Map<string, InstrumentConnectionStack> = new Map();

  public connectionTimeout = 300000; // 5 minutes in milliseconds

  constructor(public electronService: ElectronService,
    public utilitiesService: UtilitiesService) {
    this.net = this.electronService.net;
  }

  // Method used to connect to the Testing Machine
  connect(connectionParams: ConnectionParams, handleTCPCallback: (connectionIdentifierKey: string, data: any) => void) {

    const that = this;
    that.handleTCPCallback = handleTCPCallback;
    let instrumentConnectionData: InstrumentConnectionStack = null;

    const connectionIdentifierKey = that._generateConnectionIdentifierKey(connectionParams);

    if (that.connectionStack.has(connectionIdentifierKey)) {
      instrumentConnectionData = that.connectionStack.get(connectionIdentifierKey);
    }
    else {

      const statusSubject = new BehaviorSubject(false);
      const transmissionStatusSubject = new BehaviorSubject(false);
      const connectionAttemptStatusSubject = new BehaviorSubject(false);

      // Subscribe to the BehaviorSubject
      // statusSubject.subscribe(value => {
      //   //console.info(connectionParams.instrumentId + ' statusSubject ===> ' + value);
      // });
      // Subscribe to the BehaviorSubject
      // connectionAttemptStatusSubject.subscribe(value => {
      //   //console.info(connectionParams.instrumentId + ' connectionAttemptStatusSubject ===> ' + value);
      // });

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
        reconnectAttempts: 0, // Initialize reconnect attempts
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
        const clientAddress = socket.remoteAddress; // Get the client's IP address
        that.utilitiesService.logger('info', (new Date()) + ' : A remote client (' + clientAddress + ') has connected to the Interfacing Server', instrumentConnectionData.instrumentId);

        // confirm socket connection from client
        sockets.push(socket);
        that.socketClient = socket;

        // Enable TCP keep-alive with a 1-minute interval
        socket.setKeepAlive(true, 60000); // 1 minute keep-alive interval

        // Set timeout for the server socket
        socket.setTimeout(that.connectionTimeout);

        socket.on('timeout', () => {
          // Increase timeout to 10 minutes if it times out
          if (that.connectionTimeout === 300000) {
            that.utilitiesService.logger('info', 'Increasing timeout to 10 minutes after timeout event', instrumentConnectionData.instrumentId);
            that.connectionTimeout = 600000; // 10 minutes
          }
          that.utilitiesService.logger('info', 'Server socket timeout', instrumentConnectionData.instrumentId);
          that._handleClientConnectionIssue(instrumentConnectionData, connectionParams, 'Client socket timeout', true);
          socket.end();
        });

        socket.on('data', function (data: any) {
          // When we receive data, we should ensure the connection is marked as active
          instrumentConnectionData.statusSubject.next(true);

          // Reset any reconnect attempts since we're clearly connected
          instrumentConnectionData.reconnectAttempts = 0;


          that.handleTCPCallback(connectionIdentifierKey, data);
          // Reset the timeout to 5 minutes after a successful data transmission
          that.connectionTimeout = 300000; // 5 minutes
        });

        instrumentConnectionData.connectionSocket = that.socketClient;
        instrumentConnectionData.statusSubject.next(true);

        // Add a 'close' event handler to this instance of socket
        socket.on('close', function () {
          if (instrumentConnectionData.errorOccurred) {
            instrumentConnectionData.errorOccurred = false;
            return;
          }
          const index = sockets.findIndex(function (o) {
            return o.host === socket.host && o.port === socket.port;
          });
          if (index !== -1) {
            sockets.splice(index, 1);
          }
          console.log('CLOSED: ' + socket.host + ' ' + socket.host);
        });

      });

      instrumentConnectionData.connectionServer.on('close', () => {
        that.utilitiesService.logger('info', 'Server closed', instrumentConnectionData.instrumentId);
      });

      instrumentConnectionData.connectionServer.on('error', function (e) {
        instrumentConnectionData.errorOccurred = true;
        if (e.code === 'EADDRINUSE') {
          that.utilitiesService.logger('error', `Error: Port ${connectionParams.port} is already in use. Disconnecting to attempt again later.`, instrumentConnectionData.instrumentId);

          // Force port release attempt - this doesn't always work but is worth trying
          const tempSocket = new that.net.Socket();
          tempSocket.on('error', function () {
            // If this errors, it's ok - we tried
            tempSocket.destroy();
          });

          // Try connecting to the port to force it to reset
          tempSocket.connect(connectionParams.port, connectionParams.host, function () {
            that.utilitiesService.logger('info', `Found process using port ${connectionParams.port}, sending reset signal`, instrumentConnectionData.instrumentId);
            tempSocket.end();
          });

          // Set a flag to indicate EADDRINUSE occurred
          //instrumentConnectionData.hadAddressInUse = true;
        } else {
          that.utilitiesService.logger('error', 'Error while connecting ' + e.code, instrumentConnectionData.instrumentId);
        }
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


      // Set connection timeout for client
      instrumentConnectionData.connectionSocket.setTimeout(that.connectionTimeout); // 30 seconds timeout

      // Enable TCP keep-alive with a 1-minute interval
      instrumentConnectionData.connectionSocket.setKeepAlive(true, 60000); // 1 minute keep-alive interval


      instrumentConnectionData.connectionSocket.on('timeout', () => {
        // Increase timeout to 10 minutes if it times out
        if (that.connectionTimeout === 300000) {
          that.utilitiesService.logger('info', 'Increasing timeout to 10 minutes after timeout event', instrumentConnectionData.instrumentId);
          that.connectionTimeout = 600000; // 10 minutes
        }
        that.utilitiesService.logger('info', 'Client socket timeout', instrumentConnectionData.instrumentId);
        that._handleClientConnectionIssue(instrumentConnectionData, connectionParams, 'Server socket timeout', true);
      });

      // Successful connection
      instrumentConnectionData.connectionSocket.on('connect', function () {
        that.connectionTimeout = 300000;
        instrumentConnectionData.statusSubject.next(true);
        instrumentConnectionData.reconnectAttempts = 0; // Reset retry attempts
        that.utilitiesService.logger('success', 'Connected as client successfully', instrumentConnectionData.instrumentId);
      });

      instrumentConnectionData.connectionSocket.on('data', function (data) {
        // Ensure connection status is updated
        instrumentConnectionData.statusSubject.next(true);

        // Reset reconnect attempts
        instrumentConnectionData.reconnectAttempts = 0;

        // Handle incoming data
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

    // After connection setup, start the heartbeat
    if (connectionParams.connectionMode === 'tcpclient') {
      // For TCP client, we can start the heartbeat immediately
      this.startHeartbeat(connectionParams);
    } else if (connectionParams.connectionMode === 'tcpserver') {
      // For TCP server, we need to wait for a client connection
      const connectionIdentifierKey = this._generateConnectionIdentifierKey(connectionParams);
      const instrumentConnectionData = this.connectionStack.get(connectionIdentifierKey);

      if (instrumentConnectionData && instrumentConnectionData.connectionServer) {
        // When a client connects, start the heartbeat
        instrumentConnectionData.connectionServer.on('connection', () => {
          this.startHeartbeat(connectionParams);
        });
      }
    }
  }

  private startHeartbeat(connectionParams: ConnectionParams) {
    const key = this._generateConnectionIdentifierKey(connectionParams);
    const instrumentConnectionData = this.connectionStack.get(key);

    if (!instrumentConnectionData) return;

    // Clear any existing heartbeat interval
    this.stopHeartbeat(connectionParams);

    //console.log(`Starting heartbeat for ${connectionParams.instrumentId}`);

    // Create a new heartbeat interval
    const interval = setInterval(() => {
      // Only send heartbeats if we think we're connected
      if (instrumentConnectionData.statusSubject.getValue()) {
        this.sendHeartbeat(connectionParams);
      } else {
        // If we think we're disconnected, stop the heartbeat
        this.stopHeartbeat(connectionParams);
      }
    }, this.heartbeatInterval);

    this.heartbeatIntervals.set(key, interval);
  }

  // Method to stop the heartbeat
  private stopHeartbeat(connectionParams: ConnectionParams) {
    const key = this._generateConnectionIdentifierKey(connectionParams);
    if (this.heartbeatIntervals.has(key)) {
      clearInterval(this.heartbeatIntervals.get(key));
      this.heartbeatIntervals.delete(key);
      //console.log(`Stopped heartbeat for ${connectionParams.instrumentId}`);
    }
  }

  // Method to send a heartbeat and check for response
  private sendHeartbeat(connectionParams: ConnectionParams) {
    const key = this._generateConnectionIdentifierKey(connectionParams);
    const instrumentConnectionData = this.connectionStack.get(key);

    if (!instrumentConnectionData || !instrumentConnectionData.connectionSocket) return;

    //console.log(`Sending heartbeat to ${connectionParams.instrumentId}`);

    // Set a flag to track if we've received a response
    let heartbeatAcknowledged = false;

    // For TCP server mode, we can't easily send a heartbeat to the client
    // So we'll use a different approach - we'll check if the socket is writable
    if (connectionParams.connectionMode === 'tcpserver') {
      if (instrumentConnectionData.connectionSocket) {
        // Check if the socket is still writable
        try {
          // For server mode, we'll just check if the socket is writable
          const isWritable = instrumentConnectionData.connectionSocket.writable;

          if (!isWritable) {
            console.warn(`Server socket for ${connectionParams.instrumentId} is no longer writable`);
            this._handleDisconnection(connectionParams, 'Socket no longer writable');
          } else {
            // Socket is still writable, all good
            heartbeatAcknowledged = true;
            //console.log(`Server socket for ${connectionParams.instrumentId} is still writable`);
          }
        } catch (error) {
          console.error(`Error checking server socket for ${connectionParams.instrumentId}:`, error);
          this._handleDisconnection(connectionParams, 'Socket error');
        }
      }
    } else {
      // For TCP client mode, we can try to write something to the socket
      try {
        // Create a one-time data handler to detect response
        const onDataHandler = (data: Buffer) => {
          heartbeatAcknowledged = true;

          // Remove the handler after getting a response
          instrumentConnectionData.connectionSocket.removeListener('data', onDataHandler);
        };

        // Listen for any data as a response (will be removed by timeout or when data received)
        instrumentConnectionData.connectionSocket.once('data', onDataHandler);

        // Send a zero-byte heartbeat or a non-intrusive character depending on the protocol
        if (connectionParams.connectionProtocol.includes('astm')) {
          // For ASTM, we can use ENQ as a heartbeat
          instrumentConnectionData.connectionSocket.write(String.fromCharCode(5));
        } else if (connectionParams.connectionProtocol.includes('hl7')) {
          // For HL7, we can use a minimal message
          instrumentConnectionData.connectionSocket.write('\x0B' + 'MSH|^~\\&|||||20250520010203||ACK^A01|1|P|2.5.1\r' + '\x1C' + '\x0D');
        } else {
          // Default - just try to write an empty buffer
          instrumentConnectionData.connectionSocket.write(Buffer.from([]));
        }

        // Set a timeout to check if we got a response
        setTimeout(() => {
          // Remove the data handler if still present
          instrumentConnectionData.connectionSocket.removeListener('data', onDataHandler);

          // If no response received, consider the connection dead
          if (!heartbeatAcknowledged) {
            console.warn(`No heartbeat response from ${connectionParams.instrumentId}`);
            this._handleDisconnection(connectionParams, 'Heartbeat timeout');
          }
        }, this.heartbeatTimeout);
      } catch (error) {
        console.error(`Error sending heartbeat to ${connectionParams.instrumentId}:`, error);
        this._handleDisconnection(connectionParams, 'Heartbeat error');
      }
    }
  }

  // Helper method to handle disconnection
  private _handleDisconnection(connectionParams: ConnectionParams, reason: string) {
    console.warn(`Disconnecting ${connectionParams.instrumentId} due to: ${reason}`);

    // Update the connection status
    const key = this._generateConnectionIdentifierKey(connectionParams);
    const instrumentConnectionData = this.connectionStack.get(key);

    if (instrumentConnectionData) {
      // Update status before disconnecting
      instrumentConnectionData.statusSubject.next(false);
      instrumentConnectionData.errorOccurred = true;

      // Log the disconnection
      this.utilitiesService.logger('warning', `Connection lost: ${reason}`, connectionParams.instrumentId);

      // Disconnect
      this.disconnect(connectionParams);

      // If auto-reconnect is enabled, trigger reconnection
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

  disconnect(connectionParams: ConnectionParams) {
    // Stop the heartbeat first
    this.stopHeartbeat(connectionParams);
    const that = this;
    const connectionIdentifierKey = that._generateConnectionIdentifierKey(connectionParams);

    const instrumentConnectionData = that.connectionStack.get(connectionIdentifierKey);
    if (instrumentConnectionData) {
      try {
        console.log(`Disconnecting ${connectionParams.instrumentId} (${connectionParams.host}:${connectionParams.port})`);

        // Update status subjects first
        instrumentConnectionData.statusSubject.next(false);
        instrumentConnectionData.connectionAttemptStatusSubject.next(false);
        instrumentConnectionData.transmissionStatusSubject.next(false);

        // Handle server disconnection first (most important for EADDRINUSE)
        if (instrumentConnectionData.connectionServer) {
          try {
            // Remove all listeners before closing server
            instrumentConnectionData.connectionServer.removeAllListeners();

            // Close the server with a callback
            instrumentConnectionData.connectionServer.close(() => {
              console.log(`Server for ${connectionParams.instrumentId} closed`);
              instrumentConnectionData.connectionServer = null;
            });

            // Force close any connections to this server
            instrumentConnectionData.connectionServer.unref();

            // Add a timeout to force handle unclosed server
            setTimeout(() => {
              if (instrumentConnectionData.connectionServer) {
                console.warn(`Server for ${connectionParams.instrumentId} didn't close properly, forcing termination`);
                // Force reference removal
                instrumentConnectionData.connectionServer = null;
              }
            }, 1000);
          } catch (serverError) {
            console.error(`Error closing server for ${connectionParams.instrumentId}:`, serverError);
            instrumentConnectionData.connectionServer = null;
          }
        }

        // Handle socket disconnection
        if (instrumentConnectionData.connectionSocket) {
          try {
            // Remove all listeners before destroying socket
            instrumentConnectionData.connectionSocket.removeAllListeners();

            // Set socket to unref to allow the process to exit
            instrumentConnectionData.connectionSocket.unref();

            // End the socket connection with a callback
            instrumentConnectionData.connectionSocket.end(() => {
              console.log(`Socket for ${connectionParams.instrumentId} ended`);

              // Destroy the socket after end completes
              if (instrumentConnectionData.connectionSocket) {
                instrumentConnectionData.connectionSocket.destroy();
                instrumentConnectionData.connectionSocket = null;
                console.log(`Socket for ${connectionParams.instrumentId} destroyed`);
              }
            });

            // Add a timeout to force destroy if end doesn't complete
            setTimeout(() => {
              if (instrumentConnectionData.connectionSocket) {
                instrumentConnectionData.connectionSocket.destroy();
                instrumentConnectionData.connectionSocket = null;
                console.log(`Socket for ${connectionParams.instrumentId} force destroyed after timeout`);
              }
            }, 1000);
          } catch (socketError) {
            console.error(`Error closing socket for ${connectionParams.instrumentId}:`, socketError);
            // Force destroy as a last resort
            if (instrumentConnectionData.connectionSocket) {
              instrumentConnectionData.connectionSocket.destroy();
              instrumentConnectionData.connectionSocket = null;
            }
          }
        }

        // IMPORTANT: Remove from connection stack to ensure a clean reconnect
        that.connectionStack.delete(connectionIdentifierKey);

        // Log success
        that.utilitiesService.logger('info', 'Disconnection complete', connectionParams.instrumentId);

      } catch (error) {
        that.utilitiesService.logger('error', `Error during disconnection: ${error}`, connectionParams.instrumentId);
        // Clean up resources even if there was an error
        instrumentConnectionData.connectionSocket = null;
        instrumentConnectionData.connectionServer = null;
        // IMPORTANT: Remove from connection stack in all cases
        that.connectionStack.delete(connectionIdentifierKey);
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
        }
      });
    }
  }

  verifyConnection(connectionParams: ConnectionParams): void {
    const key = this._generateConnectionIdentifierKey(connectionParams);
    const instrumentConnectionData = this.connectionStack.get(key);

    if (!instrumentConnectionData) return;

    console.log(`Verifying connection for ${connectionParams.instrumentId}`);

    // Trigger immediate heartbeat check
    this.sendHeartbeat(connectionParams);
  }

  private _generateConnectionIdentifierKey(connectionParams: ConnectionParams): string {
    return `${connectionParams.host}:${connectionParams.port}:${connectionParams.connectionMode}:${connectionParams.connectionProtocol}`;
  }

  getStatusObservable(connectionParams: ConnectionParams): Observable<boolean> {
    const connectionIdentifierKey = this._generateConnectionIdentifierKey(connectionParams);
    const instrumentConnectionData = this.connectionStack.get(connectionIdentifierKey);
    return instrumentConnectionData.statusSubject.asObservable();
  }

  getConnectionAttemptObservable(connectionParams: ConnectionParams): Observable<boolean> {
    const connectionIdentifierKey = this._generateConnectionIdentifierKey(connectionParams);
    const instrumentConnectionData = this.connectionStack.get(connectionIdentifierKey);
    return instrumentConnectionData.connectionAttemptStatusSubject.asObservable();
  }

  getTransmissionStatusObservable(connectionParams: ConnectionParams): Observable<boolean> {
    const connectionIdentifierKey = this._generateConnectionIdentifierKey(connectionParams);
    const instrumentConnectionData = this.connectionStack.get(connectionIdentifierKey);
    return instrumentConnectionData.transmissionStatusSubject.asObservable();
  }


  // Method to check if a connection is actually active at the socket level
  isActuallyConnected(connectionParams: ConnectionParams): boolean {
    const key = this._generateConnectionIdentifierKey(connectionParams);
    const instrumentConnectionData = this.connectionStack.get(key);

    if (!instrumentConnectionData) return false;

    // For server mode, check if we have a socket and it's writable
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

    // For client mode, check if the socket exists and is connected
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
}
