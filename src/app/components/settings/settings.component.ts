import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ElectronService } from '../../core/services';
import { ElectronStoreService } from '../../services/electron-store.service';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
})
export class SettingsComponent implements OnInit {
  public commonSettings: any = {};
  public instrumentsSettings: any[] = [];
  public appPath: string = "";
  public appVersion: string = null;

  constructor(private electronService: ElectronService,
    private router: Router, private store: ElectronStoreService) {

    const commonSettingsStore = this.store.get('commonConfig');
    const instrumentSettingsStore = this.store.get('instrumentsConfig');
    this.appPath = this.store.get('appPath');
    this.appVersion = this.store.get('appVersion');

    if (undefined !== commonSettingsStore && undefined !== instrumentSettingsStore) {
      this.commonSettings.labID = commonSettingsStore.labID;
      this.commonSettings.labName = commonSettingsStore.labName;
      this.commonSettings.mysqlHost = commonSettingsStore.mysqlHost;
      this.commonSettings.mysqlPort = commonSettingsStore.mysqlPort;
      this.commonSettings.mysqlDb = commonSettingsStore.mysqlDb;
      this.commonSettings.mysqlUser = commonSettingsStore.mysqlUser;
      this.commonSettings.mysqlPassword = commonSettingsStore.mysqlPassword;
      this.commonSettings.interfaceAutoConnect = commonSettingsStore.interfaceAutoConnect;

      // this.instrumentsSettings[0].analyzerMachineType = instrumentSettingsStore.analyzerMachineType;
      // this.instrumentsSettings[0].analyzerMachineName = instrumentSettingsStore.analyzerMachineName;
      // this.instrumentsSettings[0].analyzerMachinePort = instrumentSettingsStore.analyzerMachinePort;
      // this.instrumentsSettings[0].analyzerMachineHost = instrumentSettingsStore.analyzerMachineHost;
      // this.instrumentsSettings[0].interfaceConnectionMode = instrumentSettingsStore.interfaceConnectionMode;
      // this.instrumentsSettings[0].interfaceCommunicationProtocol = instrumentSettingsStore.interfaceCommunicationProtocol;
      // Check if instrumentSettingsStore is an array and has at least one element
      if (Array.isArray(instrumentSettingsStore) && instrumentSettingsStore.length > 0) {
        this.instrumentsSettings = instrumentSettingsStore;
      } else if (instrumentSettingsStore && typeof instrumentSettingsStore === 'object') {
        // If instrumentSettingsStore is an object, wrap it in an array
        this.instrumentsSettings = [instrumentSettingsStore];
      }

    }

  }

  ngOnInit(): void {
  }

  updateSettings() {
    const that = this;

    const common = {
      labID: that.commonSettings.labID,
      labName: that.commonSettings.labName,
      mysqlHost: that.commonSettings.mysqlHost,
      mysqlPort: that.commonSettings.mysqlPort,
      mysqlDb: that.commonSettings.mysqlDb,
      mysqlUser: that.commonSettings.mysqlUser,
      mysqlPassword: that.commonSettings.mysqlPassword,
      interfaceAutoConnect: that.commonSettings.interfaceAutoConnect
    };

    // Assuming that instrumentsSettings is an array of instrument settings objects
    that.store.set('instrumentsConfig', that.instrumentsSettings);  // Store the entire array
    that.store.set('commonConfig', common);

    new Notification('Success', {
      body: 'Updated Interface Tool settings'
    });

    this.router.navigate(['/dashboard']);
  }


  checkMysqlConnection() {

    const that = this;
    const mysql = that.electronService.mysql;
    const connection = mysql.createConnection({
      host: that.commonSettings.mysqlHost,
      user: that.commonSettings.mysqlUser,
      password: that.commonSettings.mysqlPassword,
      port: that.commonSettings.mysqlPort
    });

    connection.connect(function (err: string) {

      if (err) {

        const dialogConfig = {
          type: 'error',
          message: 'Oops! Something went wrong! Unable to connect to the MySQL database on host ' + that.commonSettings.mysqlHost,
          detail: err + '\n\nPlease check if all the database connection settings are correct and the MySQL server is running.',
          buttons: ['OK']
        };
        that.electronService.openDialog('showMessageBox', dialogConfig);
      } else {
        const dialogConfig = {
          type: 'info',
          message: 'MySQL Connected successfully. Please click on SAVE SETTINGS to update these settings.',
          buttons: ['OK']
        };
        that.electronService.openDialog('showMessageBox', dialogConfig);
        connection.destroy();
      }

    });
  }

}
