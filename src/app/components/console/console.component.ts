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
import { MatSnackBar } from '@angular/material/snack-bar';
import { ChangeDetectionStrategy } from '@angular/core';
import { debounceTime, distinctUntilChanged, shareReplay, map, filter } from 'rxjs/operators';
import { LogDisplayService, LogEntry } from '../../services/log-display.service';

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
  private pickedInitialTab = false; // run-once guard
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
  public instrumentLogs: { [instrumentId: string]: { logs: any[]; filteredLogs: any[] } } = {};
  public connectionParams: ConnectionParams = null;
  public selectedTabIndex = 0;
  private electronStoreSubscription: Subscription;
  private instrumentsSubscription: Subscription;
  private resultSavedSubscription: Subscription;
  private logSubscription: Subscription;
  private logClearSubscription: Subscription;

  private checkConnectionsAfterInactivity() {
    console.log('Checking connection status after inactivity');

    // Check each instrument
    this.availableInstruments.forEach(instrument => {
      this.availableInstruments.forEach(instrument => {
        if (instrument.isConnected) {
          // Verify the connection - this will check socket state and update status
          const isActuallyConnected = this.tcpService.verifyConnection(instrument.connectionParams);

          // Update your instrument's connected state if needed
          if (!isActuallyConnected) {
            instrument.isConnected = false;
          }
        }
      });
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
    private readonly logDisplayService: LogDisplayService,
    private readonly snackBar: MatSnackBar,
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

          // pick first connected tab once (or first item if none connected)
          if (!that.pickedInitialTab && that.availableInstruments?.length) {
            const idx = that.availableInstruments.findIndex(i => i?.isConnected === true);
            if (idx >= 0) {
              that.selectTab(idx);
              that.pickedInitialTab = true;
            } else if (that.selectedTabIndex >= that.availableInstruments.length) {
              // still ensure a valid tab if array changed
              that.selectTab(0);
            }
          }


          // Check if we should auto-reconnect instruments
          that.checkForAutoReconnect();

          // We don't need to subscribe to logs here anymore,
          // it's handled by the global logSubscription
          that.fetchRecentLogs();
          that.cdRef.detectChanges();
        });
      });

    // Fetch last few orders on load
    setTimeout(() => {
      that.fetchRecentResults();
    }, 600);

    // Refresh recent results when new samples are saved
    that.resultSavedSubscription = that.instrumentInterfaceService.resultSaved$
      .pipe(debounceTime(250))
      .subscribe(() => {
        that._ngZone.run(() => {
          that.refreshRecentResultsAfterSave();
        });
      });

    // Check MySQL connection on regular intervals
    that.mysqlCheckInterval = setInterval(() => {
      that.checkMysqlConnection();
    }, 1000 * 7);

    // Refresh last orders every 5 minutes
    that.recentResultsInterval = setInterval(() => {
      that.fetchRecentResults();
      that.resyncTestResultsToMySQL();
    }, 1000 * 60 * 1);

    // SQLite WAL checkpoint every 30 minutes
    that.walCheckpointInterval = setInterval(() => {
      that.runSQLiteWalCheckpoint();
    }, 1000 * 60 * 30); // 30 minutes

    // Subscribe to logs from the display service
    that.logSubscription = that.logDisplayService.log$.subscribe(logEntry => {
      that._ngZone.run(() => {
        that.updateLogUI(logEntry);
      });
    });

    // Subscribe to clear events
    that.logClearSubscription = that.logDisplayService.clear$.subscribe(instrumentId => {
      that._ngZone.run(() => {
        if (instrumentId) {
          // Clear logs for a specific instrument
          if (that.instrumentLogs[instrumentId]) {
            that.instrumentLogs[instrumentId].logs = [];
            that.instrumentLogs[instrumentId].filteredLogs = [];
          }
        } else {
          // Clear all logs if no ID is specified
          Object.keys(that.instrumentLogs).forEach(id => {
            that.instrumentLogs[id].logs = [];
            that.instrumentLogs[id].filteredLogs = [];
          });
        }
        that.cdRef.detectChanges();
      });
    });
  }

  private updateLogUI(logEntry: LogEntry) {
    const instrumentId = logEntry.instrumentId;
    if (!instrumentId) return;

    // Ensure the log structure exists
    this.instrumentLogs[instrumentId] ??= { logs: [], filteredLogs: [] };

    // Add the new log and re-sort
    this.instrumentLogs[instrumentId].logs.push(logEntry);
    this.instrumentLogs[instrumentId].logs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());


    // Re-filter logs
    this.filterInstrumentLogs({ connectionParams: { instrumentId } });

    // Limit the number of logs to prevent memory issues
    const MAX_LOG_ENTRIES = 5000;
    if (this.instrumentLogs[instrumentId].logs.length > MAX_LOG_ENTRIES) {
      this.instrumentLogs[instrumentId].logs.length = MAX_LOG_ENTRIES;
    }
    if (this.instrumentLogs[instrumentId].filteredLogs.length > MAX_LOG_ENTRIES) {
      this.instrumentLogs[instrumentId].filteredLogs.length = MAX_LOG_ENTRIES;
    }

    this.cdRef.detectChanges();
  }

  private refreshRecentResultsAfterSave(): void {
    const trimmedSearch = (this.searchTerm || '').trim();

    const effectiveSearch = trimmedSearch.length >= 2 ? trimmedSearch : '';
    this.utilitiesService.fetchRecentResults(effectiveSearch).subscribe({
      next: (results) => {
        this._ngZone.run(() => {
          this.lastOrders = results;
          this.dataSource.data = this.lastOrders;
          this.cdRef.detectChanges();
        });
      },
      error: (err) => console.error('Error refreshing results after save:', err)
    });

    this.utilitiesService.fetchLastSyncTimes().subscribe({
      next: (data) => {
        this._ngZone.run(() => {
          this.lastLimsSync = this.utilitiesService.humanReadableDateTime(data.lastLimsSync);
          this.lastResultReceived = this.utilitiesService.humanReadableDateTime(data.lastResultReceived);
          this.cdRef.detectChanges();
        });
      },
      error: (err) => console.error('Error fetching last sync times:', err)
    });
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
          next: () => {
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
    const trimmedTerm = (searchTerm || '').trim();

    // Only sync when NOT searching (i.e., when getting all results)
    if (trimmedTerm === '') {
      console.log('Fetching all results with sync');
      that.resyncTestResultsToMySQL();
    } else {
      console.log('Fetching search results without sync');
    }

    that.utilitiesService.fetchRecentResults(trimmedTerm).subscribe({
      next: lastFewOrders => {
        that._ngZone.run(() => {
          that.lastOrders = lastFewOrders;
          that.data = lastFewOrders;
          that.dataSource.data = that.lastOrders;
          that.dataSource.paginator = that.paginator;
          that.dataSource.sort = that.sort;

          that.sort.active = 'added_on';
          that.sort.direction = 'desc';
          that.sort.sortChange.emit({ active: that.sort.active, direction: that.sort.direction });

          that.cdRef.detectChanges();
        });
      },
      error: error => {
        console.error('Error fetching last orders:', error);
      }
    });

    that.utilitiesService.fetchLastSyncTimes().subscribe({
      next: (data) => {
        that.lastLimsSync = that.utilitiesService.humanReadableDateTime(data.lastLimsSync);
        that.lastResultReceived = that.utilitiesService.humanReadableDateTime(data.lastResultReceived);
      },
      error: (err) => console.error('Error fetching last sync times:', err)
    });
  }

  clearSearch() {
    console.log('Clearing search');
    this.searchTerm = '';
    if (this.searchInput && this.searchInput.nativeElement) {
      this.searchInput.nativeElement.value = '';
    }
    // Get all results without syncing (since it's just clearing search)
    this.searchResults('');
  }

  openModal() {
    this.ipc.send("openModal");
  }

  goToDashboard() {
    this.router.navigate(['/dashboard']);
  }

  /**
   * Search method - ONLY searches, no syncing
   */
  searchResults(searchTerm: string) {
    const that = this;
    const trimmedTerm = (searchTerm || '').trim();

    console.log('Searching with trimmed term:', `"${trimmedTerm}"`);

    // Pass the trimmed term to the service
    that.utilitiesService.fetchRecentResults(trimmedTerm).subscribe({
      next: (results) => {
        that._ngZone.run(() => {
          that.lastOrders = results;
          that.data = results;
          that.dataSource.data = that.lastOrders;
          that.dataSource.paginator = that.paginator;
          that.dataSource.sort = that.sort;

          that.sort.active = 'added_on';
          that.sort.direction = 'desc';
          that.sort.sortChange.emit({ active: that.sort.active, direction: that.sort.direction });

          that.cdRef.detectChanges();

          console.log(`Search completed: ${that.lastOrders?.length || 0} results for "${trimmedTerm}"`);
        });
      },
      error: (error) => console.error('Error fetching search results:', error)
    });
  }

  /**
   * Refresh method - Syncs AND fetches all results
   */
  refreshResults() {
    const that = this;
    console.log('Refreshing all results with sync');

    // Do the sync first, then fetch all results
    that.resyncTestResultsToMySQL();
    that.utilitiesService.fetchRecentResults('').subscribe({
      next: (results) => {
        that._ngZone.run(() => {
          that.lastOrders = results;
          that.data = results;
          that.dataSource.data = that.lastOrders;
          that.dataSource.paginator = that.paginator;
          that.dataSource.sort = that.sort;

          that.sort.active = 'added_on';
          that.sort.direction = 'desc';
          that.sort.sortChange.emit({ active: that.sort.active, direction: that.sort.direction });

          that.cdRef.detectChanges();
        });
      },
      error: (error) => console.error('Error fetching refreshed results:', error)
    });

    that.utilitiesService.fetchLastSyncTimes().subscribe({
      next: (data) => {
        that.lastLimsSync = that.utilitiesService.humanReadableDateTime(data.lastLimsSync);
        that.lastResultReceived = that.utilitiesService.humanReadableDateTime(data.lastResultReceived);
      },
      error: (err) => console.error('Error fetching last sync times:', err)
    });
  }

  filterData($event: any) {
    const rawSearchTerm = $event.target.value || '';
    const trimmedSearchTerm = rawSearchTerm.trim();

    // Update the model with trimmed value for consistency
    this.searchTerm = trimmedSearchTerm;

    console.log('Search input:', {
      raw: `"${rawSearchTerm}"`,
      trimmed: `"${trimmedSearchTerm}"`,
      length: trimmedSearchTerm.length
    });

    if (trimmedSearchTerm === '') {
      // Empty or whitespace-only search - get all results WITHOUT syncing
      console.log('Empty search - fetching all results without sync');
      this.searchResults('');
    } else if (trimmedSearchTerm.length >= 2) {
      // Valid search term - perform search
      console.log('Valid search term - performing search');
      this.searchResults(trimmedSearchTerm);
    } else {
      // Single character - don't search (avoid too many requests)
      console.log('Search term too short - ignoring');
      // Optionally clear results or keep current results
      // this.dataSource.data = []; // Uncomment if you want to clear on single char
    }
  }

  updateLogsForInstrument(instrumentId: string, newLogs: LogEntry[]) {
    this.instrumentLogs[instrumentId] ??= {
      logs: [],
      filteredLogs: []
    };

    // Sort logs by timestamp descending (newest first)
    newLogs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    this.instrumentLogs[instrumentId].logs = newLogs;
    this.filterInstrumentLogs({ connectionParams: { instrumentId } });
  }

  fetchRecentLogs() {
    const that = this;
    that.availableInstruments.forEach(instrument => {
      that.utilitiesService.fetchRecentLogs(instrument.connectionParams.instrumentId)
        .subscribe(logs => {
          that._ngZone.run(() => {
            that.updateLogsForInstrument(instrument.connectionParams.instrumentId, logs);
          });
        });
    });
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
      that.instrumentLogs[instrument.connectionParams.instrumentId].filteredLogs = that.instrumentLogs[instrument.connectionParams.instrumentId].logs.filter((log: LogEntry) =>
        log.message.toLowerCase().includes(instrument.searchText.trim().toLowerCase())
      );
    }

    that.cdRef.detectChanges(); // Trigger change detection if needed
  }

  copyLog(instrument: { connectionParams: { instrumentId: string | number; }; }) {
    if (this.instrumentLogs[instrument.connectionParams.instrumentId]) {
      // Join the filtered logs with a newline character, stripping any HTML markup
      const logContent = this.instrumentLogs[instrument.connectionParams.instrumentId].filteredLogs
        .map(l => this.extractPlainText(l.message))
        .join('\n');
      this.copyTextToClipboard(logContent);
    } else {
      console.error('No logs found for instrument:', instrument.connectionParams.instrumentId);
    }
  }

  clearLiveLog(instrument: any) {
    const instrumentId = instrument.connectionParams.instrumentId;
    // This will trigger the subscription to clear the UI
    this.logDisplayService.clearLogs(instrumentId);
    this._ngZone.run(() => {
      this.snackBar.open('Logs cleared', undefined, {
        duration: 3000,
        horizontalPosition: 'end',
        verticalPosition: 'bottom'
      });
    });
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
      this._ngZone.run(() => {
        this.snackBar.open('Logs copied to clipboard', undefined, {
          duration: 3000,
          horizontalPosition: 'end',
          verticalPosition: 'bottom'
        });
      });
    }, (err) => {
      console.error('Error in copying text: ', err);
      this._ngZone.run(() => {
        this.snackBar.open('Failed to copy logs', undefined, {
          duration: 3000,
          horizontalPosition: 'end',
          verticalPosition: 'bottom'
        });
      });
    });
  }

  getSafeHtml(logEntry: LogEntry) {
    return this.sanitizer.bypassSecurityTrustHtml(logEntry.message);
  }

  private extractPlainText(message: string): string {
    if (!message) {
      return '';
    }
    const tempElement = document.createElement('div');
    tempElement.innerHTML = message;
    return tempElement.textContent ?? tempElement.innerText ?? '';
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
      this.walCheckpointInterval
    ].forEach(interval => {
      if (interval) {
        clearInterval(interval);
      }
    });

    // Unsubscribe from all subscriptions
    [
      this.electronStoreSubscription,
      this.instrumentsSubscription,
      this.resultSavedSubscription,
      this.logSubscription,
      this.logClearSubscription
    ].forEach(subscription => {
      if (subscription) {
        subscription.unsubscribe();
      }
    });
  }
}
