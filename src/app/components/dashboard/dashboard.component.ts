import { Component, OnInit, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { ElectronStoreService } from '../../services/electron-store.service';
import { InterfaceService } from '../../services/interface.service';
//import { GeneXpertService } from '../../services/genexpert.service';

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
  public machineName = '';
  public interval: any;
  public lastOrders: any;
  public liveLogText = [];

  constructor(private store: ElectronStoreService,
    private _ngZone: NgZone,
    public interfaceService: InterfaceService,
    private router: Router) {

    const that = this;

    const appSettings = that.store.get('appSettings');

    if (undefined === appSettings || !appSettings.analyzerMachinePort || !appSettings.interfaceCommunicationProtocol || !appSettings.analyzerMachineHost) {
      that.router.navigate(['/settings']);
    } else {
      that.machineName = appSettings.analyzerMachineName;
    }
  }

  ngOnInit() {

    const that = this;

    that.interfaceService.currentStatus.subscribe(status => {
      that._ngZone.run(() => {
        that.isConnected = status;
      });
    });



    that.interfaceService.liveLog.subscribe(mesg => {
      that._ngZone.run(() => {
        that.liveLogText = mesg;
      });
    });

    // Let us fetch last few Orders on load
    that.fetchLastOrders('hide');

    // let us call the function every 5 minutes
    that.interval = setInterval(() => { that.fetchLastOrders('hide'); }, 1000 * 300);



    that.interfaceService.stopTrying.subscribe(status => {
      that._ngZone.run(() => {

        // console.log(status);
        // that.stopTrying = status;
        // if (that.stopTrying) {
        // that.cobasService.logger('error', 'Unable to connect to machine. Check Settings');
        // that.close();
        // }
      });
    });

  }

  fetchLastOrders(showNotification) {
    const that = this;
    that.interfaceService.fetchLastOrders();

    that.interfaceService.lastOrders.subscribe(lastFewOrders => {
      that._ngZone.run(() => {
        that.lastOrders = lastFewOrders[0];
        //console.log(showNotification);
        if (showNotification !== 'hide') {
          showNotification = 'hide';
          // return new Notification('VLSM Interfacing', {
          //   body: 'Fetched recent orders'
          // });
          //that.cobasService.logger('info', 'Fetched recent records from database');
        }


      });
    });

  }

  clearLiveLog() {
    this.liveLogText = null;
  }

  reconnect() {
    this.connectionInProcess = true;
    this.reconnectButtonText = 'Please wait ... ';
    this.interfaceService.reconnect();
  }

  close() {
    this.connectionInProcess = false;
    this.reconnectButtonText = 'Connect';
    this.interfaceService.closeConnection();
  }

  ngOnDestroy() {
    clearInterval(this.interval);
  }




}

