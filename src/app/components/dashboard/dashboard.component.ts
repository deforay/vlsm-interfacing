import { Component, OnInit, NgZone, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { ElectronStoreService } from '../../services/electron-store.service';
import { InstrumentInterfaceService } from '../../services/instrument-interface.service';
import { UtilitiesService } from '../../services/utilities.service';
import { TcpConnectionService } from '../../services/tcp-connection.service';
import { ConnectionParams } from '../../interfaces/connection-params.interface';
import { MatPaginator } from '@angular/material/paginator';
import { MatTableDataSource } from '@angular/material/table';
import { MatSort } from '@angular/material/sort';
import { ViewChild } from '@angular/core';
import { SelectionModel } from "@angular/cdk/collections";
import { MatCheckboxChange } from '@angular/material/checkbox';
import { distinctUntilChanged } from 'rxjs/operators';

export enum SelectType {
  single,
  multiple
}
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
  public data: any;
  public lastOrders: any;
  public availableInstruments = [];
  public instrumentLogs = [];
  public connectionParams: ConnectionParams = null;
  public selectedTabIndex = 0;
  private electronStoreSubscription: any;
  public displayedColumns: string[] = [
    'select',
    'machine_used',
    'order_id',
    'results',
    'test_unit',
    'test_type',
    'tested_by',
    'analysed_date_time',
    'added_on',
    'lims_sync_status',
    'lims_sync_date_time'
  ];
  selectType = [
    { text: "Single", value: SelectType.single },
    { text: "Multiple", value: SelectType.multiple }
  ];
  selection = new SelectionModel<any>(true, []);
  displayType = SelectType.single;
  dataSource = new MatTableDataSource<any>();
  @ViewChild(MatPaginator, { static: true }) paginator: MatPaginator;
  @ViewChild(MatSort, { static: true }) sort: MatSort;



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
  selectHandler(row: any, event: MatCheckboxChange) {
    if (row === null) {
      if (event.checked) {
        this.dataSource.data.forEach(row => this.selection.select(row));
      } else {
        this.selection.clear();
      }
    } else {
      this.selection.toggle(row);
    }
  }



  onChange(typeValue: number) {
    this.displayType = typeValue;
    this.selection.clear();
  }

  ngOnInit() {
    this.loadSettings();

    // Scroll to the top of the page when the component initializes
    window.scrollTo(0, 0);

    // Fetch last few orders and logs on load
    setTimeout(() => {
      this.fetchLastOrders();
      this.fetchRecentLogs();
    }, 600);

    // Refresh last orders every 5 minutes
    this.interval = setInterval(() => { this.fetchLastOrders(); }, 1000 * 60 * 5);

    // Refresh last orders every 5 minutes
    this.interval = setInterval(() => {
      this.fetchLastOrders();
      this.resyncTestResultsToMySQL();
    }, 1000 * 60 * 5);
  }


  setupInstruments() {
    this.availableInstruments = [];

    this.instrumentsSettings.forEach((instrumentSetting, index) => {
      let instrument: any = {};
      instrument.connectionParams = {
        instrumentIndex: index,
        connectionMode: instrumentSetting.interfaceConnectionMode,
        connectionProtocol: instrumentSetting.interfaceCommunicationProtocol,
        host: instrumentSetting.analyzerMachineHost ?? '127.0.0.1',
        port: instrumentSetting.analyzerMachinePort,
        instrumentId: instrumentSetting.analyzerMachineName,
        machineType: instrumentSetting.analyzerMachineType,
        labName: this.commonSettings.labName,
        interfaceAutoConnect: this.commonSettings.interfaceAutoConnect
      };

      instrument.isConnected = false;
      instrument.instrumentButtonText = 'Connect';

      if (!this.commonSettings || !instrument.connectionParams.port || (instrument.connectionParams.connectionProtocol === 'tcpclient' && !instrument.connectionParams.host)) {
        this.router.navigate(['/settings']);
        return;
      }

      if (instrument.connectionParams.interfaceAutoConnect === 'yes') {
        setTimeout(() => {
          this.reconnect(instrument);
        }, 1000);
      }

      this.utilitiesService.getInstrumentLogSubject(instrument.connectionParams.instrumentId)
        .subscribe(logs => {
          this._ngZone.run(() => {
            this.updateLogsForInstrument(instrument.connectionParams.instrumentId, logs);
            this.filterInstrumentLogs(instrument);
            this.cdRef.detectChanges();
          });
        });

      this.availableInstruments.push(instrument);
    });
  }

  loadSettings() {
    const initialSettings = this.store.getAll();

    if (!initialSettings.commonConfig || !initialSettings.instrumentsConfig) {
      const initialCommonSettings = this.store.get('commonConfig');
      const initialInstrumentsSettings = this.store.get('instrumentsConfig');

      if (!initialCommonSettings || !initialInstrumentsSettings) {
        console.warn('Settings not found, redirecting to settings page');
        this.router.navigate(['/settings']);
        return;
      }
    }

    this.electronStoreSubscription = this.store.electronStoreObservable().subscribe(electronStoreObject => {
      this._ngZone.run(() => {
        this.commonSettings = electronStoreObject.commonConfig;
        this.instrumentsSettings = electronStoreObject.instrumentsConfig;
        this.appVersion = electronStoreObject.appVersion;

        this.setupInstruments();
        this.cdRef.detectChanges();
      });
    });
  }


  reSyncSelectedRecords() {
    this.selection.selected.forEach(selectedRow => {
      if (this.utilitiesService) {
        this.utilitiesService.reSyncRecord(selectedRow.order_id).subscribe({
          next: (response) => {
            selectedRow.lims_sync_status = '0';
            this.dataSource.data = [...this.dataSource.data];
            // Clear selection after re-sync
            this.selection.clear();
          },
          error: (error) => {
            console.error('Error during re-sync:', error);
          }
        });
      } else {
        console.error('Utilities service is undefined.');
      }
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
          that.data = lastFewOrders[0];
          this.dataSource.data = that.lastOrders;
          this.dataSource.paginator = this.paginator;
          this.dataSource.sort = this.sort;


        });
      },
      error: error => {
        console.error('Error fetching last orders:', error);
      }
    });

  }

  filterData($event: any) {
    this.dataSource.filter = $event.target.value;
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

  sendASTMOrders(instrument: any) {
    const that = this;
    if (instrument && instrument.connectionParams && instrument.connectionParams.host && instrument.connectionParams.port) {
      that.instrumentInterfaceService.fetchAndSendASTMOrders(instrument);
    }
  }

  updateInstrumentStatusSubscription(instrument: any) {
    const that = this;
    that.tcpService.getStatusObservable(instrument.connectionParams).subscribe(status => {
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

    that.tcpService.getConnectionAttemptObservable(instrument.connectionParams)
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

    that.tcpService.getTransmissionStatusObservable(instrument.connectionParams)
      .pipe(distinctUntilChanged())
      .subscribe(status => {
        that._ngZone.run(() => {
          // Update the availableInstruments array
          that.availableInstruments = this.availableInstruments.map(inst => {
            if (inst.connectionParams.instrumentId === instrument.connectionParams.instrumentId) {
              return {
                ...inst,
                transmissionInProgress: status
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


  clearLiveLog(instrument: any) {
    this.utilitiesService.clearLiveLog(instrument.connectionParams.instrumentId);
    // Clear logs and filtered logs for the specific instrument
    if (this.instrumentLogs[instrument.connectionParams.instrumentId]) {
      this.instrumentLogs[instrument.connectionParams.instrumentId].logs = [];
      this.instrumentLogs[instrument.connectionParams.instrumentId].filteredLogs = [];
    }
    this.cdRef.detectChanges(); // Trigger change detection if needed
  }


  resyncTestResultsToMySQL() {
    this.utilitiesService.resyncTestResultsToMySQL(
      (message) => {
        console.log(message);
      },
      (error) => {
        console.error(error);
      }
    );
  }

  copyTextToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      console.log('Log copied to clipboard');
    }, (err) => {
      console.error('Error in copying text: ', err);
    });
  }

  getSafeHtml(logEntry: string) {
    return this.sanitizer.bypassSecurityTrustHtml(logEntry);
  }

  ngOnDestroy() {
    clearInterval(this.interval);
    if (this.electronStoreSubscription) {
      this.electronStoreSubscription.unsubscribe(); // Unsubscribe to avoid memory leaks
    }
  }

}
