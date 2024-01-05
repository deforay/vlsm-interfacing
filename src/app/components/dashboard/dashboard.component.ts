import { Component, OnInit, NgZone, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
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
  public availableInstruments = [];
  public instrumentLogs = [];
  public connectionParams: ConnectionParams = null;
  public selectedTabIndex = 0;
  private electronStoreSubscription: any;
  public searchText: string = '';

  constructor(
    private cdRef: ChangeDetectorRef,
    private sanitizer: DomSanitizer,
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
          //instrument.logs = []; // Initialize logs
          //instrument.filteredLogs = []; // Initialize filtered logs
          //instrument.searchText = ''; // Initialize search text

          if (null === that.commonSettings || undefined === that.commonSettings || !instrument.connectionParams.port || (instrument.connectionParams.connectionProtocol === 'tcpclient' && !instrument.connectionParams.host)) {
            that.router.navigate(['/settings']);
          }


          if (instrument.connectionParams.interfaceAutoConnect !== undefined && instrument.connectionParams.interfaceAutoConnect !== null && instrument.connectionParams.interfaceAutoConnect === 'yes') {
            setTimeout(() => {
              that.reconnect(instrument);
            }, 1000);
          }

          that.utilitiesService.getInstrumentLogSubject(instrument.connectionParams.instrumentId)
            .subscribe(logs => {
              that._ngZone.run(() => {
                //instrument.logs = logs;
                that.updateLogsForInstrument(instrument.connectionParams.instrumentId, logs);
                that.filterInstrumentLogs(instrument);
                that.cdRef.detectChanges(); // Trigger change detection
              });
            });

          that.availableInstruments.push(instrument);
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

  updateLogsForInstrument(instrumentId: string, newLogs: any) {
    if (!this.instrumentLogs[instrumentId]) {
      // Initialize the logs structure if it does not exist
      this.instrumentLogs[instrumentId] = {
        logs: [],
        filteredLogs: []
      };
    }
    // Update both logs and filteredLogs, as the new logs are not yet filtered
    this.instrumentLogs[instrumentId].logs = newLogs;
    this.instrumentLogs[instrumentId].filteredLogs = newLogs;
  }


  fetchRecentLogs() {
    const that = this;
    that.availableInstruments.forEach(instrument => {
      let logs = that.utilitiesService.fetchRecentLogs(instrument.connectionParams.instrumentId);
      //instrument.logs = logs; // Initially, filteredLogs are the same as logs
      that.updateLogsForInstrument(instrument.connectionParams.instrumentId, logs);

    });

    that.cdRef.detectChanges(); // Trigger change detection
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

  selectTab(index: number): void {
    this.selectedTabIndex = index;
  }

  filterInstrumentLogs(instrument: any) {

    if (!this.instrumentLogs[instrument.connectionParams.instrumentId]) {
      // Initialize the logs structure for the instrument if not already done
      this.instrumentLogs[instrument.connectionParams.instrumentId] = {
        logs: [...instrument.logs],
        filteredLogs: [...instrument.logs]
      };
    }

    if (!instrument.searchText || instrument.searchText === '') {
      // If search text is empty, show all logs
      this.instrumentLogs[instrument.connectionParams.instrumentId].filteredLogs = [...this.instrumentLogs[instrument.connectionParams.instrumentId].logs];
    } else {
      // Apply filter on the original logs
      this.instrumentLogs[instrument.connectionParams.instrumentId].filteredLogs = this.instrumentLogs[instrument.connectionParams.instrumentId].logs.filter(log =>
        log.toLowerCase().includes(instrument.searchText.trim().toLowerCase())
      );
    }

    this.cdRef.detectChanges(); // Trigger change detection if needed
  }



  copyLog(instrument) {
    if (this.instrumentLogs[instrument.connectionParams.instrumentId]) {
      // Join the filtered logs with a newline character
      const logContent = this.instrumentLogs[instrument.connectionParams.instrumentId].filteredLogs.join('\n');
      this.copyTextToClipboard(logContent);
    } else {
      console.error('No logs found for instrument:', instrument.connectionParams.instrumentId);
    }
  }


  clearLiveLog(instrument) {
    this.utilitiesService.clearLiveLog(instrument.connectionParams.instrumentId);
    // Clear logs and filtered logs for the specific instrument
    if (this.instrumentLogs[instrument.connectionParams.instrumentId]) {
      this.instrumentLogs[instrument.connectionParams.instrumentId].logs = [];
      this.instrumentLogs[instrument.connectionParams.instrumentId].filteredLogs = [];
    }
    this.cdRef.detectChanges(); // Trigger change detection if needed
  }


  copyTextToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      console.log('Log copied to clipboard');
    }, (err) => {
      console.error('Error in copying text: ', err);
    });
  }

  getSafeHtml(logEntry) {
    return this.sanitizer.bypassSecurityTrustHtml(logEntry);
  }

  ngOnDestroy() {
    clearInterval(this.interval);
    if (this.electronStoreSubscription) {
      this.electronStoreSubscription.unsubscribe(); // Unsubscribe to avoid memory leaks
    }
  }

}
