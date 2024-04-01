import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { UtilitiesService } from '../../services/utilities.service';
import { MatPaginator } from '@angular/material/paginator';
import { MatTableDataSource } from '@angular/material/table';
import { MatSort } from '@angular/material/sort';
import { ViewChild } from '@angular/core';

@Component({
  selector: 'app-raw-data-component',

  templateUrl: './raw-data-component.component.html',
  styleUrl: './raw-data-component.component.scss'
})
export class RawDataComponentComponent  {
  public lastrawData: any;
  public data: any;
  public displayedColumns: string[] = [
    'machine',
    'added_on',
    'data',
  ];
  dataSource = new MatTableDataSource<any>();
  @ViewChild(MatPaginator, { static: true }) paginator: MatPaginator;
  @ViewChild(MatSort, { static: true }) sort: MatSort;

  constructor(
    private utilitiesService: UtilitiesService,
    private router: Router){}

  ngOnInit(){
    this.fetchrawData()
    
  }

  click(){
    this.router.navigate(['/dashboard']);
  }

  filterData($event:any){
    this.dataSource.filter = $event.target.value;
  }

  toggleRow(row: any) {
    row.expanded = !row.expanded;
}

  fetchrawData() {
    const that = this;
    that.utilitiesService.fetchrawData();
    that.utilitiesService.lastrawData.subscribe({
      next: lastFewrawData => {
          that.lastrawData = lastFewrawData[0];
          console.log(that.lastrawData)
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
}
