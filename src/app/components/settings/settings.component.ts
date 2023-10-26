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
  public instrumentsSettings: any = {};
  public appPath: string = "";
  public appVersion: string = null;

  constructor(private electronService: ElectronService, private router: Router, private store: ElectronStoreService) {

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

      this.instrumentsSettings.analyzerMachineType = instrumentSettingsStore.analyzerMachineType;
      this.instrumentsSettings.analyzerMachineName = instrumentSettingsStore.analyzerMachineName;
      this.instrumentsSettings.analyzerMachinePort = instrumentSettingsStore.analyzerMachinePort;
      this.instrumentsSettings.analyzerMachineHost = instrumentSettingsStore.analyzerMachineHost;
      this.instrumentsSettings.interfaceConnectionMode = instrumentSettingsStore.interfaceConnectionMode;
      this.instrumentsSettings.interfaceAutoConnect = instrumentSettingsStore.interfaceAutoConnect;
      this.instrumentsSettings.interfaceCommunicationProtocol = instrumentSettingsStore.interfaceCommunicationProtocol;


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
      mysqlPassword: that.commonSettings.mysqlPassword
    };
    const instruments = {
      analyzerMachinePort: that.instrumentsSettings.analyzerMachinePort,
      analyzerMachineName: that.instrumentsSettings.analyzerMachineName,
      analyzerMachineType: that.instrumentsSettings.analyzerMachineType,
      analyzerMachineHost: that.instrumentsSettings.analyzerMachineHost,
      interfaceConnectionMode: that.instrumentsSettings.interfaceConnectionMode,
      interfaceAutoConnect: that.instrumentsSettings.interfaceAutoConnect,
      interfaceCommunicationProtocol: that.instrumentsSettings.interfaceCommunicationProtocol
    };

    that.store.set('instrumentsConfig', instruments);
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

    connection.connect(function (err) {

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
