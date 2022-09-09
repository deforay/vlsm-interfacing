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

    const appSettings = {
      labID: this.settings.labID,
      labName: this.settings.labName,
      analyzerMachinePort: this.settings.analyzerMachinePort,
      analyzerMachineName: this.settings.analyzerMachineName,
      analyzerMachineHost: this.settings.analyzerMachineHost,
      interfaceConnectionMode: this.settings.interfaceConnectionMode,
      interfaceCommunicationProtocol: this.settings.interfaceCommunicationProtocol,
      mysqlHost: this.settings.mysqlHost,
      mysqlPort: this.settings.mysqlPort,
      mysqlDb: this.settings.mysqlDb,
      mysqlUser: this.settings.mysqlUser,
      mysqlPassword: this.settings.mysqlPassword
    };

    this.store.set('appSettings', appSettings);

    new Notification('Success', {
      body: 'Updated VLSM interfacing settings'
    });

    this.router.navigate(['/dashboard']);

  }

  checkMysqlConnection() {

    const that = this;
    const mysql = that.electronService.mysql;
    const connection = mysql.createConnection({
      host: this.settings.mysqlHost,
      user: this.settings.mysqlUser,
      password: this.settings.mysqlPassword,
      port: this.settings.mysqlPort
    });

    connection.connect(function (err) {

      if (err) {

        const dialogConfig = {
          type: 'error',
          message: 'Oops! Something went wrong! Unable to connect to the MySQL database.',
          detail: err + '\n\nPlease check if all the database connection settings are correct and the MySQL server is running.',
          buttons: ['OK']
        };
        that.electronService.openDialog('showMessageBox', dialogConfig);
        return;
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
