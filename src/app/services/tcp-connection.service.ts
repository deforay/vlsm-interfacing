import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { ElectronService } from '../core/services';
import { ConnectionParams } from '../interfaces/connection-params.interface';


interface ConnectionData {
  connectionMode?: 'tcpserver' | 'tcpclient';
  connectionProtocol?: string;
  instrumentId?: string;
  labName?: string;
  machineType?: string;
  statusSubject: BehaviorSubject<boolean>;
  connectionAttemptStatusSubject: BehaviorSubject<boolean>;
  connectionSocket?: any;
  connectionServer?: any;
}


@Injectable({
  providedIn: 'root'
})


export class TcpConnectionService {

  public connectionParams: ConnectionParams = null;
  public socketClient = null;
  public server = null;
  public net = null;

  protected connectopts: any = null;

  private connections: Map<string, ConnectionData> = new Map();


  constructor(private electronService: ElectronService) {
    this.net = this.electronService.net;
  }

  // Method used to connect to the Testing Machine
  connect(
    connectionParams: ConnectionParams,
    handleTCPResponse: (connectionKey: string, data: any) => void
  ) {

    const that = this;
    that.connectionParams = connectionParams;
    let connectionData: ConnectionData = null;

    const connectionKey = that._getKey(that.connectionParams.host, that.connectionParams.port);

    if (this.connections.has(connectionKey)) {
      connectionData = this.connections.get(connectionKey);
    }
    else {
      const statusSubject = new BehaviorSubject(false);
      // Subscribe to the BehaviorSubject
      statusSubject.subscribe(value => {
        console.log('statusSubject::::::::' + value);
      });
      const connectionAttemptStatusSubject = new BehaviorSubject(false);
      // Subscribe to the BehaviorSubject
      connectionAttemptStatusSubject.subscribe(value => {
        console.log('connectionAttemptStatusSubject::::::::' + value);
      });

      connectionData = {
        connectionMode: that.connectionParams.connectionMode,
        connectionProtocol: that.connectionParams.connectionProtocol,
        instrumentId: that.connectionParams.instrumentId,
        labName: that.connectionParams.labName,
        machineType: that.connectionParams.machineType,
        statusSubject: statusSubject,
        connectionAttemptStatusSubject: connectionAttemptStatusSubject,
        connectionSocket: null,
        connectionServer: null
      };

      this.connections.set(connectionKey, connectionData);

    }

    connectionData.connectionAttemptStatusSubject.next(true);

    if (that.connectionParams.connectionMode === 'tcpserver') {
      that.logger('info', 'Listening for connection on port ' + that.connectionParams.port);
      connectionData.connectionServer = that.net.createServer();
      connectionData.connectionServer.listen(that.connectionParams.port);

      const sockets = [];
      connectionData.connectionServer.on('connection', function (socket) {
        // confirm socket connection from client
        that.logger('info', (new Date()) + ' : A remote client has connected to the Interfacing Server');

        sockets.push(socket);
        that.socketClient = socket;
        socket.on('data', function (data) {
          handleTCPResponse(connectionKey, data);
        });

        connectionData.connectionSocket = that.socketClient;
        connectionData.statusSubject.next(true);

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


      connectionData.connectionServer.on('error', function (e) {
        that.logger('error', 'Error while connecting ' + e.code);
        that.disconnect(that.connectionParams.host, that.connectionParams.port);

        if (that.connectionParams.interfaceAutoConnect === 'yes') {
          connectionData.connectionAttemptStatusSubject.next(true);
          that.logger('error', "Interface AutoConnect is enabled: Will re-attempt connection in 30 seconds");
          setTimeout(() => {
            that.reconnect(that.connectionParams, handleTCPResponse);
          }, 30000);
        }

      });

    } else if (that.connectionParams.connectionMode === 'tcpclient') {

      connectionData.connectionSocket = that.socketClient = new that.net.Socket();
      that.connectopts = {
        port: that.connectionParams.port,
        host: that.connectionParams.host
      };

      // since this is a CLIENT connection, we don't need a server object, so we set it to null
      connectionData.connectionServer = null;

      that.logger('info', 'Trying to connect as client');

      connectionData.connectionSocket.connect(that.connectopts, function () {
        connectionData.statusSubject.next(true);
        that.logger('success', 'Connected as client successfully');
      });

      connectionData.connectionSocket.on('data', function (data) {
        connectionData.statusSubject.next(true);
        handleTCPResponse(connectionKey, data);
      });

      connectionData.connectionSocket.on('close', function () {
        that.disconnect(that.connectionParams.host, that.connectionParams.port);
        if (that.connectionParams.interfaceAutoConnect === 'yes') {
          connectionData.connectionAttemptStatusSubject.next(true);
          that.logger('error', "Interface AutoConnect is enabled: Will re-attempt connection in 30 seconds");
          setTimeout(() => {
            that.reconnect(that.connectionParams, handleTCPResponse);
          }, 30000);
        }

      });

      connectionData.connectionSocket.on('error', (e) => {
        that.logger('error', e);
        that.disconnect(that.connectionParams.host, that.connectionParams.port);

        if (that.connectionParams.interfaceAutoConnect === 'yes') {
          connectionData.connectionAttemptStatusSubject.next(true);
          that.logger('error', "Interface AutoConnect is enabled: Will re-attempt connection in 30 seconds");
          setTimeout(() => {
            that.reconnect(that.connectionParams, handleTCPResponse);
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


  logger(logType, message) {


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
