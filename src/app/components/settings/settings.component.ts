import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
})

export class SettingsComponent implements OnInit {

  public settings: any = {};


  constructor(private router: Router) {


    const Store = require('electron-store');

    const store = new Store();

    let appSettings = store.get('appSettings');
    let mysql = require('mysql');

    if (undefined != appSettings) {
      this.settings.labID = appSettings.labID;
      this.settings.labName = appSettings.labName;

      this.settings.rocheMachine = appSettings.rocheMachine;
      this.settings.rochePort = appSettings.rochePort;
      this.settings.rocheHost = appSettings.rocheHost;
      this.settings.rocheConnectionType = appSettings.rocheConnectionType;
      this.settings.rocheProtocol = appSettings.rocheProtocol;

      this.settings.mysqlHost = appSettings.mysqlHost;
      this.settings.mysqlPort = appSettings.mysqlPort;
      this.settings.mysqlDb = appSettings.mysqlDb;
      this.settings.mysqlUser = appSettings.mysqlUser;
      this.settings.mysqlPassword = appSettings.mysqlPassword;
    }

    // console.log("====================");
    // console.log(this.settings.mysqlDb);
    // console.log("====================");



  }

  ngOnInit() {
  }

  updateSettings() {

    let appSettings = {
      labID: this.settings.labID,
      labName: this.settings.labName,
      rochePort: this.settings.rochePort,
      rocheMachine: this.settings.rocheMachine,
      rocheHost: this.settings.rocheHost,
      rocheConnectionType: this.settings.rocheConnectionType,
      rocheProtocol: this.settings.rocheProtocol,
      mysqlHost: this.settings.mysqlHost,
      mysqlPort: this.settings.mysqlPort,
      mysqlDb: this.settings.mysqlDb,
      mysqlUser: this.settings.mysqlUser,
      mysqlPassword: this.settings.mysqlPassword,
    }
    const Store = require('electron-store');
    const store = new Store();

    store.set('appSettings', appSettings);

    let myNotification = new Notification('Success', {
      body: 'Updated VLSM interfacing settings'
    })

    this.router.navigate(['/dashboard']);


  }

  checkMysqlConnection() {

    let mysql = require('mysql');
    let connection = mysql.createConnection({
      host: this.settings.mysqlHost,
      user: this.settings.mysqlUser,
      password: this.settings.mysqlPassword,
      port: this.settings.mysqlPort
    });

    connection.connect(function (err) {

      if (err) {
        const { dialog } = require('electron').remote;
        dialog.showErrorBox('Oops! Something went wrong!', 'Unable to connect. Check if all the database connection settings are correct.');
        return;
      } else {
        const { dialog } = require('electron').remote;
        dialog.showMessageBox({
          message: "MySQL Connected successfully. Please click on SAVE SETTINGS to update these settings.",
          buttons: ["OK"]
        });
      }

    });
  }

}
