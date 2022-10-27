import { Component, OnInit, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { ElectronStoreService } from '../../services/electron-store.service';
import { InterfaceService } from '../../services/interface.service';
//import { GeneXpertService } from '../../services/genexpert.service';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {
  public isConnected = false;
  public appSettings = null;
  public connectionInProcess = false;
  public reconnectButtonText = 'Connect';
  public lastLimsSync = '';
  public lastResultReceived = '';
  public machineName = '';
  public interval: any;
  public lastOrders: any;
  public liveLogText = [];

  constructor(private store: ElectronStoreService,
    private _ngZone: NgZone,
    public interfaceService: InterfaceService,
    private router: Router) {

  }

  ngOnInit() {

    const that = this;

    that.appSettings = that.store.get('appSettings');

    if (null === that.appSettings || undefined === that.appSettings || !that.appSettings.analyzerMachinePort || !that.appSettings.interfaceCommunicationProtocol || !that.appSettings.analyzerMachineHost) {
      that.router.navigate(['/settings']);
    } else {
      that.machineName = that.appSettings.analyzerMachineName;
    }

    if (that.appSettings.interfaceAutoConnect === 'yes') {
      setTimeout(() => { that.reconnect() }, 1000);
    }

    that.interfaceService.currentStatus.subscribe(status => {
      that._ngZone.run(() => {
        that.isConnected = status;
      });
    });

    that.interfaceService.connectionAttemptStatus.subscribe(status => {
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

    that.interfaceService.liveLog.subscribe(mesg => {
      that._ngZone.run(() => {
        that.liveLogText = mesg;
      });
    });


    setTimeout(() => {
      // Let us fetch last few Orders and Logs on load
      that.fetchLastOrders();

      that.fetchRecentLogs();

    }, 400);

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

  reconnect() {
    this.interfaceService.reconnect();
  }

  close() {
    this.interfaceService.closeConnection();
  }

  ngOnDestroy() {
    clearInterval(this.interval);
  }

}

