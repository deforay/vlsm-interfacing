import { Component, OnInit, OnDestroy, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
import { Router } from '@angular/router';
import { UtilitiesService } from '../../services/utilities.service';
import { ConnectionManagerService } from '../../services/connection-manager.service';
import { RawDataProcessorService } from '../../services/raw-data-processor.service';
import { MatPaginator } from '@angular/material/paginator';
import { MatTableDataSource } from '@angular/material/table';
import { MatSort } from '@angular/material/sort';
import { MatDialog } from '@angular/material/dialog';
import { SelectionModel } from '@angular/cdk/collections';
import { Subscription } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-raw-data',
  templateUrl: './raw-data.component.html',
  styleUrls: ['./raw-data.component.scss']
})
export class RawDataComponent implements OnInit, OnDestroy {
  public lastrawData: any;
  public data: any;
  public displayedColumns: string[] = [
    'select',
    'machine',
    'added_on',
    'data',
    'actions'
  ];

  public availableInstruments = [];
  private instrumentsSubscription: Subscription;
  private reprocessingSubscription: Subscription;
  private dataSubscription: Subscription;

  public isReprocessing = false;
  public reprocessingStatus = {
    inProgress: false,
    processedCount: 0,
    totalCount: 0,
    currentItem: '',
    success: 0,
    failed: 0,
    errors: []
  };

  // For tracking processing time
  private processingStartTime: number;

  // Selection model for selecting rows
  selection = new SelectionModel<any>(true, []);

  dataSource = new MatTableDataSource<any>();
  @ViewChild(MatPaginator, { static: true }) paginator: MatPaginator;
  @ViewChild(MatSort, { static: true }) sort: MatSort;
  @ViewChild('searchInput') searchInput: ElementRef;

  constructor(
    private utilitiesService: UtilitiesService,
    private connectionManagerService: ConnectionManagerService,
    private rawDataProcessor: RawDataProcessorService,
    private cdRef: ChangeDetectorRef,
    private router: Router,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) { }

  ngOnInit() {
    // Initialize empty reprocessing status
    this.reprocessingStatus = {
      inProgress: false,
      processedCount: 0,
      totalCount: 0,
      currentItem: '',
      success: 0,
      failed: 0,
      errors: []
    };
    this.isReprocessing = false;

    this.fetchrawData('');

    // Subscribe to instrument status
    this.instrumentsSubscription = this.connectionManagerService.getActiveInstruments()
      .subscribe(instruments => {
        this.availableInstruments = instruments;
        this.cdRef.detectChanges();
      });

    // Subscribe to reprocessing status
    this.reprocessingSubscription = this.rawDataProcessor.getReprocessingStatus()
      .subscribe(status => {
        this.reprocessingStatus = status;
        this.isReprocessing = status.inProgress;
        this.cdRef.detectChanges();

        // If processing just completed, show results in a snackbar
        if (this.processingStartTime && !status.inProgress &&
          (status.processedCount > 0)) {
          const processingTime = this.formatProcessingTime(Date.now() - this.processingStartTime);
          this.showReprocessingResults(status, processingTime);
          this.processingStartTime = null;
        }
      });
  }

  /** Whether the number of selected elements matches the total number of rows. */
  isAllSelected() {
    const numSelected = this.selection.selected.length;
    const numRows = this.dataSource.data.length;
    return numSelected === numRows && numRows > 0;
  }

  /** Selects all rows if they are not all selected; otherwise clear selection. */
  masterToggle() {
    if (this.isAllSelected()) {
      this.selection.clear();
    } else {
      this.dataSource.data.forEach(row => this.selection.select(row));
    }
  }

  /** The label for the checkbox on the passed row */
  checkboxLabel(row?: any): string {
    if (!row) {
      return `${this.isAllSelected() ? 'select' : 'deselect'} all`;
    }
    return `${this.selection.isSelected(row) ? 'deselect' : 'select'} row ${row.id}`;
  }

  click() {
    this.router.navigate(['/console']);
  }

  filterData(event: any) {
    const searchTerm = event.target.value;
    if (searchTerm && searchTerm.length >= 2) {
      this.fetchrawData(searchTerm);
    } else {
      this.fetchrawData('');
    }
  }

  toggleRow(row: any, event?: MouseEvent) {
    if (event) {
      event.stopPropagation();
    }
    row.expanded = !row.expanded;
  }

  fetchrawData(searchTerm: string) {
    if (this.dataSubscription) {
      this.dataSubscription.unsubscribe();
    }

    this.utilitiesService.fetchrawData(searchTerm);

    this.dataSubscription = this.utilitiesService.lastrawData.subscribe({
      next: lastFewrawData => {
        if (lastFewrawData && lastFewrawData[0]) {
          this.lastrawData = lastFewrawData[0];
          this.data = lastFewrawData[0];

          // Add expanded property to each row
          if (Array.isArray(this.data)) {
            this.data.forEach(row => {
              if (row) {
                row.expanded = false;
              }
            });

            this.dataSource.data = this.lastrawData;
            this.dataSource.paginator = this.paginator;
            this.dataSource.sort = this.sort;
          } else {
            console.error('Invalid data format:', this.data);
            this.dataSource.data = [];
          }
        } else {
          this.dataSource.data = [];
        }

        this.cdRef.detectChanges();
      },
      error: error => {
        console.error('Error fetching raw data:', error);
        this.dataSource.data = [];
        this.cdRef.detectChanges();
      }
    });
  }

