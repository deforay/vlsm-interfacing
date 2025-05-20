// src/app/components/raw-data/raw-data.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { UtilitiesService } from '../../services/utilities.service';
import { ConnectionManagerService } from '../../services/connection-manager.service';
import { MatPaginator } from '@angular/material/paginator';
import { MatTableDataSource } from '@angular/material/table';
import { MatSort } from '@angular/material/sort';
import { ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-raw-data',
  templateUrl: './raw-data.component.html',
  styleUrl: './raw-data.component.scss'
})
export class RawDataComponent implements OnInit, OnDestroy {
  public lastrawData: any;
  public data: any;
  public displayedColumns: string[] = [
    'machine',
    'added_on',
    'data',
  ];
  public availableInstruments = [];
  private instrumentsSubscription: Subscription;

  dataSource = new MatTableDataSource<any>();
  @ViewChild(MatPaginator, { static: true }) paginator: MatPaginator;
  @ViewChild(MatSort, { static: true }) sort: MatSort;

  constructor(
    private utilitiesService: UtilitiesService,
    private connectionManagerService: ConnectionManagerService,
    private router: Router) { }

  ngOnInit() {
    this.fetchrawData('');

    // Subscribe to instrument status
    this.instrumentsSubscription = this.connectionManagerService.getActiveInstruments()
      .subscribe(instruments => {
        this.availableInstruments = instruments;
      });
  }

  click() {
    this.router.navigate(['/console']);
  }

  filterData($event: any) {
    const searchTerm = $event.target.value;
    if (searchTerm.length >= 2) {
      this.fetchrawData(searchTerm);
    } else {
      this.fetchrawData('');
    }
  }

  toggleRow(row: any) {
    row.expanded = !row.expanded;
  }

  fetchrawData(searchTerm: string) {
    const that = this;
    that.utilitiesService.fetchrawData(searchTerm);

    that.utilitiesService.lastrawData.subscribe({
      next: lastFewrawData => {
        that.lastrawData = lastFewrawData[0];
        that.data = lastFewrawData[0];
        this.dataSource.data = that.lastrawData;
        this.dataSource.paginator = this.paginator;
        this.dataSource.sort = this.sort;
      },
      error: error => {
        console.error('Error fetching last orders:', error);
      }
    });
  }

  // Add connection methods for use in the template
  connect(instrument: any) {
    this.connectionManagerService.connect(instrument);
  }

  reconnect(instrument: any) {
    this.connectionManagerService.reconnect(instrument);
  }

  disconnect(instrument: any) {
    this.connectionManagerService.disconnect(instrument);
  }

  ngOnDestroy() {
    if (this.instrumentsSubscription) {
      this.instrumentsSubscription.unsubscribe();
    }
  }
}
