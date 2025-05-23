// src/app/components/dashboard/dashboard.component.ts
import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { ConnectionManagerService } from '../../services/connection-manager.service';
import { UtilitiesService } from '../../services/utilities.service';
import { Subscription } from 'rxjs';

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
  public availableInstruments = [];
  private instrumentsSubscription: Subscription;

  totalResults: number = 0;
  syncedResults: number = 0;
  notYetSyncedResults: number = 0;
  failedtosync: number = 0;

  sessionDatasArray: { mode: string; sessionId: string; startTime: string; endTime?: string }[] = [];
  filteredSessionDatasArray: { mode: string; sessionId: string; startTime: string; endTime?: string }[] = [];

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private utilitiesService: UtilitiesService,
    private connectionManagerService: ConnectionManagerService
  ) { }

  ngOnInit() {
    // Subscribe to instrument status
    this.instrumentsSubscription = this.connectionManagerService.getActiveInstruments()
      .subscribe(instruments => {
        this.availableInstruments = instruments;
      });

    // Fetch recent results to get dashboard data
    this.fetchDashboardData();

    // Load instrument names for the dropdown
    this.loadInstrumentNames();

    // Load session data
    this.loadSessionData();
    this.retrieveSessionData();
    this.filterSessionData();
  }

  public fetchDashboardData() {
    this.utilitiesService.fetchRecentResults('');
    this.utilitiesService.lastOrders.subscribe({
      next: lastFewOrders => {
        if (lastFewOrders && lastFewOrders.length > 0) {
          this.data = lastFewOrders[0].map((item: any) => ({
            added_on: item.added_on,
            machine_used: item.machine_used,
            order_id: item.order_id,
            lims_sync_status: item.lims_sync_status,
            lims_sync_date_time: item.lims_sync_date_time
          }));

          this.filteredData = this.data;
          this.updateCounts(this.data);
        }
      },
      error: error => {
        console.error('Error fetching orders for dashboard:', error);
      }
    });
  }

  private loadInstrumentNames() {
    // Get instrument names from the data for the dropdown
    if (this.data && this.data.length > 0) {
      this.instruments = [...new Set(this.data.map(item => item.machine_used))];
    }
    // Also add instruments from the connection manager
    this.availableInstruments.forEach(instrument => {
      if (!this.instruments.includes(instrument.connectionParams.instrumentId)) {
        this.instruments.push(instrument.connectionParams.instrumentId);
      }
    });
  }

  private updateCounts(data: ResultData[]) {
    this.totalResults = data.length;
    this.syncedResults = data.filter(item => item.lims_sync_status === 1).length;
    this.notYetSyncedResults = data.filter(item => item.lims_sync_status === 0).length;
    this.failedtosync = data.filter(item => item.lims_sync_status === 2).length;

    this.latestResult = this.getLatestResult(data);
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
    this.filteredData = this.selectedInstrument
      ? this.data.filter(item => item.machine_used === this.selectedInstrument)
      : this.data;

    this.updateCounts(this.filteredData);
    this.filterSessionData();
  }

  filterData(event: Event) {
    const query = (event.target as HTMLInputElement).value.toLowerCase();

    this.filteredData = this.data.filter(item =>
      item.machine_used.toLowerCase().includes(query) ||
      item.added_on.toLowerCase().includes(query) ||
      item.lims_sync_date_time.toLowerCase().includes(query)
    );
    this.updateCounts(this.filteredData);
  }

  click() {
    this.router.navigate(['/console']);
  }

  private retrieveSessionData() {
    const storedSessionData = JSON.parse(localStorage.getItem('sessionDatas') || '{}');

    if (typeof storedSessionData === 'object' && storedSessionData !== null) {
      this.sessionDatasArray = Object.entries(storedSessionData).map(([mode, session]) => ({
        mode,
        sessionId: (session as any).sessionId,
        startTime: (session as any).startTime,
        endTime: (session as any).endTime || 'N/A'
      }));
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
  // Add this method to your DashboardComponent class
  isInstrumentCurrentlyAvailable(instrumentMode: string): boolean {
    // Check if the instrument mode/id exists in the current available instruments
    return this.availableInstruments.some(
      instrument => instrument.connectionParams.instrumentId === instrumentMode
    );
  }

  ngOnDestroy() {
    if (this.instrumentsSubscription) {
      this.instrumentsSubscription.unsubscribe();
    }
  }
}
