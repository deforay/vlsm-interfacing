import { Component, OnInit } from '@angular/core';
import { CobasService } from '../../services/cobas.service';


@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {

  private jsonStorage = null;
  constructor(private cobasService: CobasService) {
    
    cobasService.connect();
  
  }

  ngOnInit() {
  }

  reconnect() {
    this.cobasService.disconnect();
    this.cobasService.connect();
    
  }

}
