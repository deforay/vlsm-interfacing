import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, FormArray, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ElectronService } from '../../core/services';
import { ElectronStoreService } from '../../services/electron-store.service';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
})
export class SettingsComponent implements OnInit {
  public settingsForm: FormGroup;
  public appPath: string = "";
  public appVersion: string = null;

  constructor(
    private fb: FormBuilder,
    private electronService: ElectronService,
    private router: Router,
    private store: ElectronStoreService
  ) {
    const commonSettingsStore = this.store.get('commonConfig');
    const instrumentSettingsStore = this.store.get('instrumentsConfig');
    this.appPath = this.store.get('appPath');
    this.appVersion = this.store.get('appVersion');

    // Initialize the form with the existing settings
    this.settingsForm = this.fb.group({
      commonSettings: this.fb.group({
        labID: ['', Validators.required],
        labName: ['', Validators.required],
        mysqlHost: [''],
        mysqlPort: [''],
        mysqlDb: [''],
        mysqlUser: [''],
        mysqlPassword: [''],
        interfaceAutoConnect: ['yes', Validators.required]
      }),
      instrumentsSettings: this.fb.array(
        (instrumentSettingsStore || []).map(instrument => this.fb.group(instrument))
      )
    });
  }

  ngOnInit(): void { }

  // Getter for easy access to the instrumentsSettings FormArray
  get instrumentsSettings(): FormArray {
    return this.settingsForm.get('instrumentsSettings') as FormArray;
  }

  createInstrumentFormGroup(): FormGroup {
    return this.fb.group({
      analyzerMachineType: ['', Validators.required],
      interfaceCommunicationProtocol: ['', Validators.required],
      analyzerMachineName: ['', Validators.required],
      analyzerMachineHost: ['', Validators.required],
      analyzerMachinePort: ['', Validators.required],
      interfaceConnectionMode: ['', Validators.required]
    });
  }

  addInstrument(): void {
    this.instrumentsSettings.push(this.createInstrumentFormGroup());
  }

  confirmRemoval(index: number, analyzerMachineName: string): void {
    const confirmed = window.confirm(`Are you sure you want to remove Instrument ${analyzerMachineName}?`);
    if (confirmed) {
      this.removeInstrument(index);
    }
  }

  removeInstrument(index: number): void {
    this.instrumentsSettings.removeAt(index);
  }

  updateSettings(): void {
    if (this.settingsForm.valid) {
      const updatedSettings = this.settingsForm.value;
      this.store.set('commonConfig', updatedSettings.commonSettings);
      this.store.set('instrumentsConfig', updatedSettings.instrumentsSettings);

      new Notification('Success', {
        body: 'Updated Interface Tool settings'
      });

      this.router.navigate(['/dashboard']);
    } else {
      console.error('Form is not valid');
    }
  }

  checkMysqlConnection() {

    const that = this;
    const mysql = that.electronService.mysql;
    const commonSettings = that.settingsForm.get('commonSettings').value;
    const connection = mysql.createConnection({
      host: commonSettings.mysqlHost,
      user: commonSettings.mysqlUser,
      password: commonSettings.mysqlPassword,
      port: commonSettings.mysqlPort
    });

    connection.connect(function (err: string) {

      if (err) {

        const dialogConfig = {
          type: 'error',
          message: 'Oops! Something went wrong! Unable to connect to the MySQL database on host ' + commonSettings.mysqlHost,
          detail: err + '\n\nPlease check if all the database connection settings are correct and the MySQL server is running.',
          buttons: ['OK']
        };
        that.electronService.openDialog('showMessageBox', dialogConfig);
      } else {
        const dialogConfig = {
          type: 'info',
          message: 'MySQL Connected successfully. Please click on SAVE SETTINGS to update these settings.',
          buttons: ['OK']
        };
        that.electronService.openDialog('showMessageBox', dialogConfig);
        connection.destroy();
      }

    });
  }
}
