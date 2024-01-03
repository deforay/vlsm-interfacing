import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { ElectronService } from '../core/services';
import { ConnectionParams } from '../interfaces/connection-params.interface';
import { InstrumentConnections } from '../interfaces/intrument-connections.interface';


@Injectable({
  providedIn: 'root'
})


export class TcpConnectionService {

  public connectionParams: ConnectionParams = null;
  public socketClient = null;
  public server = null;
  public net = null;

  protected clientConnectionOptions: any = null;

  private connections: Map<string, InstrumentConnections> = new Map();


  constructor(private electronService: ElectronService) {
    this.net = this.electronService.net;
  }

  // Method used to connect to the Testing Machine
  connect(connectionParams: ConnectionParams,
    handleTCPResponse: (connectionKey: string, data: any) => void) {

    const that = this;
    let instrumentConnectionData: InstrumentConnections = null;

    const connectionKey = that._getKey(connectionParams.host, connectionParams.port);

    if (this.connections.has(connectionKey)) {
      instrumentConnectionData = this.connections.get(connectionKey);
    }
    else {
      const statusSubject = new BehaviorSubject(false);
      // Subscribe to the BehaviorSubject
      statusSubject.subscribe(value => {
        console.info(connectionParams.instrumentId + ' statusSubject ===> ' + value);
      });
      const connectionAttemptStatusSubject = new BehaviorSubject(false);
      // Subscribe to the BehaviorSubject
      connectionAttemptStatusSubject.subscribe(value => {
        console.info(connectionParams.instrumentId + ' connectionAttemptStatusSubject ===> ' + value);
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
        connectionServer: null
      };

      this.connections.set(connectionKey, instrumentConnectionData);

    }

    instrumentConnectionData.connectionAttemptStatusSubject.next(true);

    if (connectionParams.connectionMode === 'tcpserver') {
      that.logger('info', 'Listening for connection on port ' + connectionParams.port, instrumentConnectionData.instrumentId);
      instrumentConnectionData.connectionServer = that.net.createServer();
      instrumentConnectionData.connectionServer.listen(connectionParams.port);

      const sockets = [];
      instrumentConnectionData.connectionServer.on('connection', function (socket) {
        // confirm socket connection from client
        that.logger('info', (new Date()) + ' : A remote client has connected to the Interfacing Server', instrumentConnectionData.instrumentId);

        sockets.push(socket);
        that.socketClient = socket;
        socket.on('data', function (data) {
          handleTCPResponse(connectionKey, data);
        });

        instrumentConnectionData.connectionSocket = that.socketClient;
        instrumentConnectionData.statusSubject.next(true);

        // Add a 'close' event handler to this instance of socket
        socket.on('close', function (data) {
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
        that.logger('error', 'Error while connecting ' + e.code, instrumentConnectionData.instrumentId);
        that.disconnect(connectionParams.host, connectionParams.port);

        if (connectionParams.interfaceAutoConnect === 'yes') {
          instrumentConnectionData.connectionAttemptStatusSubject.next(true);
          that.logger('error', "Interface AutoConnect is enabled: Will re-attempt connection in 30 seconds", instrumentConnectionData.instrumentId);
          setTimeout(() => {
            that.connect(connectionParams, handleTCPResponse);
          }, 30000);
        }

      });

    } else if (connectionParams.connectionMode === 'tcpclient') {

      instrumentConnectionData.connectionSocket = that.socketClient = new that.net.Socket();
      that.clientConnectionOptions = {
        port: connectionParams.port,
        host: connectionParams.host
      };

      // since this is a CLIENT connection, we don't need a server object, so we set it to null
      instrumentConnectionData.connectionServer = null;

      that.logger('info', 'Trying to connect as client', instrumentConnectionData.instrumentId);

      instrumentConnectionData.connectionSocket.connect(that.clientConnectionOptions, function () {
        instrumentConnectionData.statusSubject.next(true);
        that.logger('success', 'Connected as client successfully', instrumentConnectionData.instrumentId);
      });

      instrumentConnectionData.connectionSocket.on('data', function (data) {
        instrumentConnectionData.statusSubject.next(true);
        handleTCPResponse(connectionKey, data);
      });

      instrumentConnectionData.connectionSocket.on('close', function () {
        that.disconnect(connectionParams.host, connectionParams.port);
        if (connectionParams.interfaceAutoConnect === 'yes') {
          instrumentConnectionData.connectionAttemptStatusSubject.next(true);
          that.logger('error', "Interface AutoConnect is enabled: Will re-attempt connection in 30 seconds", instrumentConnectionData.instrumentId);
          setTimeout(() => {
            that.connect(connectionParams, handleTCPResponse);
          }, 30000);
        }

      });

      instrumentConnectionData.connectionSocket.on('error', (e) => {
        that.logger('error', e);
        that.disconnect(connectionParams.host, connectionParams.port);

        if (connectionParams.interfaceAutoConnect === 'yes') {
          instrumentConnectionData.connectionAttemptStatusSubject.next(true);
          that.logger('error', "Interface AutoConnect is enabled: Will re-attempt connection in 30 seconds", instrumentConnectionData.instrumentId);
          setTimeout(() => {
            that.connect(connectionParams, handleTCPResponse);
          }, 30000);
        }

      });
    } else {

    }

  }

  reconnect(connectionParams: ConnectionParams,
    handleTCPResponse: (connectionKey: string, data: any) => void) {
    let that = this;
    that.disconnect(connectionParams.host, connectionParams.port);
    that.connect(connectionParams, handleTCPResponse);
  }

  disconnect(host: string, port: number) {
    const that = this;
    const connectionKey = that._getKey(host, port);

    const connectionData = that.connections.get(connectionKey);
    if (connectionData) {

      connectionData.statusSubject.next(false);
      connectionData.connectionAttemptStatusSubject.next(false);

      if (connectionData.connectionMode === 'tcpclient' && connectionData.connectionSocket) {
        connectionData.connectionSocket.destroy();
        that.logger('info', 'Client Disconnected');

      } else if (connectionData.connectionMode === 'tcpserver' && connectionData.connectionServer) {
        connectionData.connectionServer.close();
        that.logger('info', 'Server Stopped');
      }
    }

  }


  logger(logType, message, instrumentId = null) {


  }

  _getKey(host: string, port: number): string {
    return `${host}:${port}`;
  }

  getStatusObservable(host: string, port: number): Observable<boolean> {
    const connectionKey = this._getKey(host, port);
    const connectionData = this.connections.get(connectionKey);
    return connectionData.statusSubject.asObservable();
  }

  getConnectionAttemptObservable(host: string, port: number): Observable<boolean> {
    const connectionKey = this._getKey(host, port);
    const connectionData = this.connections.get(connectionKey);
    return connectionData.connectionAttemptStatusSubject.asObservable();
  }

}
