import { Component, OnInit, NgZone, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { ElectronStoreService } from '../../services/electron-store.service';
import { InstrumentInterfaceService } from '../../services/instrument-interface.service';
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
  public availableInstruments = [];
  public connectionParams: ConnectionParams = null;
  public selectedTabIndex = 0;
  private electronStoreSubscription: any;
  public searchText: string = '';
  public filteredLogText: any = [];

  constructor(
    private cdRef: ChangeDetectorRef,
    private store: ElectronStoreService,
    private _ngZone: NgZone,
    private instrumentInterfaceService: InstrumentInterfaceService,
    private tcpService: TcpConnectionService,
    private utilitiesService: UtilitiesService,
    private router: Router) {

  }

  ngOnInit() {

    const that = this;

    const initialSettings = that.store.getAll();

    that.utilitiesService.logger('ignore', "<hr/>");

    // Fetch initial settings if not already present
    if (!initialSettings.commonConfig || !initialSettings.instrumentsConfig) {
      const initialCommonSettings = that.store.get('commonConfig');
      const initialInstrumentsSettings = that.store.get('instrumentsConfig');

      if (!initialCommonSettings || !initialInstrumentsSettings) {
        // Handle the case where settings are not found
        console.warn('Settings not found, redirecting to settings page');
        that.router.navigate(['/settings']);
      }
    }

    that.electronStoreSubscription = that.store.electronStoreObservable().subscribe(electronStoreObject => {

      that._ngZone.run(() => {
        this.cdRef.detectChanges();
        that.commonSettings = electronStoreObject.commonConfig;
        that.instrumentsSettings = electronStoreObject.instrumentsConfig;
        that.appVersion = electronStoreObject.appVersion;

        that.instrumentsSettings.forEach((instrumentSetting, index) => {
          let instrument: any = {};
          instrument.connectionParams = {
            instrumentIndex: index,
            connectionMode: instrumentSetting.interfaceConnectionMode,
            connectionProtocol: instrumentSetting.interfaceCommunicationProtocol,
            host: instrumentSetting.analyzerMachineHost ?? '127.0.0.1',
            port: instrumentSetting.analyzerMachinePort,
            instrumentId: instrumentSetting.analyzerMachineName,
            machineType: instrumentSetting.analyzerMachineType,
            labName: that.commonSettings.labName,
            interfaceAutoConnect: that.commonSettings.interfaceAutoConnect
          };

          instrument.isConnected = false;
          instrument.instrumentButtonText = 'Connect';

          if (null === that.commonSettings || undefined === that.commonSettings || !instrument.connectionParams.port || (instrument.connectionParams.connectionProtocol === 'tcpclient' && !instrument.connectionParams.host)) {
            that.router.navigate(['/settings']);
          }


          if (instrument.connectionParams.interfaceAutoConnect !== undefined && instrument.connectionParams.interfaceAutoConnect !== null && instrument.connectionParams.interfaceAutoConnect === 'yes') {
            setTimeout(() => {
              that.reconnect(instrument);
            }, 1000);
          }
          that.availableInstruments.push(instrument);
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

    that.utilitiesService.lastOrders.subscribe({
      next: lastFewOrders => {
        that._ngZone.run(() => {
          that.lastOrders = lastFewOrders[0];
        });
      },
      error: error => {
        console.error('Error fetching last orders:', error);
      }
    });

  }

  fetchRecentLogs() {
    this.utilitiesService.fetchRecentLogs();
  }

  clearLiveLog() {
    this.liveLogText = null;
    this.utilitiesService.clearLiveLog();
  }

  connect(instrument: any) {
    const that = this;
    if (instrument && instrument.connectionParams && instrument.connectionParams.host && instrument.connectionParams.port) {
      that.instrumentInterfaceService.connect(instrument);
      that.updateInstrumentStatusSubscription(instrument);
    }
  }

  reconnect(instrument: any) {
    const that = this;
    if (instrument && instrument.connectionParams && instrument.connectionParams.host && instrument.connectionParams.port) {
      that.instrumentInterfaceService.reconnect(instrument);
      that.updateInstrumentStatusSubscription(instrument);
    }
  }

  disconnect(instrument: any) {
    const that = this;
    if (instrument && instrument.connectionParams && instrument.connectionParams.host && instrument.connectionParams.port) {
      that.instrumentInterfaceService.disconnect(instrument);
      that.updateInstrumentStatusSubscription(instrument);
    }
  }

  updateInstrumentStatusSubscription(instrument: any) {
    const that = this;
    that.tcpService.getStatusObservable(instrument.connectionParams.host, instrument.connectionParams.port).subscribe(status => {
      that._ngZone.run(() => {
        // Update the availableInstruments array
        that.availableInstruments = that.availableInstruments.map(inst => {
          if (inst.connectionParams.instrumentId === instrument.connectionParams.instrumentId) {
            return { ...inst, isConnected: status };
          }
          return inst;
        });
        this.cdRef.detectChanges();
      });
    });

    that.tcpService.getConnectionAttemptObservable(instrument.connectionParams.host, instrument.connectionParams.port)
      .subscribe(status => {
        that._ngZone.run(() => {
          // Update the availableInstruments array
          that.availableInstruments = this.availableInstruments.map(inst => {
            if (inst.connectionParams.instrumentId === instrument.connectionParams.instrumentId) {
              return {
                ...inst,
                connectionInProcess: status,
                instrumentButtonText: status ? 'Please wait ...' : 'Connect'
              };
            }
            return inst;
          });
          this.cdRef.detectChanges();
        });
      });
  }

  close(instrument: any) {
    if (instrument && instrument.connectionParams && instrument.connectionParams.host && instrument.connectionParams.port) {
      this.tcpService.disconnect(instrument.connectionParams.host, instrument.connectionParams.port);
    }
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
    if (this.electronStoreSubscription) {
      this.electronStoreSubscription.unsubscribe(); // Unsubscribe to avoid memory leaks
    }
  }

}
