// src/app/components/console/console.component.ts

import { Component, OnInit, NgZone, OnDestroy, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { ElectronStoreService } from '../../services/electron-store.service';
import { InstrumentInterfaceService } from '../../services/instrument-interface.service';
import { UtilitiesService } from '../../services/utilities.service';
import { TcpConnectionService } from '../../services/tcp-connection.service';
import { ConnectionManagerService } from '../../services/connection-manager.service';
import { ConnectionParams } from '../../interfaces/connection-params.interface';
import { MatPaginator } from '@angular/material/paginator';
import { MatTableDataSource } from '@angular/material/table';
import { MatSort } from '@angular/material/sort';
import { SelectionModel } from "@angular/cdk/collections";
import { MatCheckboxChange } from '@angular/material/checkbox';
import { fromEvent, Subscription } from 'rxjs';
import { IpcRenderer } from 'electron';
import { MatDialog } from '@angular/material/dialog';
import { ChangeDetectionStrategy } from '@angular/core';
import { debounceTime, distinctUntilChanged, shareReplay, map, filter } from 'rxjs/operators';

export enum SelectType {
  single,
  multiple
}

@Component({
  selector: 'app-console',
  templateUrl: './console.component.html',
  styleUrls: ['./console.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConsoleComponent implements OnInit, OnDestroy {
  searchTerm: string = '';
  public commonSettings = null;
  public instrumentsSettings = null;
  public appVersion: string = null;
  public lastLimsSync = '';
  public lastResultReceived = '';
  public recentResultsInterval: any; // Interval for fetching recent results
  public mysqlCheckInterval: any; // Interval for checking MySQL connection
  public mysqlConnected: boolean = false;  // To store the MySQL connection status
  public walCheckpointInterval: any; // Interval for performing SQLite WAL checkpoints
  public data: any;
  public lastOrders: any;
  private readonly ipc: IpcRenderer;
  public availableInstruments = [];
  public instrumentLogs = [];
  public connectionParams: ConnectionParams = null;
  public selectedTabIndex = 0;
  private electronStoreSubscription: Subscription;
  private instrumentsSubscription: Subscription;

  private checkConnectionsAfterInactivity() {
    console.log('Checking connection status after inactivity');

    // Check each instrument
    this.availableInstruments.forEach(instrument => {
      if (instrument.isConnected) {
        // For any instrument that thinks it's connected, verify the connection
        // This will trigger the heartbeat system to check
        this.tcpService.verifyConnection(instrument.connectionParams);
      }
    });
  }

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
  @ViewChild('searchInput', { static: true }) searchInput: ElementRef;
  @ViewChild(MatPaginator, { static: true }) paginator: MatPaginator;
  @ViewChild(MatSort, { static: true }) sort: MatSort;

  constructor(
    private readonly dialog: MatDialog,
    private readonly cdRef: ChangeDetectorRef,
    private readonly sanitizer: DomSanitizer,
    private readonly store: ElectronStoreService,
    private readonly _ngZone: NgZone,
    private readonly instrumentInterfaceService: InstrumentInterfaceService,
    private readonly connectionManagerService: ConnectionManagerService,
    private readonly tcpService: TcpConnectionService,
    private readonly utilitiesService: UtilitiesService,
    private readonly router: Router) {
    if ((<any>window).require) {
      this.ipc = (<any>window).require('electron').ipcRenderer;
    } else {
      console.warn('App not running inside Electron!');
    }
  }

  selectHandler(row: any, event: MatCheckboxChange) {
    const that = this;
    if (row === null) {
      if (event.checked) {
        that.dataSource.data.forEach(row => that.selection.select(row));
      } else {
        that.selection.clear();
      }
    } else {
      that.selection.toggle(row);
    }
  }

  onChange(typeValue: number) {
    this.displayType = typeValue;
    this.selection.clear();
  }

  ngAfterViewInit() {
    // Setup debounced search after view is initialized and input element is available
    if (this.searchInput && this.searchInput.nativeElement) {
      fromEvent(this.searchInput.nativeElement, 'input').pipe(
        map((event: any) => event.target.value),
        debounceTime(300), // Wait 300ms after last event
        distinctUntilChanged() // Only emit if value changed
      ).subscribe(value => {
        // Run in NgZone to trigger change detection
        this._ngZone.run(() => {
          this.filterData({ target: { value } });
        });
      });
    }
  }

  ngOnInit() {
    const that = this;
    that.loadSettings();
    that.checkMysqlConnection();

    // Scroll to the top of the page when the component initializes
    window.scrollTo(0, 0);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.checkConnectionsAfterInactivity();
      }
    });

    // Subscribe to available instruments from the connection manager
    that.instrumentsSubscription = that.connectionManagerService.getActiveInstruments()
      .subscribe(instruments => {
        that._ngZone.run(() => {
          that.availableInstruments = instruments;

          // Check if we should auto-reconnect instruments
          that.checkForAutoReconnect();

          // Initialize the logs for each instrument
          that.availableInstruments.forEach(instrument => {
            that.utilitiesService.getInstrumentLogSubject(instrument.connectionParams.instrumentId)
              .subscribe(logs => {
                that._ngZone.run(() => {
                  that.updateLogsForInstrument(instrument.connectionParams.instrumentId, logs);
                  that.filterInstrumentLogs(instrument);
                  that.cdRef.detectChanges();
                });
              });
          });

          that.cdRef.detectChanges();
        });
      });

    // Fetch last few orders and logs on load
    setTimeout(() => {
      that.fetchRecentResults();
      that.fetchRecentLogs();
    }, 600);

    // Check MySQL connection on regular intervals
    that.mysqlCheckInterval = setInterval(() => {
      that.checkMysqlConnection();
    }, 1000 * 7);

    // Refresh last orders every 5 minutes
    that.recentResultsInterval = setInterval(() => {
      that.fetchRecentResults();
      that.resyncTestResultsToMySQL();
    }, 1000 * 60 * 5);

    // SQLite WAL checkpoint every 30 minutes
    that.walCheckpointInterval = setInterval(() => {
      that.runSQLiteWalCheckpoint();
    }, 1000 * 60 * 30); // 30 minutes
  }

  private checkForAutoReconnect() {
    //console.log('Checking for auto-reconnect condition');

    // Check multiple sources for the returnFromSettings flag
    const navigation = this.router.getCurrentNavigation();
    const navigationState = navigation?.extras?.state?.returnFromSettings;
    const localStorageFlag = localStorage.getItem('returnFromSettings') === 'true';
    const sessionStorageFlag = sessionStorage.getItem('returnFromSettings') === 'true';
    const windowFlag = (window as any).returnFromSettings === true;

    // // Log all sources for debugging
    // console.log('Navigation state returnFromSettings:', navigationState);
    // console.log('localStorage returnFromSettings:', localStorageFlag);
    // console.log('sessionStorage returnFromSettings:', sessionStorageFlag);
    // console.log('window returnFromSettings:', windowFlag);

    // Use any of the sources
    const returnFromSettings = navigationState || localStorageFlag || sessionStorageFlag || windowFlag;

    // Clear all flags
    localStorage.removeItem('returnFromSettings');
    sessionStorage.removeItem('returnFromSettings');
    (window as any).returnFromSettings = false;

    if (returnFromSettings) {
      //console.log('Returning from settings, checking auto-connect instruments');

      // Add a slight delay to ensure component is fully loaded
      setTimeout(() => {
        // Use the service to reconnect all applicable instruments
        const reconnectedCount = this.connectionManagerService.reconnectAllAutoConnectInstruments();

        console.log(`Auto-reconnecting ${reconnectedCount} instrument(s)`);

        if (reconnectedCount > 0) {
          // Show a notification that reconnection is happening
          const notification = document.createElement('div');
          notification.textContent = `Auto-reconnecting ${reconnectedCount} instrument(s)...`;
          notification.style.position = 'fixed';
          notification.style.top = '20px';
          notification.style.left = '50%';
          notification.style.transform = 'translateX(-50%)';
          notification.style.padding = '8px 16px';
          notification.style.backgroundColor = 'rgba(0,0,0,0.7)';
          notification.style.color = 'white';
          notification.style.borderRadius = '4px';
          notification.style.zIndex = '1000';
          document.body.appendChild(notification);

          setTimeout(() => {
            document.body.removeChild(notification);
          }, 3000);
        }
      }, 1000); // Wait 1 second after component initialization
    }
  }

  loadSettings() {
    const that = this;
    that.electronStoreSubscription = that.store.electronStoreObservable().subscribe(electronStoreObject => {
      that._ngZone.run(() => {
        that.commonSettings = electronStoreObject.commonConfig;
        that.instrumentsSettings = electronStoreObject.instrumentsConfig;
        that.appVersion = electronStoreObject.appVersion;
        that.cdRef.detectChanges();
      });
    });
  }

  reSyncSelectedRecords() {
    const that = this;
    that.selection.selected.forEach(selectedRow => {
      if (that.utilitiesService) {
        that.utilitiesService.reSyncRecord(selectedRow.order_id).subscribe({
          next: (response) => {
            selectedRow.lims_sync_status = '0';
            that.dataSource.data = [...that.dataSource.data];
            // Clear selection after re-sync
            that.selection.clear();
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

  fetchRecentResults(searchTerm?: string) {
    const that = this;

    that.resyncTestResultsToMySQL();
    that.utilitiesService.fetchRecentResults(searchTerm);

    that.utilitiesService.fetchLastSyncTimes((data: { lastLimsSync: string; lastResultReceived: string; }) => {
      that.lastLimsSync = data.lastLimsSync;
      that.lastResultReceived = data.lastResultReceived;
    });

    that.utilitiesService.lastOrders.subscribe({
      next: lastFewOrders => {
        that._ngZone.run(() => {
          that.lastOrders = lastFewOrders[0];
          that.data = lastFewOrders[0];
          that.dataSource.data = that.lastOrders;
          that.dataSource.paginator = that.paginator;
          that.dataSource.sort = that.sort;
        });
      },
      error: error => {
        console.error('Error fetching last orders:', error);
      }
    });
  }

  openModal() {
    this.ipc.send("openModal");
  }

  goToDashboard() {
    this.router.navigate(['/dashboard']);
  }

  filterData($event: any) {
    const searchTerm = $event.target.value;
    if (searchTerm.length >= 2) {
      this.fetchRecentResults(searchTerm);
    } else {
      this.fetchRecentResults('');
    }
  }

  updateLogsForInstrument(instrumentId: string, newLogs: any) {
    if (!this.instrumentLogs[instrumentId]) {
      this.instrumentLogs[instrumentId] = {
        logs: [],
        filteredLogs: []
      };
    }

    this.instrumentLogs[instrumentId].logs = newLogs;
    this.instrumentLogs[instrumentId].filteredLogs = newLogs;
  }

  fetchRecentLogs() {
    const that = this;
    that.availableInstruments.forEach(instrument => {
      let logs = that.utilitiesService.fetchRecentLogs(instrument.connectionParams.instrumentId);
      that.updateLogsForInstrument(instrument.connectionParams.instrumentId, logs);
    });

    that.cdRef.detectChanges(); // Trigger change detection
  }

  // Use connection manager service for connect/disconnect functions
  connect(instrument: any) {
    this.connectionManagerService.connect(instrument);
  }

  reconnect(instrument: any) {
    this.connectionManagerService.reconnect(instrument);
  }

  disconnect(instrument: any) {
    this.connectionManagerService.disconnect(instrument);
  }

  sendASTMOrders(instrument: any) {
    this.connectionManagerService.sendASTMOrders(instrument);
  }

  selectTab(index: number): void {
    this.selectedTabIndex = index;
    // Force status refresh when selecting a tab
    if (this.availableInstruments && this.availableInstruments.length > 0) {
      const instrument = this.availableInstruments[index];
      if (instrument) {
        this.syncConnectionStatus(instrument);
      }
    }
  }

  syncConnectionStatus(instrument: any) {
    //console.log(`Manually syncing status for ${instrument.connectionParams.instrumentId}`);
    this.connectionManagerService.refreshConnectionStatus(instrument);
  }

  filterInstrumentLogs(instrument: any) {
    const that = this;
    if (!that.instrumentLogs[instrument.connectionParams.instrumentId]) {
      // Initialize the logs structure for the instrument if not already done
      that.instrumentLogs[instrument.connectionParams.instrumentId] = {
        logs: [],
        filteredLogs: []
      };
    }

    if (!instrument.searchText || instrument.searchText === '') {
      // If search text is empty, show all logs
      that.instrumentLogs[instrument.connectionParams.instrumentId].filteredLogs = [...that.instrumentLogs[instrument.connectionParams.instrumentId].logs];
    } else {
      // Apply filter on the original logs
      that.instrumentLogs[instrument.connectionParams.instrumentId].filteredLogs = that.instrumentLogs[instrument.connectionParams.instrumentId].logs.filter((log: string) =>
        log.toLowerCase().includes(instrument.searchText.trim().toLowerCase())
      );
    }

    that.cdRef.detectChanges(); // Trigger change detection if needed
  }

  copyLog(instrument: { connectionParams: { instrumentId: string | number; }; }) {
    if (this.instrumentLogs[instrument.connectionParams.instrumentId]) {
      // Join the filtered logs with a newline character
      const logContent = this.instrumentLogs[instrument.connectionParams.instrumentId].filteredLogs.join('\n');
      this.copyTextToClipboard(logContent);
    } else {
      console.error('No logs found for instrument:', instrument.connectionParams.instrumentId);
    }
  }

  clearLiveLog(instrument: any) {
    const that = this;
    that.utilitiesService.clearLiveLog(instrument.connectionParams.instrumentId);
    // Clear logs and filtered logs for the specific instrument
    if (that.instrumentLogs[instrument.connectionParams.instrumentId]) {
      that.instrumentLogs[instrument.connectionParams.instrumentId].logs = [];
      that.instrumentLogs[instrument.connectionParams.instrumentId].filteredLogs = [];
    }

    that.cdRef.detectChanges(); // Trigger change detection if needed
  }

  resyncTestResultsToMySQL() {
    if (this.mysqlConnected) {
      this.utilitiesService.resyncTestResultsToMySQL(
        (message: any) => {
          console.log(message);
        },
        (error: any) => {
          console.error(error);
        }
      );
      this.utilitiesService.syncLimsStatusToSQLite(
        (message: any) => {
          console.log(message);
        },
        (error: any) => {
          console.error(error);
        }
      );
    }
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

  checkMysqlConnection() {
    const that = this;
    const commonSettings = that.store.get('commonConfig');
    const mysqlParams = {
      host: commonSettings.mysqlHost,
      user: commonSettings.mysqlUser,
      password: commonSettings.mysqlPassword,
      port: commonSettings.mysqlPort
    };

    that.utilitiesService.checkMysqlConnection(
      mysqlParams,
      () => {
        that.mysqlConnected = true;
        that.cdRef.detectChanges();
      },
      (err) => {
        that.mysqlConnected = false;
        that.cdRef.detectChanges();
      }
    );
  }

  runSQLiteWalCheckpoint(): void {
    const that = this;
    that.utilitiesService.sqlite3WalCheckpoint();
    that.utilitiesService.logger('info', 'SQLite WAL checkpoint scheduled and executed', null);
  }

  cancelConnection(instrument: any) {
    this.connectionManagerService.cancelConnection(instrument);
  }

  forceRestartConnection(instrument: any) {
    this.connectionManagerService.forceRestartConnection(instrument);
  }

  ngOnDestroy() {
    // Clear intervals
    [
      this.recentResultsInterval,
      this.mysqlCheckInterval,
      this.walCheckpointInterval,
      this.electronStoreSubscription,
      this.instrumentsSubscription
    ].forEach(item => {
      if (typeof item === 'number') {
        clearInterval(item);
      } else if (item && typeof item.unsubscribe === 'function') {
        item.unsubscribe();
      }
    });
  }
}
