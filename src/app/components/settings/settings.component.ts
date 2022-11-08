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
  public settings: any = {};
  public appPath: string = "";

  constructor(private electronService: ElectronService, private router: Router, private store: ElectronStoreService) {

    const appSettings = this.store.get('appSettings');
    this.appPath = this.store.get('appPath');

    if (undefined !== appSettings) {
      this.settings.labID = appSettings.labID;
      this.settings.labName = appSettings.labName;

      this.settings.analyzerMachineName = appSettings.analyzerMachineName;
      this.settings.analyzerMachinePort = appSettings.analyzerMachinePort;
      this.settings.analyzerMachineHost = appSettings.analyzerMachineHost;
      this.settings.interfaceConnectionMode = appSettings.interfaceConnectionMode;
      this.settings.interfaceAutoConnect = appSettings.interfaceAutoConnect;
      this.settings.interfaceCommunicationProtocol = appSettings.interfaceCommunicationProtocol;

      this.settings.mysqlHost = appSettings.mysqlHost;
      this.settings.mysqlPort = appSettings.mysqlPort;
      this.settings.mysqlDb = appSettings.mysqlDb;
      this.settings.mysqlUser = appSettings.mysqlUser;
      this.settings.mysqlPassword = appSettings.mysqlPassword;
    }

  }

  ngOnInit(): void {
  }

  updateSettings() {

    const that = this;

    const appSettings = {
      labID: that.settings.labID,
      labName: that.settings.labName,
      analyzerMachinePort: that.settings.analyzerMachinePort,
      analyzerMachineName: that.settings.analyzerMachineName,
      analyzerMachineHost: that.settings.analyzerMachineHost,
      interfaceConnectionMode: that.settings.interfaceConnectionMode,
      interfaceAutoConnect: that.settings.interfaceAutoConnect,
      interfaceCommunicationProtocol: that.settings.interfaceCommunicationProtocol,
      mysqlHost: that.settings.mysqlHost,
      mysqlPort: that.settings.mysqlPort,
      mysqlDb: that.settings.mysqlDb,
      mysqlUser: that.settings.mysqlUser,
      mysqlPassword: that.settings.mysqlPassword
    };

    that.store.set('appSettings', appSettings);

    new Notification('Success', {
      body: 'Updated VLSM interfacing settings'
    });

    this.router.navigate(['/dashboard']);

  }

  checkMysqlConnection() {

    const that = this;
    const mysql = that.electronService.mysql;
    const connection = mysql.createConnection({
      host: that.settings.mysqlHost,
      user: that.settings.mysqlUser,
      password: that.settings.mysqlPassword,
      port: that.settings.mysqlPort
    });

    connection.connect(function (err) {

      if (err) {

        const dialogConfig = {
          type: 'error',
          message: 'Oops! Something went wrong! Unable to connect to the MySQL database on host ' + that.settings.mysqlHost,
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
