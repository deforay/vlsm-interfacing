// src/app/services/connection-manager.service.ts
import { Injectable, OnDestroy } from '@angular/core';
import { InstrumentInterfaceService } from './instrument-interface.service';
import { ElectronStoreService } from './electron-store.service';
import { TcpConnectionService } from './tcp-connection.service';
import { BehaviorSubject, Observable } from 'rxjs';
import { ConnectionParams } from '../interfaces/connection-params.interface';
import { InstrumentConnectionStack } from '../interfaces/intrument-connections.interface';

@Injectable({
  providedIn: 'root'
})
export class ConnectionManagerService implements OnDestroy {
  // Store the instruments and their connection status
  private activeInstruments: Map<string, any> = new Map();
  private commonSettings: any = null;
  private instrumentsSettings: any = null;
  private activeInstrumentsSubject = new BehaviorSubject<any[]>([]);

  constructor(
    private instrumentInterfaceService: InstrumentInterfaceService,
    private tcpService: TcpConnectionService,
    private store: ElectronStoreService
  ) {
    // Load the settings initially
    this.loadSettings();

    // Subscribe to store changes to update instruments if settings change
    this.store.electronStoreObservable().subscribe(electronStoreObject => {
      this.commonSettings = electronStoreObject.commonConfig;
      this.instrumentsSettings = electronStoreObject.instrumentsConfig;
      this.updateInstrumentsList();
    });
  }

  private loadSettings() {
    const initialSettings = this.store.getAll();

    if (!initialSettings.commonConfig || !initialSettings.instrumentsConfig) {
      const initialCommonSettings = this.store.get('commonConfig');
      const initialInstrumentsSettings = this.store.get('instrumentsConfig');

      if (!initialCommonSettings || !initialInstrumentsSettings) {
        console.warn('Settings not found');
        return;
      }
    }

    this.commonSettings = initialSettings.commonConfig;
    this.instrumentsSettings = initialSettings.instrumentsConfig;
    this.updateInstrumentsList();
  }

  private updateInstrumentsList() {
    if (!this.instrumentsSettings) return;

    // Create or update instrument configurations
    this.instrumentsSettings.forEach((instrumentSetting: any, index: number) => {
      let instrumentId = instrumentSetting.analyzerMachineName;

      // Standardize protocol names
      let protocol = instrumentSetting.interfaceCommunicationProtocol;
      if (protocol == 'astm-elecsys') {
        protocol = 'astm-nonchecksum';
      } else if (protocol == 'astm-concatenated') {
        protocol = 'astm-checksum';
      }

      // Create connection parameters
      const connectionParams: ConnectionParams = {
        instrumentIndex: index,
        connectionMode: instrumentSetting.interfaceConnectionMode,
        connectionProtocol: protocol,
        host: instrumentSetting.analyzerMachineHost ?? '127.0.0.1',
        port: instrumentSetting.analyzerMachinePort,
        instrumentId: instrumentId,
        machineType: instrumentSetting.analyzerMachineType,
        labName: this.commonSettings.labName,
        displayorder: instrumentSetting.displayorder,
        interfaceAutoConnect: this.commonSettings.interfaceAutoConnect
      };

      // Check if instrument already exists in our active list
      let instrument = this.activeInstruments.get(instrumentId);

      if (!instrument) {
        // Create a new instrument object
        instrument = {
          connectionParams: connectionParams,
          isConnected: false,
          connectionInProcess: false,
          instrumentButtonText: connectionParams.connectionMode === 'tcpserver' ? 'Start Server' : 'Connect'
        };

        this.activeInstruments.set(instrumentId, instrument);

        // If auto-connect is enabled, connect after a short delay
        if (connectionParams.interfaceAutoConnect === 'yes') {
          setTimeout(() => {
            this.reconnect(instrument);
          }, 1000);
        }
      } else {
        // Update existing instrument's connection parameters
        instrument.connectionParams = connectionParams;
      }
    });

    // Update the behavior subject with the current list of instruments
    this.notifyInstrumentsChanged();
  }

