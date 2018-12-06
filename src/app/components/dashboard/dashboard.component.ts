import { Component, OnInit, NgZone } from '@angular/core';
import { CobasService } from '../../services/cobas.service';


@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {

  public isConnected: boolean = false;

  constructor(public cobasService: CobasService, private _ngZone: NgZone) {


  }

  ngOnInit() {
    this.cobasService.currentStatus.subscribe(status => {
      this._ngZone.run(() => {
        console.log(status);
        this.isConnected = status;
        if(!this.isConnected){
          this.cobasService.connect();
        }        
      });
    })

  }

  reconnect() {
    this.cobasService.disconnect();
    this.cobasService.connect();

  }

}
