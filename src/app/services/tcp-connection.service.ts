import { Injectable } from '@angular/core';
import { DatabaseService } from './database.service';
import { BehaviorSubject, Observable } from 'rxjs';
import { ElectronService } from '../core/services';
import { ConnectionParams } from '../interfaces/connection-params.interface';
import { InstrumentConnections } from '../interfaces/intrument-connections.interface';
import { UtilitiesService } from './utilities.service';

@Injectable({
  providedIn: 'root'
})

export class TcpConnectionService {

  public connectionParams: ConnectionParams = null;
  protected handleTCPCallback: (connectionKey: string, data: any) => void;
  public socketClient = null;
  public server = null;
  public net = null;
  public hl7parser = require('hl7parser');

  protected ACK = Buffer.from('06', 'hex');
  protected EOT = '04';
  protected NAK = '21';

  protected strData = '';
  protected clientConnectionOptions: any = null;
  protected timer = null;

  public connections: Map<string, InstrumentConnections> = new Map();

  constructor(public electronService: ElectronService,
    public dbService: DatabaseService,
    public utilitiesService: UtilitiesService) {
    this.net = this.electronService.net;
  }

  // Method used to connect to the Testing Machine
  connect(connectionParams: ConnectionParams, handleTCPCallback: (connectionKey: string, data: any) => void) {

    const that = this;
    that.handleTCPCallback = handleTCPCallback;
    let instrumentConnectionData: InstrumentConnections = null;

    const connectionKey = that._getKey(connectionParams.host, connectionParams.port);

    if (that.connections.has(connectionKey)) {
      instrumentConnectionData = that.connections.get(connectionKey);
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

      that.connections.set(connectionKey, instrumentConnectionData);

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
          that.handleTCPCallback(connectionKey, data);
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
        that.utilitiesService.logger('error', 'Error while connecting ' + e.code, instrumentConnectionData.instrumentId);
        that.disconnect(connectionParams.host, connectionParams.port);

        if (connectionParams.interfaceAutoConnect === 'yes') {
          instrumentConnectionData.connectionAttemptStatusSubject.next(true);
          that.utilitiesService.logger('error', "Interface AutoConnect is enabled: Will re-attempt connection in 30 seconds", instrumentConnectionData.instrumentId);
          setTimeout(() => {
            that.connect(connectionParams, that.handleTCPCallback);
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

      that.utilitiesService.logger('info', 'Trying to connect as client', instrumentConnectionData.instrumentId);

      instrumentConnectionData.connectionSocket.connect(that.clientConnectionOptions, function () {
        instrumentConnectionData.statusSubject.next(true);
        that.utilitiesService.logger('success', 'Connected as client successfully', instrumentConnectionData.instrumentId);
      });

      instrumentConnectionData.connectionSocket.on('data', function (data) {
        instrumentConnectionData.statusSubject.next(true);
        that.handleTCPCallback(connectionKey, data);
      });

      instrumentConnectionData.connectionSocket.on('close', function () {
        that.disconnect(connectionParams.host, connectionParams.port);
        if (connectionParams.interfaceAutoConnect === 'yes') {
          instrumentConnectionData.connectionAttemptStatusSubject.next(true);
          that.utilitiesService.logger('error', "Interface AutoConnect is enabled: Will re-attempt connection in 30 seconds", instrumentConnectionData.instrumentId);
          setTimeout(() => {
            that.connect(connectionParams, that.handleTCPCallback);
          }, 30000);
        }

      });

      instrumentConnectionData.connectionSocket.on('error', (e) => {
        that.utilitiesService.logger('error', e);
        that.disconnect(connectionParams.host, connectionParams.port);

        if (connectionParams.interfaceAutoConnect === 'yes') {
          instrumentConnectionData.connectionAttemptStatusSubject.next(true);
          that.utilitiesService.logger('error', "Interface AutoConnect is enabled: Will re-attempt connection in 30 seconds", instrumentConnectionData.instrumentId);
          setTimeout(() => {
            that.connect(connectionParams, that.handleTCPCallback);
          }, 30000);
        }

      });
    } else {

    }

  }

  reconnect(connectionParams: ConnectionParams, connectInSeconds = 0) {
    let that = this;
    that.disconnect(connectionParams.host, connectionParams.port);
    that.connect(connectionParams, that.handleTCPCallback);
  }

  disconnect(host: string, port: number) {
    const that = this;
    const connectionKey = that._getKey(host, port);

    const instrumentConnectionData = that.connections.get(connectionKey);
    if (instrumentConnectionData) {

      instrumentConnectionData.statusSubject.next(false);
      instrumentConnectionData.connectionAttemptStatusSubject.next(false);

      if (instrumentConnectionData.connectionMode === 'tcpclient' && instrumentConnectionData.connectionSocket) {
        instrumentConnectionData.connectionSocket.end();
        instrumentConnectionData.connectionSocket.destroy();
        that.utilitiesService.logger('info', 'Client Disconnected', instrumentConnectionData.instrumentId);

      } else if (instrumentConnectionData.connectionMode === 'tcpserver' && instrumentConnectionData.connectionServer) {
        instrumentConnectionData.connectionServer.close();
        that.utilitiesService.logger('info', 'Server Stopped', instrumentConnectionData.instrumentId);
      }
    }

  }



  private _getKey(host: string, port: number): string {
    return `${host}:${port}`;
  }

  getStatusObservable(host: string, port: number): Observable<boolean> {
    const connectionKey = this._getKey(host, port);
    const instrumentConnectionData = this.connections.get(connectionKey);
    return instrumentConnectionData.statusSubject.asObservable();
  }

  getConnectionAttemptObservable(host: string, port: number): Observable<boolean> {
    const connectionKey = this._getKey(host, port);
    const instrumentConnectionData = this.connections.get(connectionKey);
    return instrumentConnectionData.connectionAttemptStatusSubject.asObservable();
  }

}
