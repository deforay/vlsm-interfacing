import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, FormArray, Validators, AbstractControl, ValidatorFn, FormControl } from '@angular/forms';
import { Router } from '@angular/router';
import { ElectronService } from '../../core/services';
import { ElectronStoreService } from '../../services/electron-store.service';
import * as os from 'os';
import { ipcRenderer } from 'electron';
import { UtilitiesService } from '../../services/utilities.service';
import { CryptoService } from '../../services/crypto.service';
import { v4 as uuidv4 } from 'uuid';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
})
export class SettingsComponent implements OnInit {
  public settingsForm: FormGroup;
  public appPath: string = "";
  public appVersion: string = null;
  public machineIps: string[] = [];

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly electronService: ElectronService,
    private readonly router: Router,
    private readonly electronStoreService: ElectronStoreService,
    private readonly utilitiesService: UtilitiesService,
    private readonly cryptoService: CryptoService
  ) {

    const commonSettingsStore = this.electronStoreService.get('commonConfig');
    const instrumentSettingsStore = this.electronStoreService.get('instrumentsConfig');
    this.appPath = this.electronStoreService.get('appPath');
    this.appVersion = this.electronStoreService.get('appVersion');
    this.machineIps = this.getMachineIps();

    // Initialize the form with the existing settings
    this.settingsForm = this.formBuilder.group({
      commonSettings: this.formBuilder.group({
        labID: ['', Validators.required],
        labName: ['', Validators.required],
        // enable_api: ['no'],
        // api_url:[''],
        // api_auth:[''],
        mysqlHost: [''],
        mysqlPort: [''],
        mysqlDb: [''],
        mysqlUser: [''],
        mysqlPassword: [''],
        interfaceAutoConnect: ['yes', Validators.required]
      }),
      instrumentsSettings: this.formBuilder.array(
        (instrumentSettingsStore || []).map(instrument => this.formBuilder.group(instrument))
      )
    }, { validators: [this.uniqueInstrumentNameValidator(), this.uniqueIpPortValidator()] });

    this.settingsForm.patchValue({
      commonSettings: commonSettingsStore
    });

    // this.settingsForm.get('commonSettings.enable_api').valueChanges.subscribe(value => {
    //   if (value === 'yes') {
    //     this.settingsForm.get('commonSettings.api_url').setValidators([Validators.required]);
    //     this.settingsForm.get('commonSettings.api_auth').setValidators([Validators.required]);
    //   } else {
    //     this.settingsForm.get('commonSettings.api_url').clearValidators();
    //     this.settingsForm.get('commonSettings.api_auth').clearValidators();
    //   }
    //   this.settingsForm.get('commonSettings.api_url').updateValueAndValidity();
    //   this.settingsForm.get('commonSettings.api_auth').updateValueAndValidity();
    // });

  }


  ngOnInit(): void { }

  uniqueInstrumentNameValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const instrumentsSettings = control.get('instrumentsSettings') as FormArray;
      const duplicateIndexes = this.findDuplicates(
        instrumentsSettings.value.map(instrument => instrument.analyzerMachineName)
      );
      duplicateIndexes.forEach(index => {
        instrumentsSettings.at(index).get('analyzerMachineName').setErrors({ 'duplicateInstrumentName': true });
      });
      return null;  // This validator no longer returns an error itself
    };
  }

  uniqueIpPortValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const instrumentsSettings = control.get('instrumentsSettings') as FormArray;
      const duplicateIndexes = this.findDuplicates(
        instrumentsSettings.value.map(instrument => `${instrument.analyzerMachineHost}:${instrument.analyzerMachinePort}`)
      );
      duplicateIndexes.forEach(index => {
        instrumentsSettings.at(index).setErrors({ 'duplicateIpPort': true });
      });
      return null;  // This validator no longer returns an error itself
    };
  }

  findDuplicates(arr: string[]): number[] {
    const duplicates = [];
    const itemCounts = arr.reduce((acc, item, index) => {
      acc[item] = acc[item] ? [...acc[item], index] : [index];
      return acc;
    }, {});
    for (let key in itemCounts) {
      if (itemCounts[key].length > 1) {
        duplicates.push(...itemCounts[key]);
      }
    }
    return duplicates;
  }

  onConnectionModeChange(index: number, event: Event): void {
    const selectElement = event.target as HTMLSelectElement;
    const connectionMode = selectElement.value;
    if (connectionMode === 'tcpserver') {
      this.instrumentsSettings.at(index).get('analyzerMachineHost').setValue(this.machineIps[0]);
    }
  }




  // Getter for easy access to the instrumentsSettings FormArray
  get instrumentsSettings(): FormArray {
    return this.settingsForm.get('instrumentsSettings') as FormArray;
  }

  createInstrumentFormGroup(): FormGroup {
    const instrumentId = uuidv4();
    return this.formBuilder.group({
      id: instrumentId,
      analyzerMachineType: ['', Validators.required],
      interfaceCommunicationProtocol: ['', Validators.required],
      analyzerMachineName: ['', Validators.required],
      analyzerMachineHost: ['', Validators.required],
      analyzerMachinePort: ['', Validators.required],
      interfaceConnectionMode: ['', Validators.required],
      displayorder: ['']
    });
  }

  getMachineIps(): string[] {
    const networkInterfaces = os.networkInterfaces();
    const ips = [];


    for (let interfaceName in networkInterfaces) {
      const iface = networkInterfaces[interfaceName];
      for (let i = 0; i < iface.length; i++) {
        const alias = iface[i];
        if (alias.family === 'IPv4' && !alias.internal) {
          ips.push(alias.address);
        }
      }
    }

    // Adding 127.0.0.1 as a default option
    ips.push('127.0.0.1');

    return ips;
  }


  addInstrument(): void {
    this.instrumentsSettings.push(this.createInstrumentFormGroup());
  }

  confirmRemoval(index: number, analyzerMachineName: string, event: Event): void {
    event.preventDefault();
    const confirmed = window.confirm(`Are you sure you want to remove Instrument ${analyzerMachineName}?`);
    if (confirmed) {
      this.removeInstrument(index);
    }
  }


  removeInstrument(index: number): void {
    this.instrumentsSettings.removeAt(index);
  }

  resetInstrumentVariables(): void {
    this.instrumentsSettings.controls.forEach(control => {
      control.reset({
        analyzerMachineType: '',
        interfaceCommunicationProtocol: '',
        analyzerMachineName: '',
        analyzerMachineHost: '',
        analyzerMachinePort: '',
        interfaceConnectionMode: '',
        displayorder: ''
      });
    });
    console.log('Reset instrument variables.');
  }

  updateSettings(): void {
    const that = this;
    if (that.settingsForm.valid) {
      const updatedSettings = that.settingsForm.value;

      // Encrypt the MySQL password before saving
      updatedSettings.commonSettings.mysqlPassword = this.cryptoService.encrypt(updatedSettings.commonSettings.mysqlPassword);

      // Ensure all required keys exist in each instrument setting
      updatedSettings.instrumentsSettings = updatedSettings.instrumentsSettings.map(instrument => {
        const defaultInstrument = {
          analyzerMachineType: '',
          interfaceCommunicationProtocol: '',
          analyzerMachineName: '',
          analyzerMachineHost: '',
          analyzerMachinePort: '',
          interfaceConnectionMode: '',
          displayorder: ''
        };
        return { ...defaultInstrument, ...instrument };
      });


      that.electronStoreService.set('commonConfig', updatedSettings.commonSettings);
      that.electronStoreService.set('instrumentsConfig', updatedSettings.instrumentsSettings);
      console.log('Updated Instruments Settings:', updatedSettings.instrumentsSettings);

      new Notification('Success', {
        body: 'Updated Interface Tool settings'
      });
      that.resetInstrumentVariables();
      that.router.navigate(['/console']);
    } else {
      console.error('Form is not valid');
    }
  }

  checkMysqlConnection() {
    const that = this;
    const commonSettings = that.settingsForm.get('commonSettings').value;
    const mysqlParams = {
      host: commonSettings.mysqlHost,
      user: commonSettings.mysqlUser,
      password: commonSettings.mysqlPassword,
      port: commonSettings.mysqlPort
    };

    that.utilitiesService.checkMysqlConnection(
      mysqlParams,
      () => {
        that.electronService.openDialog('showMessageBox', {
          type: 'info',
          message: 'MySQL Connected successfully. Please click on SAVE SETTINGS to update these settings.'
        });
      },
      (err: string) => {
        that.electronService.openDialog('showMessageBox', {
          type: 'error',
          message: `Unable to connect to MySQL database on host ${commonSettings.mysqlHost}`,
          detail: `${err}\n\nPlease check if all the database connection settings are correct and MySQL server is running.`
        });
      }
    );
  }


  exportSettings() {
    this.electronStoreService.exportSettings();
  }

  importSettings(): void {
    ipcRenderer.invoke('import-settings')
      .then(response => {
        console.log('Import response:', response);
      })
      .catch(err => {
        console.error('Error importing settings:', err);
      });
    ipcRenderer.on('imported-settings', (event, importedSettings) => {
      console.log('Imported Settings:', importedSettings);
      this.updateSettings();
    });
  }

}
