import { Component, OnInit, NgZone, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { ElectronStoreService } from '../../services/electron-store.service';
import { InstrumentInterfaceService } from '../../services/intrument-interface.service';
import { UtilitiesService } from '../../services/utilities.service';
import { TcpConnectionService } from '../../services/tcp-connection.service';
import { ConnectionParams } from '../../interfaces/connection-params.interface';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit, OnDestroy {
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
  private settingsSubscription: any;
  public searchText: string = '';
  public filteredLogText: any = [];

  constructor(private store: ElectronStoreService,
    private _ngZone: NgZone,
    private interfaceService: InstrumentInterfaceService,
    private tcpService: TcpConnectionService,
    private utilitiesService: UtilitiesService,
    private router: Router) {

  }

  ngOnInit() {

    const that = this;

    // Fetch initial settings if not already present
    if (!this.commonSettings || !this.instrumentsSettings) {
      const initialCommonSettings = this.store.get('commonConfig');
      const initialInstrumentsSettings = this.store.get('instrumentsConfig');
      const appVersion = this.store.get('appVersion');

      if (initialCommonSettings && initialInstrumentsSettings) {
        // Update UtilitiesService with the initial settings
        this.utilitiesService.updateSettings({
          commonConfig: initialCommonSettings,
          instrumentsConfig: initialInstrumentsSettings,
          appVersion: appVersion
        });
      } else {
        // Handle the case where settings are not found
        console.warn('Settings not found, redirecting to settings page');
        this.router.navigate(['/settings']);
      }
    }

    that.settingsSubscription = that.utilitiesService.settings$.subscribe(settings => {
      that._ngZone.run(() => {

        that.commonSettings = settings.commonConfig;
        that.instrumentsSettings = settings.instrumentsConfig;
        that.appVersion = settings.appVersion;

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
              that.tcpService.reconnect(instrument);
            }, 1000);
          }
        });

        that.utilitiesService.liveLog.subscribe(mesg => {
          that._ngZone.run(() => {
            that.filteredLogText = that.liveLogText = mesg;
            that.filterLogs();
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

    });
  }



  fetchLastOrders() {
    const that = this;
    that.utilitiesService.fetchLastOrders();

    that.utilitiesService.fetchLastSyncTimes(function (data) {
      that.lastLimsSync = data.lastLimsSync;
      that.lastResultReceived = data.lastResultReceived;
    });

    that.utilitiesService.lastOrders.subscribe(lastFewOrders => {
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
    //that.tcpService.connect(instrument.connectionParams, that.interfaceService.handleTCPResponse);
    that.tcpService.getStatusObservable(instrument.connectionParams.host, instrument.connectionParams.port).subscribe(status => {
      that._ngZone.run(() => {
        instrument.isConnected = status;
      });
    });

    that.tcpService.getConnectionAttemptObservable(instrument.connectionParams.host, instrument.connectionParams.port).subscribe(status => {
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
    this.tcpService.disconnect(instrument.connectionParams.host, instrument.connectionParams.port);
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
    if (this.settingsSubscription) {
      this.settingsSubscription.unsubscribe(); // Unsubscribe to avoid memory leaks
    }
  }

}
