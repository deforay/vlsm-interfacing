import { Component, OnInit, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { ElectronStoreService } from '../../services/electron-store.service';
import { InstrumentInterfaceService } from '../../services/intrument-interface.service';
import { UtilitiesService } from '../../services/utilities.service';
import { ConnectionParams } from '../../interfaces/connection-params.interface';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {
  public commonSettings = null;
  public instrumentsSettings = null;
  public appVersion: string = null;
  public lastLimsSync = '';
  public lastResultReceived = '';
  public interval: any;
  public lastOrders: any;
  public liveLogText = [];
  public connectionParams: ConnectionParams = null;
  public selectedTabIndex = 0;
  private configSubscription: any;
  public searchText: string = '';
  public filteredLogText: any = [];

  constructor(private store: ElectronStoreService,
    private _ngZone: NgZone,
    public interfaceService: InstrumentInterfaceService,
    public utilitiesService: UtilitiesService,
    private router: Router) {

  }

  ngOnInit() {

    const that = this;

    this.configSubscription = this.store.getConfigObservable().subscribe(config => {

      that.commonSettings = config.commonConfig;
      that.instrumentsSettings = config.instrumentsConfig;
      that.appVersion = config.appVersion;

      that.instrumentsSettings.forEach((instrument, index) => {
        instrument.connectionParams = {
          connectionMode: instrument.interfaceConnectionMode,
          connectionProtocol: instrument.interfaceCommunicationProtocol,
          host: instrument.analyzerMachineHost,
          port: instrument.analyzerMachinePort,
          instrumentId: instrument.analyzerMachineName,
          machineType: instrument.analyzerMachineType,
          labName: that.commonSettings.labName,
          interfaceAutoConnect: that.commonSettings.interfaceAutoConnect
        };

        instrument.isConnected = false;
        instrument.reconnectButtonText = 'Connect';

        if (null === that.commonSettings || undefined === that.commonSettings || !instrument.connectionParams.port || (instrument.connectionParams.connectionProtocol === 'tcpclient' && !instrument.connectionParams.host)) {
          that.router.navigate(['/settings']);
        }

        if (instrument.connectionParams.interfaceAutoConnect !== undefined && instrument.connectionParams.interfaceAutoConnect !== null && instrument.connectionParams.interfaceAutoConnect === 'yes') {
          setTimeout(() => {
            that.reconnect(instrument);
          }, 1000);
        }
      });

      that.utilitiesService.liveLog.subscribe(mesg => {
        that._ngZone.run(() => {
          this.filteredLogText = that.liveLogText = mesg;
          this.filterLogs();
        });
      });

      setTimeout(() => {
        // Let us fetch last few Orders and Logs on load
        that.fetchLastOrders();
        that.fetchRecentLogs();
      }, 600);

      // let us refresh last orders every 5 minutes
      that.interval = setInterval(() => { that.fetchLastOrders(); }, 1000 * 60 * 5);
    });

  }



  fetchLastOrders() {
    const that = this;
    that.utilitiesService.fetchLastOrders();

    that.utilitiesService.fetchLastSyncTimes(function (data) {
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
    this.utilitiesService.fetchRecentLogs();
  }

  clearLiveLog() {
    this.liveLogText = null;
    this.utilitiesService.clearLiveLog();
  }
  reconnect(instrument: any) {
    const that = this;
    that.interfaceService.connect(instrument.connectionParams);
    that.interfaceService.getStatusObservable(instrument.connectionParams.host, instrument.connectionParams.port).subscribe(status => {
      that._ngZone.run(() => {
        instrument.isConnected = status;
      });
    });

    that.interfaceService.getConnectionAttemptObservable(instrument.connectionParams.host, instrument.connectionParams.port).subscribe(status => {
      that._ngZone.run(() => {
        if (!status) {
          instrument.connectionInProcess = false;
          instrument.reconnectButtonText = 'Connect';
        } else {
          instrument.connectionInProcess = true;
          instrument.reconnectButtonText = 'Please wait ...';
        }
      });
    });
  }

  close(instrument: any) {
    this.interfaceService.disconnect(instrument.connectionParams.host, instrument.connectionParams.port);
  }

  selectTab(index: number): void {
    this.selectedTabIndex = index;
  }


  filterLogs() {
    if (this.searchText.trim() === '') {
      // If searchText is empty, show all logs
      this.filteredLogText = this.liveLogText;
    } else {
      // If searchText is not empty, filter the logs
      this.filteredLogText = this.liveLogText.filter(log => log.toLowerCase().includes(this.searchText.toLowerCase()));
    }
  }
  copyLog() {
    const logContent = this.liveLogText.join('');  // Join the array elements into a single string
    this.copyTextToClipboard(logContent);
  }

  copyTextToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      console.log('Log copied to clipboard');
    }, (err) => {
      console.error('Error in copying text: ', err);
    });
  }


  ngOnDestroy() {
    clearInterval(this.interval);
    // Unsubscribe from the configuration observable to avoid memory leaks
    if (this.configSubscription) {
      this.configSubscription.unsubscribe();
    }
  }

}
