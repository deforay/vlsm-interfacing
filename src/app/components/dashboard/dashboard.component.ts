import { Component, NgModule, OnInit, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

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

 
  totalResults: number = 0;
  syncedResults: number = 0;
  notYetSyncedResults: number = 0;
  failedtosync: number = 0;


  sessionDatasArray: { mode: string; sessionId: string; startTime: string; endTime?: string }[] = [];
  filteredSessionDatasArray: { mode: string; sessionId: string; startTime: string; endTime?: string }[] = [];

  constructor(
    private dialogRef: MatDialogRef<DashboardComponent>,
    private router: Router,
    private route: ActivatedRoute,
    @Inject(MAT_DIALOG_DATA) public dialogData: { dashboardData: ResultData[] }
  ) {}

  ngOnInit() {
    this.data = this.dialogData.dashboardData;
    console.log('Dialog Data:', this.data);
    
    this.filteredData = this.data;
    this.instruments = [...new Set(this.data.map(item => item.machine_used))];

    this.updateCounts(this.data);
    this.loadSessionData();
    this.retrieveSessionData();
    this.filterSessionData();

    console.log('Data initialized:', this.data);
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
    return data.reduce((latest, current) => 
      new Date(latest.added_on) > new Date(current.added_on) ? latest : current
    );
  }

  filterByInstrument() {
    console.log('Selected Instrument:', this.selectedInstrument);
    
    this.filteredData = this.selectedInstrument 
      ? this.data.filter(item => item.machine_used === this.selectedInstrument) 
      : this.data;

    this.updateCounts(this.filteredData);
    this.filterSessionData();

    console.log('Filtered Data:', this.filteredData);
    console.log('RESULTS RECEIVED:', this.totalResults);
    console.log('RESULTS SYNCED TO LIS:', this.syncedResults);
  }

  filterData(event: Event) {
    const query = (event.target as HTMLInputElement).value.toLowerCase();
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
    this.dialogRef.close();
  }
  
  private retrieveSessionData() {
    const storedSessionData = JSON.parse(localStorage.getItem('sessionDatas') || '{}');
  
    
    if (typeof storedSessionData === 'object' && storedSessionData !== null) {
      this.sessionDatasArray = Object.entries(storedSessionData).map(([mode, session]) => ({
        mode,
        sessionId: (session as SessionData).sessionId,  
        startTime: (session as SessionData).startTime,  
        endTime: (session as SessionData).endTime || 'N/A'  
      }));
  
      console.log('Session Data retrieved:', this.sessionDatasArray);
    } else {
      console.error('No valid session data found in local storage.');
    }
  }
  

  private loadSessionData() {
    const sessionId = localStorage.getItem('sessionId');
    if (sessionId) {
      const startTime = localStorage.getItem(`${sessionId}_startTime`);
      const endTime = localStorage.getItem(`${sessionId}_closeTime`);
      if (startTime) {
        this.sessionDatasArray.push({
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