  private notifyInstrumentsChanged() {
    // Convert Map to Array for the BehaviorSubject
    const instrumentsArray = Array.from(this.activeInstruments.values());

    // Sort instruments by display order or name
    instrumentsArray.sort((a, b) => {
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

    this.activeInstrumentsSubject.next(instrumentsArray);
  }

  getActiveInstruments(): Observable<any[]> {
    return this.activeInstrumentsSubject.asObservable();
  }

  connect(instrument: any) {
    if (!instrument || !instrument.connectionParams) return;

    // Generate a unique session ID
    const sessionId = this.generateUuid();
    const connectionMode = instrument.connectionParams.instrumentId;
    const startTime = this.getFormattedDateTime();

    // Store session data
    let storedData = JSON.parse(localStorage.getItem('sessionDatas') || '{}');
    if (!storedData[connectionMode]) {
      storedData[connectionMode] = [];
    }
    storedData[connectionMode].push({
      sessionId,
      startTime
    });
    localStorage.setItem('sessionDatas', JSON.stringify(storedData));

    // Connect to the instrument
    this.instrumentInterfaceService.connect(instrument);
    this.updateInstrumentStatusSubscription(instrument);
  }

  reconnect(instrument: any) {
    if (!instrument || !instrument.connectionParams) return;

    const connectionMode = instrument.connectionParams.instrumentId;

    // Update session data
    let sessionData = JSON.parse(localStorage.getItem('sessionDatas') || '{}');
    if (!sessionData[connectionMode]) {
      sessionData[connectionMode] = {
        sessionId: this.generateUuid(),
        startTime: this.getFormattedDateTime()
      };
    } else {
      sessionData[connectionMode].startTime = this.getFormattedDateTime();
    }
    localStorage.setItem('sessionDatas', JSON.stringify(sessionData));

    // Reconnect the instrument
    this.instrumentInterfaceService.reconnect(instrument);
    this.updateInstrumentStatusSubscription(instrument);
  }

  disconnect(instrument: any) {
    if (!instrument || !instrument.connectionParams) return;

    const connectionMode = instrument.connectionParams.instrumentId;

    // Update session data with disconnect time
    const sessionData = JSON.parse(localStorage.getItem('sessionDatas') || '{}');
    if (sessionData[connectionMode]) {
      sessionData[connectionMode].endTime = this.getFormattedDateTime();
      localStorage.setItem('sessionDatas', JSON.stringify(sessionData));
    }

    // Disconnect the instrument
    this.instrumentInterfaceService.disconnect(instrument);
  }

  sendASTMOrders(instrument: any) {
    if (!instrument || !instrument.connectionParams) return;
    this.instrumentInterfaceService.fetchAndSendASTMOrders(instrument);
  }

  private updateInstrumentStatusSubscription(instrument: any) {
    // Subscribe to connection status changes
    this.tcpService.getStatusObservable(instrument.connectionParams)
      .subscribe(status => {
        // Update the instrument's connection status
        const instrumentFromMap = this.activeInstruments.get(instrument.connectionParams.instrumentId);
        if (instrumentFromMap) {
          instrumentFromMap.isConnected = status;
          this.notifyInstrumentsChanged();
        }
      });

    // Subscribe to connection attempt status
    this.tcpService.getConnectionAttemptObservable(instrument.connectionParams)
      .subscribe(status => {
        const instrumentFromMap = this.activeInstruments.get(instrument.connectionParams.instrumentId);
        if (instrumentFromMap) {
          const isTcpServer = instrumentFromMap.connectionParams.connectionMode === 'tcpserver';
          const statusText = isTcpServer ? 'Waiting for client..' : 'Please wait..';
          const defaultText = isTcpServer ? 'Start Server' : 'Connect';

          instrumentFromMap.connectionInProcess = status;
          instrumentFromMap.instrumentButtonText = status ? statusText : defaultText;
          this.notifyInstrumentsChanged();
        }
      });

    // Subscribe to transmission status
    this.tcpService.getTransmissionStatusObservable(instrument.connectionParams)
      .subscribe(status => {
        const instrumentFromMap = this.activeInstruments.get(instrument.connectionParams.instrumentId);
        if (instrumentFromMap) {
          instrumentFromMap.transmissionInProgress = status;
          this.notifyInstrumentsChanged();
        }
      });
  }

  private generateUuid(): string {
    // Simple UUID generator
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  private getFormattedDateTime(): string {
    const now = new Date();
    const year = String(now.getFullYear()).padStart(4, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  ngOnDestroy() {
    // Clean up any resources if needed
  }
}
