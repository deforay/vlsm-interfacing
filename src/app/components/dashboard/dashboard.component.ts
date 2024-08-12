import { Component, NgModule, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms'; // Import FormsModule
import { Router, ActivatedRoute } from '@angular/router';

interface ResultData {
  added_on: string;
  machine_used: string;
  order_id: string;
  lims_sync_status: number;
  lims_sync_date_time: string;
}

interface SessionData {
  sessionId: string;
  startTime: string;
  endTime?: string;
}

interface SessionDatas {
  sessionId: string;
  startTime: string;
  endTime?: string;
}

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {
  data: ResultData[] = [];
  filteredData: ResultData[] = [];
  latestResult?: ResultData;
  selectedInstrument: string = '';
  instruments: string[] = [];

  // Variables to store count information
  totalResults: number = 0;
  syncedResults: number = 0;
  notYetSyncedResults: number = 0;
  failedtosync: number = 0;
  sessionDatas: { [key: string]: SessionDatas } = {};
  sessionDatasArray: { mode: string; sessionId: string; startTime: string; endTime?: string }[] = [];
  // Variables to store session data for display
  sessionDataArray: { mode: string; sessionId: string; startTime: string; endTime?: string }[] = [];
  filteredSessionDatasArray: { mode: string; sessionId: string; startTime: string; endTime?: string }[] = [];

  constructor(private router: Router, private route: ActivatedRoute) {}

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      if (params['data']) {
        this.data = JSON.parse(params['data']);
        this.filteredData = this.data;

        
        this.instruments = [...new Set(this.data.map(item => item.machine_used))];

    
        this.updateCounts(this.data);

  
        this.loadSessionData();
        this.retrieveSessionData();

        
        this.filterSessionData();

        console.log('Data initialized:', this.data);
      }
    });
  }

  private updateCounts(data: ResultData[]) {
    this.totalResults = data.length;
    this.syncedResults = data.filter(item => item.lims_sync_status === 1).length;
    this.notYetSyncedResults = data.filter(item => item.lims_sync_status === 0).length;
    this.failedtosync = data.filter(item => item.lims_sync_status === 2).length;

    
    this.latestResult = this.getLatestResult(data);
    console.log('Latest result:', this.latestResult);
  }

  private getLatestResult(data: ResultData[]): ResultData | undefined {
    if (!data || data.length === 0) {
      return undefined;
    }
  
    return data.reduce((latest, current) => {
      return new Date(latest.added_on) > new Date(current.added_on) ? latest : current;
    });
  }

  filterByInstrument() {
    console.log('Selected Instrument:', this.selectedInstrument); 
  
    if (this.selectedInstrument) {
      this.filteredData = this.data.filter(item => item.machine_used === this.selectedInstrument);
    } else {
      this.filteredData = this.data;
    }
  
    this.updateCounts(this.filteredData);
    this.filterSessionData();

    console.log('Filtered Data:', this.filteredData); 
    console.log('RESULTS RECEIVED:', this.totalResults); 
    console.log('RESULTS SYNCED TO LIS:', this.syncedResults);
  }

  filterData($event: any) {
    const query = $event.target.value.toLowerCase();
    console.log('Filter query:', query); 
    this.filteredData = this.data.filter(item => 
      item.machine_used.toLowerCase().includes(query) ||
      item.added_on.toLowerCase().includes(query) ||
      item.lims_sync_date_time.toLowerCase().includes(query)
    );
    this.updateCounts(this.filteredData); 
    console.log('Filtered data:', this.filteredData); 
  }

  click() {
    this.router.navigate(['/console']);
  }

  private retrieveSessionData() {
    const storedSessionData = JSON.parse(localStorage.getItem('sessionDatas') || '{}');
    this.sessionDatas = storedSessionData;

   
    this.sessionDatasArray = Object.keys(this.sessionDatas).map(mode => ({
      mode,
      ...this.sessionDatas[mode]
    }));

    console.log('Session Data retrieved:', this.sessionDatasArray);
  }

  private loadSessionData() {
    const sessionId = localStorage.getItem('sessionId');
    if (sessionId) {
      const startTime = localStorage.getItem(`${sessionId}_startTime`);
      const endTime = localStorage.getItem(`${sessionId}_closeTime`);
      if (startTime) {
        this.sessionDataArray.push({
          mode: 'Current Session', 
          sessionId: sessionId,
          startTime: startTime,
          endTime: endTime || 'N/A'
        });
      }
    }
  }

  private filterSessionData() {
    
    this.filteredSessionDatasArray = this.selectedInstrument 
      ? this.sessionDatasArray.filter(session => session.mode === this.selectedInstrument)
      : this.sessionDatasArray;
  }
}

@NgModule({
  declarations: [DashboardComponent],
  imports: [
    CommonModule,
    FormsModule 
  ]
})
export class DashboardModule {}
