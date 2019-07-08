import { Component, OnInit, NgZone } from '@angular/core';
import { CobasService } from '../../services/cobas.service';
import { Router } from '@angular/router';


@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {

  public isConnected = false;
  public stopTrying = false;
  public connectionInProcess = false;
  public reconnectButtonText = 'Connect';
  public interval: any;
  public lastOrders: any;
  public liveLogText = [];


  constructor(public cobasService: CobasService, private _ngZone: NgZone, private router: Router) {

    const Store = require('electron-store');
    const store = new Store();

    const appSettings = store.get('appSettings');
    if (undefined === appSettings || !appSettings.rochePort || !appSettings.rocheProtocol || !appSettings.rocheHost) {
      this.router.navigate(['/settings']);
    }
  }

  ngOnInit() {

    const that = this;

    that.cobasService.currentStatus.subscribe(status => {
      that._ngZone.run(() => {
        that.isConnected = status;
      });
    });

    

    that.cobasService.liveLog.subscribe(mesg => {
      that._ngZone.run(() => {
        that.liveLogText = mesg;
      });
    });

    // Let us fetch last few Orders on load
    that.fetchLastOrders(false);

    // let us call the function every 5 minutes
    that.interval = setInterval(() => { that.fetchLastOrders(false); }, 1000 * 300 );



    that.cobasService.stopTrying.subscribe(status => {
      that._ngZone.run(() => {
        // console.log(status);
        // that.stopTrying = status;
        // if (that.stopTrying) {
        //   const { dialog } = require('electron').remote;
        //   dialog.showErrorBox('Oops! Something went wrong!', 'Unable to connect. Check if all the Roche machine connection settings are correct and the Machine is running.');
        //   that.close();
        // }
      });
    })

  }


  fetchLastOrders(showNotification){
    const that = this;
    that.cobasService.fetchLastOrders();

    that.cobasService.lastOrders.subscribe(lastFewOrders => {
      that._ngZone.run(() => {
        that.lastOrders = lastFewOrders[0];

        if(showNotification){
          new Notification('VLSM Interfacing', {
            body: 'Fetched recent orders'
          });
        }


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
