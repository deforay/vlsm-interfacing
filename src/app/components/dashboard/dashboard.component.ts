import { Component, OnInit, NgZone } from '@angular/core';
import { CobasService } from '../../services/cobas.service';
import { Router } from '@angular/router';


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
  public interval: any = null;
  public lastOrders: any = {};
  

  constructor(public cobasService: CobasService, private _ngZone: NgZone, private router: Router) {

    const Store = require('electron-store');
    const store = new Store();

    let appSettings = store.get('appSettings');
    if (undefined == appSettings || !appSettings.rochePort || !appSettings.rocheProtocol || !appSettings.rocheHost) {
      this.router.navigate(['/settings']);
    }
  }

  ngOnInit() {

    let that = this;

    that.cobasService.currentStatus.subscribe(status => {
      that._ngZone.run(() => {
        that.isConnected = status;
      });
    });
    
    // Let us fetch last few Orders
    that.fetchLastOrders();
    // let us call the function every 10 seconds
    that.interval = setInterval(that.fetchLastOrders(), 10000);


    that.cobasService.stopTrying.subscribe(status => {
      that._ngZone.run(() => {
        //console.log(status);
        // that.stopTrying = status;
        // if (that.stopTrying) {
        //   const { dialog } = require('electron').remote;
        //   dialog.showErrorBox('Oops! Something went wrong!', 'Unable to connect. Check if all the Roche machine connection settings are correct and the Machine is running.');
        //   that.close();
        // }
      });
    })

  }


  fetchLastOrders(){
    let that = this;
    that.cobasService.fetchLastOrders();

    that.cobasService.lastOrders.subscribe(lastFewOrders => {
      that._ngZone.run(() => {
        that.lastOrders = lastFewOrders[0];
      });
    });

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

  ngOnDestroy() {
    clearInterval(this.interval);
  }




}