  // Select a row when clicking on it
  selectRow(row: any, event: MouseEvent) {
    // Don't select if we clicked on an action button or expand toggle
    const target = event.target as HTMLElement;
    const isActionButton = target.closest('.btn-expand-toggle') ||
      target.closest('.action-btn') ||
      target.closest('mat-checkbox');

    if (!isActionButton) {
      this.selection.toggle(row);
    }
  }

  /**
   * Reprocess a single row
   */
  reprocessSingleRow(row: any, event?: Event) {
    // Prevent event propagation
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (this.isReprocessing) {
      this.showMessage('Already processing data. Please wait until it completes.');
      return;
    }

    // Log the action for debugging
    console.log(`Reprocessing row ID ${row.id} for ${row.machine || row.instrument_id}`);

    // Clear the current selection and select only this row
    this.selection.clear();
    this.selection.select(row);

    // Process the selected row
    this.reprocessSelected();
  }

  /**
   * Reprocess selected rows
   */
  async reprocessSelected() {
    if (this.isReprocessing) {
      this.showMessage('Already processing data. Please wait until it completes.');
      return;
    }

    const selected = this.selection.selected;
    if (!selected || selected.length === 0) {
      this.showMessage('Please select rows to reprocess');
      return;
    }

    // Confirm before processing large number of rows
    if (selected.length > 5) {
      if (!confirm(`You are about to reprocess ${selected.length} raw data entries. This might take some time. Continue?`)) {
        return;
      }
    }

    try {
      // Start tracking processing time
      this.processingStartTime = Date.now();

      // Set local processing state
      this.isReprocessing = true;

      // Explicitly initialize the reprocessing status object
      this.reprocessingStatus = {
        inProgress: true,
        processedCount: 0,
        totalCount: selected.length,
        currentItem: 'Starting reprocessing...',
        success: 0,
        failed: 0,
        errors: []
      };

      // Force change detection
      this.cdRef.detectChanges();

      // Log the start of reprocessing
      this.utilitiesService.logger('info', `Starting reprocessing of ${selected.length} selected raw data entries`, null);

      // Call the reprocessing service
      console.log('Calling reprocessRawData with', selected.length, 'rows');
      const result = await this.rawDataProcessor.reprocessRawData(selected);
      console.log('Processing complete with result:', result);

      // Show results
      const processingTime = this.formatProcessingTime(Date.now() - this.processingStartTime);
      this.showMessage(`Reprocessing complete: ${result.success} succeeded, ${result.failed} failed. Time: ${processingTime}`);

      // Set success status - critical for UI update
      this.reprocessingStatus.inProgress = false;
      this.reprocessingStatus.success = result.success;
      this.reprocessingStatus.failed = result.failed;
      this.isReprocessing = false;

      // Force change detection
      this.cdRef.detectChanges();

      // Clear the selection
      this.selection.clear();

      // Refresh the data after a delay
      setTimeout(() => this.fetchrawData(''), 1000);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error during reprocessing:', error);
      this.utilitiesService.logger('error', `Error during reprocessing: ${errorMessage}`, null);
      this.showMessage(`Error during reprocessing: ${errorMessage}`);

      // Reset processing state
      this.isReprocessing = false;
      this.reprocessingStatus.inProgress = false;

      // Force change detection
      this.cdRef.detectChanges();
    }
  }

  /**
   * Show a message to the user
   */
  showMessage(message: string) {
    console.log('Message:', message);

    if (this.snackBar) {
      this.snackBar.open(message, 'Dismiss', {
        duration: 5000,
        verticalPosition: 'bottom',
        horizontalPosition: 'center',
      });
    } else {
      alert(message);
    }
  }

  formatProcessingTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes === 0) {
      return `${seconds} seconds`;
    }

    return `${minutes} min ${remainingSeconds} sec`;
  }

  showReprocessingResults(status: any, processingTime: string) {
    const message = `Reprocessing complete: ${status.success} succeeded, ${status.failed} failed. Time: ${processingTime}`;
    this.showMessage(message);

    // Log results
    if (status.failed > 0) {
      this.utilitiesService.logger('warning',
        `Reprocessing completed with ${status.failed} failures. ${status.errors.length} errors occurred.`,
        null);

      // Log each error
      status.errors.forEach((error, index) => {
        this.utilitiesService.logger('error', `Error ${index + 1}: ${error}`, null);
      });
    } else {
      this.utilitiesService.logger('success',
        `Successfully reprocessed ${status.success} records in ${processingTime}`,
        null);
    }
  }

  ngOnDestroy() {
    // Clean up subscriptions
    [
      this.instrumentsSubscription,
      this.reprocessingSubscription,
      this.dataSubscription
    ].forEach(subscription => {
      if (subscription) {
        subscription.unsubscribe();
      }
    });
  }
}
