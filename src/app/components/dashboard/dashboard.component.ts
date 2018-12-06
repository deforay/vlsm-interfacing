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

  constructor(public cobasService: CobasService, private _ngZone: NgZone, private router: Router) {
    
      const Store = require('electron-store');
      const store = new Store();

      let appSettings = store.get('appSettings');
      if(undefined == appSettings || !appSettings.rochePort || !appSettings.rocheHost){
        this.router.navigate(['/settings']);
      }
      this.cobasService.connect();
    

  }

  ngOnInit() {
    this.cobasService.currentStatus.subscribe(status => {
      this._ngZone.run(() => {
        console.log(status);
        this.isConnected = status;
      });
    })

  }

  reconnect() {
    this.cobasService.reconnect();
    //this.cobasService.connect();

  }

  close() {
    this.cobasService.closeConnection();
    //this.cobasService.connect();

  }

}
