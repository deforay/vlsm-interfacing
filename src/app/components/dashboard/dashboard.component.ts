import { Component, OnInit, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { ElectronStoreService } from '../../services/electron-store.service';
import { InterfaceService } from '../../services/interface.service';
import { ConnectionParams } from '../../interfaces/connection-params.interface';
//import { GeneXpertService } from '../../services/genexpert.service';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {
  public isConnected = false;
  public commonSettings = null;
  public instrumentsSettings = null;
  public appVersion: string = null;
  public connectionInProcess = false;
  public reconnectButtonText = 'Connect';
  public lastLimsSync = '';
  public lastResultReceived = '';
  public machineName = '';
  public interval: any;
  public lastOrders: any;
  public liveLogText = [];
  public connectionParams: ConnectionParams = null;

  constructor(private store: ElectronStoreService,
    private _ngZone: NgZone,
    public interfaceService: InterfaceService,
    private router: Router) {

  }

  ngOnInit() {

    const that = this;

    that.commonSettings = that.store.get('commonConfig');
    that.instrumentsSettings = that.store.get('instrumentsConfig');
    that.appVersion = that.store.get('appVersion');

    that.connectionParams = {
      connectionMode: that.instrumentsSettings[0].interfaceConnectionMode,
      connectionProtocol: that.instrumentsSettings[0].interfaceCommunicationProtocol,
      host: that.instrumentsSettings[0].analyzerMachineHost,
      port: that.instrumentsSettings[0].analyzerMachinePort,
      instrumentId: that.instrumentsSettings[0].analyzerMachineName,
      machineType: that.instrumentsSettings[0].analyzerMachineType,
      labName: that.commonSettings.labName,
      interfaceAutoConnect: that.commonSettings.interfaceAutoConnect
    };

    if (null === that.commonSettings || undefined === that.commonSettings || !that.connectionParams.port || !that.connectionParams.connectionProtocol || !that.connectionParams.host) {
      that.router.navigate(['/settings']);
    } else {
      that.machineName = that.connectionParams.instrumentId;
    }

    if (that.connectionParams.interfaceAutoConnect !== undefined && that.connectionParams.interfaceAutoConnect !== null && that.connectionParams.interfaceAutoConnect === 'yes') {
      setTimeout(() => {
        that.reconnect(that.connectionParams);
      }, 1000);
    }

    that.interfaceService.liveLog.subscribe(mesg => {
      that._ngZone.run(() => {
        that.liveLogText = mesg;
      });
    });

    setTimeout(() => {
      // Let us fetch last few Orders and Logs on load
      that.fetchLastOrders();
      that.fetchRecentLogs();
    }, 600);

    // let us refresh last orders every 5 minutes
    that.interval = setInterval(() => { that.fetchLastOrders(); }, 1000 * 60 * 5);

  }

  fetchLastOrders() {
    const that = this;
    that.interfaceService.fetchLastOrders();

    that.interfaceService.fetchLastSyncTimes(function (data) {
      that.lastLimsSync = data.lastLimsSync;
      that.lastResultReceived = data.lastResultReceived;
    });

    that.interfaceService.lastOrders.subscribe(lastFewOrders => {
      that._ngZone.run(() => {
        that.lastOrders = lastFewOrders[0];
      });
    });

  }

  fetchRecentLogs() {
    this.interfaceService.fetchRecentLogs();
  }

  clearLiveLog() {
    this.liveLogText = null;
    this.interfaceService.clearLiveLog();
  }

  reconnect(connectionParams: ConnectionParams) {

    const that = this;
    that.interfaceService.reconnect(connectionParams);
    that.interfaceService.getStatusObservable(connectionParams.host, connectionParams.port).subscribe(status => {
      that._ngZone.run(() => {
        that.isConnected = status;
      });
    });

    that.interfaceService.getConnectionAttemptObservable(connectionParams.host, connectionParams.port).subscribe(status => {
      that._ngZone.run(() => {
        if (status === false) {
          that.connectionInProcess = false;
          that.reconnectButtonText = 'Connect';
        } else {
          that.connectionInProcess = true;
          that.reconnectButtonText = 'Please wait ...';
        }
      });
    });


  }

  close(connectionParams: ConnectionParams) {
    this.interfaceService.disconnect(connectionParams.host, connectionParams.port);
  }

  ngOnDestroy() {
    clearInterval(this.interval);
  }

}
