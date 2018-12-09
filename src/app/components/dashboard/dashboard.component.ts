import { Component, OnInit, NgZone } from '@angular/core';
import { CobasService } from '../../services/cobas.service';
import { Router } from '../../../../node_modules/@angular/router';


@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {

  public isConnected: boolean = false;
  public stopTrying: boolean = false;
  public connectionInProcess: boolean = false;
  public reconnectButtonText: string = 'Connect';

  constructor(public cobasService: CobasService, private _ngZone: NgZone, private router: Router) {

    const Store = require('electron-store');
    const store = new Store();

    let appSettings = store.get('appSettings');
    if (undefined == appSettings || !appSettings.rochePort || !appSettings.rocheHost) {
      this.router.navigate(['/settings']);
    }
    //this.cobasService.connect();


  }

  ngOnInit() {
    let that = this;
    that.cobasService.currentStatus.subscribe(status => {
      that._ngZone.run(() => {
        console.log(status);
        that.isConnected = status;
      });
    })
    that.cobasService.stopTrying.subscribe(status => {
      that._ngZone.run(() => {
        //console.log(status);
        that.stopTrying = status;
        if (that.stopTrying) {
          const { dialog } = require('electron').remote;
          dialog.showErrorBox('Oops! Something went wrong!', 'Unable to connect. Check if all the Roche machine connection settings are correct.');
          that.close();
        }
      });
    })

  }

  reconnect() {

    this.connectionInProcess = true;
    this.reconnectButtonText = 'Please wait ... ';
    this.cobasService.reconnect();
    //this.cobasService.connect();

  }

  close() {
    this.connectionInProcess = false;
    this.reconnectButtonText = 'Connect';
    this.cobasService.closeConnection();
    //this.cobasService.connect();

  }

}
