import { Injectable } from '@angular/core';
import { DatabaseService } from './database.service';
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
    public dbService: DatabaseService,
    public utilitiesService: UtilitiesService) {
    this.net = this.electronService.net;
  }

  // Method used to connect to the Testing Machine
  connect(connectionParams: ConnectionParams, handleTCPCallback: (connectionIdentifierKey: string, data: any) => void) {

    const that = this;
    that.handleTCPCallback = handleTCPCallback;
    let instrumentConnectionData: InstrumentConnectionStack = null;

    const connectionIdentifierKey = that._generateConnectionIdentifierKey(connectionParams.host, connectionParams.port);

    if (that.connectionStack.has(connectionIdentifierKey)) {
      instrumentConnectionData = that.connectionStack.get(connectionIdentifierKey);
    }
    else {


      const statusSubject = new BehaviorSubject(false);
      // Subscribe to the BehaviorSubject
      statusSubject.subscribe(value => {
        //console.info(connectionParams.instrumentId + ' statusSubject ===> ' + value);
      });
      const connectionAttemptStatusSubject = new BehaviorSubject(false);
      // Subscribe to the BehaviorSubject
      connectionAttemptStatusSubject.subscribe(value => {
        //console.info(connectionParams.instrumentId + ' connectionAttemptStatusSubject ===> ' + value);
      });

      instrumentConnectionData = {
        connectionMode: connectionParams.connectionMode,
        connectionProtocol: connectionParams.connectionProtocol,
        instrumentId: connectionParams.instrumentId,
        labName: connectionParams.labName,
        machineType: connectionParams.machineType,
        statusSubject: statusSubject,
        connectionAttemptStatusSubject: connectionAttemptStatusSubject,
        connectionSocket: null,
        connectionServer: null,
        errorOccurred: false
      };

      that.connectionStack.set(connectionIdentifierKey, instrumentConnectionData);

    }

    instrumentConnectionData.connectionAttemptStatusSubject.next(true);

    if (connectionParams.connectionMode === 'tcpserver') {
      that.utilitiesService.logger('info', 'Listening for connection on port ' + connectionParams.port, instrumentConnectionData.instrumentId);
      instrumentConnectionData.connectionServer = that.net.createServer();
      instrumentConnectionData.connectionServer.listen(connectionParams.port);

      const sockets = [];
      instrumentConnectionData.connectionServer.on('connection', function (socket) {
        // confirm socket connection from client
        that.utilitiesService.logger('info', (new Date()) + ' : A remote client has connected to the Interfacing Server', instrumentConnectionData.instrumentId);

        sockets.push(socket);
        that.socketClient = socket;
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
          })
          if (index !== -1) {
            sockets.splice(index, 1);
          }
          console.log('CLOSED: ' + socket.host + ' ' + socket.host);
        });

      });

      instrumentConnectionData.connectionServer.on('error', function (e) {
        instrumentConnectionData.errorOccurred = true;
        that._handleClientConnectionIssue(instrumentConnectionData, connectionParams, 'Error while connecting ' + e.code, true);
      });

    } else if (connectionParams.connectionMode === 'tcpclient') {

      instrumentConnectionData.connectionSocket = that.socketClient = new that.net.Socket();
      that.clientConnectionOptions = {
        port: connectionParams.port,
        host: connectionParams.host
      };

      // since this is a CLIENT connection, we don't need a server object, so we set it to null
      instrumentConnectionData.connectionServer = null;

      that.utilitiesService.logger('info', 'Trying to connect as client', instrumentConnectionData.instrumentId);

      // Attempt to connect
      instrumentConnectionData.connectionSocket.connect(that.clientConnectionOptions);

      // Successful connection
      instrumentConnectionData.connectionSocket.on('connect', function () {
        instrumentConnectionData.statusSubject.next(true);
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

    }

  }

  private _handleClientConnectionIssue(instrumentConnectionData, connectionParams, message, isError) {
    instrumentConnectionData.statusSubject.next(false);
    this.disconnect(connectionParams.host, connectionParams.port);
    if (isError) {
      this.utilitiesService.logger('error', message, instrumentConnectionData.instrumentId);
    }
    if (connectionParams.interfaceAutoConnect === 'yes') {
      instrumentConnectionData.connectionAttemptStatusSubject.next(true);
      this.utilitiesService.logger('info', "Interface AutoConnect is enabled: Will re-attempt connection in 30 seconds", instrumentConnectionData.instrumentId);
      setTimeout(() => {
        this.connect(connectionParams, this.handleTCPCallback);
      }, 30000);
    }
  }

  reconnect(connectionParams: ConnectionParams, handleTCPCallback: (connectionIdentifierKey: string, data: any) => void) {
    let that = this;
    that.disconnect(connectionParams.host, connectionParams.port);
    that.connect(connectionParams, handleTCPCallback);
  }

  disconnect(host: string, port: number) {
    const that = this;
    const connectionIdentifierKey = that._generateConnectionIdentifierKey(host, port);

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
          instrumentConnectionData.connectionServer.close(() => {
            that.utilitiesService.logger('info', 'Server Stopped', instrumentConnectionData.instrumentId);
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

  private _generateConnectionIdentifierKey(host: string, port: number): string {
    return `${host}:${port}`;
  }

  getStatusObservable(host: string, port: number): Observable<boolean> {
    const connectionIdentifierKey = this._generateConnectionIdentifierKey(host, port);
    const instrumentConnectionData = this.connectionStack.get(connectionIdentifierKey);
    return instrumentConnectionData.statusSubject.asObservable();
  }

  getConnectionAttemptObservable(host: string, port: number): Observable<boolean> {
    const connectionIdentifierKey = this._generateConnectionIdentifierKey(host, port);
    const instrumentConnectionData = this.connectionStack.get(connectionIdentifierKey);
    return instrumentConnectionData.connectionAttemptStatusSubject.asObservable();
  }

}
