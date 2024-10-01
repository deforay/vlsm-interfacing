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
  protected handleTCPCallback: (connectionIdentifierKey: string, data: any) => void;
  public socketClient = null;
  public server = null;
  public net = null;

  protected clientConnectionOptions: any = null;

  public connectionStack: Map<string, InstrumentConnectionStack> = new Map();

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

        // Set timeout for the server socket
        socket.setTimeout(60000); // 1 minute timeout
        socket.on('timeout', () => {
          that.utilitiesService.logger('info', 'Server socket timeout', instrumentConnectionData.instrumentId);
          that._handleClientConnectionIssue(instrumentConnectionData, connectionParams, 'Client socket timeout', true);
          socket.end();
        });

        socket.on('data', function (data) {
          that.handleTCPCallback(connectionIdentifierKey, data);
        });

        instrumentConnectionData.connectionSocket = that.socketClient;
        instrumentConnectionData.statusSubject.next(true);

        // Add a 'close' event handler to this instance of socket
        socket.on('close', function (data) {
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

      // Set connection timeout for client
      instrumentConnectionData.connectionSocket.setTimeout(30000); // 30 seconds timeout
      instrumentConnectionData.connectionSocket.on('timeout', () => {
        that.utilitiesService.logger('info', 'Client socket timeout', instrumentConnectionData.instrumentId);
        that._handleClientConnectionIssue(instrumentConnectionData, connectionParams, 'Server socket timeout', true);
      });

      // Successful connection
      instrumentConnectionData.connectionSocket.on('connect', function () {
        instrumentConnectionData.statusSubject.next(true);
        instrumentConnectionData.reconnectAttempts = 0; // Reset retry attempts
        that.utilitiesService.logger('success', 'Connected as client successfully', instrumentConnectionData.instrumentId);
      });

      instrumentConnectionData.connectionSocket.on('data', function (data) {
        instrumentConnectionData.statusSubject.next(true);
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

          //that.utilitiesService.logger('info', 'Client Disconnected', instrumentConnectionData.instrumentId);
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
}
