import { Component, OnInit, NgZone, OnDestroy, ChangeDetectorRef, ViewChild } from '@angular/core';
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
import { SelectionModel } from "@angular/cdk/collections";
import { MatCheckboxChange } from '@angular/material/checkbox';
import { distinctUntilChanged } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';
import { IpcRenderer } from 'electron';
import { MatDialog } from '@angular/material/dialog';
import { DashboardComponent } from '../dashboard/dashboard.component';

export enum SelectType {
  single,
  multiple
}
@Component({
  selector: 'app-console',
  templateUrl: './console.component.html',
  styleUrls: ['./console.component.scss']
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
  public data: any;
  public lastOrders: any;
  private readonly ipc: IpcRenderer;
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
    private readonly dialog: MatDialog,
    private readonly cdRef: ChangeDetectorRef,
    private readonly sanitizer: DomSanitizer,
    private readonly store: ElectronStoreService,
    private readonly _ngZone: NgZone,
    private readonly instrumentInterfaceService: InstrumentInterfaceService,
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

  ngOnInit() {
    const that = this;
    that.loadSettings();
    that.checkMysqlConnection();

    // Scroll to the top of the page when the component initializes
    window.scrollTo(0, 0);

    // Fetch last few orders and logs on load
    setTimeout(() => {
      that.fetchRecentResults('');
      that.fetchRecentLogs();
    }, 600);

    // Check MySQL connection every 30 seconds (you can adjust this as needed)
    that.mysqlCheckInterval = setInterval(() => {
      that.checkMysqlConnection();
    }, 1000 * 5); // Every 5 seconds

    // Refresh last orders every 5 minutes
    that.recentResultsInterval = setInterval(() => { that.fetchRecentResults(''); }, 1000 * 60 * 5);

    // Refresh last orders every 5 minutes
    that.recentResultsInterval = setInterval(() => {
      that.fetchRecentResults('');
      that.resyncTestResultsToMySQL();
    }, 1000 * 60 * 5);
  }

  setupInstruments() {
    const that = this;
    that.availableInstruments = [];

    that.instrumentsSettings.forEach((instrumentSetting: { interfaceCommunicationProtocol: string; interfaceConnectionMode: any; analyzerMachineHost: any; analyzerMachinePort: any; analyzerMachineName: any; analyzerMachineType: any; displayorder: any; }, index: any) => {
      let instrument: any = {};
      if (instrumentSetting.interfaceCommunicationProtocol == 'astm-elecsys') {
        instrumentSetting.interfaceCommunicationProtocol = 'astm-nonchecksum';
      } else if (instrumentSetting.interfaceCommunicationProtocol == 'astm-concatenated') {
        instrumentSetting.interfaceCommunicationProtocol = 'astm-checksum';
      }
      instrument.connectionParams = {
        instrumentIndex: index,
        connectionMode: instrumentSetting.interfaceConnectionMode,
        connectionProtocol: instrumentSetting.interfaceCommunicationProtocol,
        host: instrumentSetting.analyzerMachineHost ?? '127.0.0.1',
        port: instrumentSetting.analyzerMachinePort,
        instrumentId: instrumentSetting.analyzerMachineName,
        machineType: instrumentSetting.analyzerMachineType,
        labName: that.commonSettings.labName,
        displayorder: instrumentSetting.displayorder,
        interfaceAutoConnect: that.commonSettings.interfaceAutoConnect
      };

      instrument.isConnected = false;
      const isTcpServer = instrument.connectionParams.connectionMode === 'tcpserver';
      instrument.instrumentButtonText = isTcpServer ? 'Start Server' : 'Connect';

      if (!that.commonSettings || !instrument.connectionParams.port || (instrument.connectionParams.connectionProtocol === 'tcpclient' && !instrument.connectionParams.host)) {
        that.router.navigate(['/settings']);
        return;
      }

      if (instrument.connectionParams.interfaceAutoConnect === 'yes') {
        setTimeout(() => {
          that.reconnect(instrument);
        }, 1000);
      }

      that.utilitiesService.getInstrumentLogSubject(instrument.connectionParams.instrumentId)
        .subscribe(logs => {
          that._ngZone.run(() => {
            that.updateLogsForInstrument(instrument.connectionParams.instrumentId, logs);
            that.filterInstrumentLogs(instrument);
            that.cdRef.detectChanges();
          });
        });

      that.availableInstruments.push(instrument);
    });

    that.availableInstruments.sort((a, b) => {
      // Sort by displayorder if available, otherwise by instrumentId
      if (a.connectionParams.displayorder != null && b.connectionParams.displayorder != null) {
        return a.connectionParams.displayorder - b.connectionParams.displayorder;
      } else if (a.connectionParams.displayorder == null && b.connectionParams.displayorder != null) {
        return 1;
      } else if (a.connectionParams.displayorder != null && b.connectionParams.displayorder == null) {
        return -1;
      } else {
        return a.connectionParams.instrumentId.localeCompare(b.connectionParams.instrumentId);
      }
    });

  }

  loadSettings() {
    const that = this;
    const initialSettings = that.store.getAll();

    if (!initialSettings.commonConfig || !initialSettings.instrumentsConfig) {
      const initialCommonSettings = that.store.get('commonConfig');
      const initialInstrumentsSettings = that.store.get('instrumentsConfig');

      if (!initialCommonSettings || !initialInstrumentsSettings) {
        console.warn('Settings not found, redirecting to settings page');
        that.router.navigate(['/settings']);
        return;
      }
    }

    that.electronStoreSubscription = that.store.electronStoreObservable().subscribe(electronStoreObject => {
      that._ngZone.run(() => {
        that.commonSettings = electronStoreObject.commonConfig;
        that.instrumentsSettings = electronStoreObject.instrumentsConfig;
        that.appVersion = electronStoreObject.appVersion;

        that.setupInstruments();
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
          //console.log(that.dataSource.data);
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
    console.log("Open a modal");
    this.ipc.send("openModal");
  }


  goToDashboard() {
    const that = this;
    let dataArray = [];
    if (that.data) {
      dataArray = that.data.map((item: { added_on: any; machine_used: any; order_id: any; lims_sync_status: any; lims_sync_date_time: any; }) => ({
        added_on: item.added_on,
        machine_used: item.machine_used,
        order_id: item.order_id,
        lims_sync_status: item.lims_sync_status,
        lims_sync_date_time: item.lims_sync_date_time
      }));
    }

    const dialogRef = that.dialog.open(DashboardComponent, {
      maxWidth: '90vw',
      maxHeight: '90vh',
      data: { dashboardData: dataArray }
    });

    dialogRef.afterClosed().subscribe(result => {

    });
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
      //instrument.logs = logs; // Initially, filteredLogs are the same as logs
      that.updateLogsForInstrument(instrument.connectionParams.instrumentId, logs);

    });

    that.cdRef.detectChanges(); // Trigger change detection
  }

  // connect(instrument: any) {
  //   const that = this;
  //   if (instrument && instrument.connectionParams && instrument.connectionParams.host && instrument.connectionParams.port) {
  //     that.instrumentInterfaceService.connect(instrument);
  //     that.updateInstrumentStatusSubscription(instrument);
  //   }
  // }



  connect(instrument: any) {
    const that = this;

    if (instrument && instrument.connectionParams && instrument.connectionParams.host && instrument.connectionParams.port) {
      // Generate a unique session ID
      const sessionId = uuidv4();
      const connectionMode = instrument.connectionParams.instrumentId;
      const startTime = that.getFormattedDateTime();

      // Get existing data from localStorage or initialize new data
      let storedData = JSON.parse(localStorage.getItem('sessionDatas') || '{}');

      // Initialize the connectionMode key if not already present
      if (!storedData[connectionMode]) {
        storedData[connectionMode] = [];
      }

      // Add new session data to the array
      storedData[connectionMode].push({
        sessionId,
        startTime
      });

      // Store updated data back to localStorage
      localStorage.setItem('sessionDatas', JSON.stringify(storedData));

      // Log or use the session ID and startTime as needed
      console.log(`Session ID for ${connectionMode}: ${sessionId}`);
      console.log(`Start Time for ${connectionMode}: ${startTime}`);

      // Connect to the instrument
      that.instrumentInterfaceService.connect(instrument);
      that.updateInstrumentStatusSubscription(instrument);
    }
  }

  // reconnect(instrument: any) {
  //   const that = this;
  //   if (instrument && instrument.connectionParams && instrument.connectionParams.host && instrument.connectionParams.port) {
  //     that.instrumentInterfaceService.reconnect(instrument);
  //     that.updateInstrumentStatusSubscription(instrument);
  //   }
  // }


  reconnect(instrument: any) {
    const that = this;

    if (instrument && instrument.connectionParams && instrument.connectionParams.host && instrument.connectionParams.port) {
      const connectionMode = instrument.connectionParams.instrumentId;

      // Retrieve existing session data from localStorage or initialize if not present
      let sessionData = JSON.parse(localStorage.getItem('sessionDatas') || '{}');

      if (!sessionData[connectionMode]) {
        // Generate a new session ID and start time if no data exists for this connectionMode
        sessionData[connectionMode] = {
          sessionId: uuidv4(),
          startTime: that.getFormattedDateTime()
        };
      } else {
        // Update the start time if session ID already exists
        sessionData[connectionMode].startTime = that.getFormattedDateTime();
      }

      // Save the updated session data back to localStorage
      localStorage.setItem('sessionDatas', JSON.stringify(sessionData));

      // Log session details
      console.log(`Session ID for ${connectionMode}: ${sessionData[connectionMode].sessionId}`);
      console.log(`Connection started at: ${sessionData[connectionMode].startTime}`);

      // Proceed with reconnection
      that.instrumentInterfaceService.reconnect(instrument);
      that.updateInstrumentStatusSubscription(instrument);
    }
  }

  // disconnect(instrument: any) {
  //   const that = this;
  //   if (instrument && instrument.connectionParams && instrument.connectionParams.host && instrument.connectionParams.port) {
  //     that.instrumentInterfaceService.disconnect(instrument);
  //     that.updateInstrumentStatusSubscription(instrument);
  //   }
  // }



  disconnect(instrument: any) {
    const that = this;

    if (instrument && instrument.connectionParams && instrument.connectionParams.host && instrument.connectionParams.port) {
      const connectionMode = instrument.connectionParams.instrumentId;

      // Retrieve the session data from localStorage
      const sessionData = JSON.parse(localStorage.getItem('sessionDatas') || '{}');

      if (sessionData[connectionMode]) {
        const sessionId = sessionData[connectionMode].sessionId;

        if (sessionId) {
          // Store the disconnection time in the session data
          const endTime = that.getFormattedDateTime();
          sessionData[connectionMode].endTime = endTime;

          // Save updated session data back to localStorage
          localStorage.setItem('sessionDatas', JSON.stringify(sessionData));

          // Log session details
          console.log(`Session ID for ${connectionMode}: ${sessionId}`);
          console.log(`Disconnection ended at: ${endTime}`);
        }
      }

      // Proceed with disconnection
      that.instrumentInterfaceService.disconnect(instrument);
      that.updateInstrumentStatusSubscription(instrument);
    }
  }


  getFormattedDateTime(): string {
    const now = new Date();
    const year = String(now.getFullYear()).padStart(4, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0'); // Add seconds
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`; // Include seconds in the return value
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
        that.cdRef.detectChanges();
      });
    });

    that.tcpService.getConnectionAttemptObservable(instrument.connectionParams)
      .subscribe(status => {
        that._ngZone.run(() => {
          // Update the availableInstruments array
          that.availableInstruments = that.availableInstruments.map(inst => {
            if (inst.connectionParams.instrumentId === instrument.connectionParams.instrumentId) {
              const isTcpServer = inst.connectionParams.connectionMode === 'tcpserver';
              const statusText = isTcpServer ? 'Wating for client..' : 'Please wait..';
              const defaultText = isTcpServer ? 'Start Server' : 'Connect';
              return {
                ...inst,
                connectionInProcess: status,
                instrumentButtonText: status ? statusText : defaultText
              };
            }
            return inst;
          });
          that.cdRef.detectChanges();
        });
      });

    that.tcpService.getTransmissionStatusObservable(instrument.connectionParams)
      .pipe(distinctUntilChanged())
      .subscribe(status => {
        that._ngZone.run(() => {
          // Update the availableInstruments array
          that.availableInstruments = that.availableInstruments.map(inst => {
            if (inst.connectionParams.instrumentId === instrument.connectionParams.instrumentId) {
              return {
                ...inst,
                transmissionInProgress: status
              };
            }
            return inst;
          });
          that.cdRef.detectChanges();
        });
      });
  }

  selectTab(index: number): void {
    this.selectedTabIndex = index;
  }

  filterInstrumentLogs(instrument: any) {
    const that = this;
    if (!that.instrumentLogs[instrument.connectionParams.instrumentId]) {
      // Initialize the logs structure for the instrument if not already done
      that.instrumentLogs[instrument.connectionParams.instrumentId] = {
        logs: [...instrument.logs],
        filteredLogs: [...instrument.logs]
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
    this.utilitiesService.clearLiveLog(instrument.connectionParams.instrumentId);
    // Clear logs and filtered logs for the specific instrument
    if (this.instrumentLogs[instrument.connectionParams.instrumentId]) {
      this.instrumentLogs[instrument.connectionParams.instrumentId].logs = [];
      this.instrumentLogs[instrument.connectionParams.instrumentId].filteredLogs = [];
    }

    this.cdRef.detectChanges(); // Trigger change detection if needed
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
        // console.error(that.mysqlConnected);
        // console.log('MySQL is connected');
      },
      (err) => {
        that.mysqlConnected = false;
        that.cdRef.detectChanges();
        // console.error(that.mysqlConnected);
        // console.error('MySQL connection lost:', err);
      }
    );
  }

  ngOnDestroy() {
    if (this.recentResultsInterval) {
      clearInterval(this.recentResultsInterval);  // Clear the recent results interval
    }
    if (this.mysqlCheckInterval) {
      clearInterval(this.mysqlCheckInterval);  // Clear the MySQL check interval
    }
    if (this.electronStoreSubscription) {
      this.electronStoreSubscription.unsubscribe(); // Unsubscribe to avoid memory leaks
    }
  }

}
