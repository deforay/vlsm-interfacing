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
import { ConnectionManagerService } from '../../services/connection-manager.service';
import { Subscription } from 'rxjs';
import { DatabaseService } from '../../services/database.service';

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
  public availableInstruments = [];
  private instrumentsSubscription: Subscription;

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly electronService: ElectronService,
    private readonly router: Router,
    private readonly electronStoreService: ElectronStoreService,
    private readonly utilitiesService: UtilitiesService,
    private readonly cryptoService: CryptoService,
    private connectionManagerService: ConnectionManagerService,
    private readonly databaseService: DatabaseService
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
        mysqlPort: ['', [
          Validators.pattern('^[0-9]+$'),
          (control) => {
            const value = control.value;
            if (!value) return null; // Allow empty value since MySQL is optional
            const portNum = parseInt(value);
            return (isNaN(portNum) || portNum < 1 || portNum > 65535) ? { pattern: true } : null;
          }
        ]],
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


  ngOnInit(): void {
    // Subscribe to instrument status
    this.instrumentsSubscription = this.connectionManagerService.getActiveInstruments()
      .subscribe(instruments => {
        this.availableInstruments = instruments;
      });
  }

  uniqueInstrumentNameValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const instrumentsSettings = control.get('instrumentsSettings') as FormArray;
      const duplicateIndexes = this.findDuplicates(
        instrumentsSettings.value.map(instrument => instrument.analyzerMachineName)
      );
      duplicateIndexes.forEach(index => {
        instrumentsSettings.at(index).get('analyzerMachineName').setErrors({ 'duplicateInstrumentName': true });
      });
      return null;
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
      return null;
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

  public async forceRerunMigrations(): Promise<void> {
    try {
      const result = await this.electronService.ipcRenderer.invoke('show-confirm-dialog', {
        type: 'warning',
        buttons: ['Cancel', 'Yes, Proceed'],
        defaultId: 0,
        title: 'Confirm Migration Reset',
        message: 'Are you sure you want to force re-run all migrations?',
        detail: 'This action is irreversible. It will delete the migration history from both the local and server databases and restart the application. All migrations will be re-applied on startup.'
      });

      if (result.response === 1) { // Corresponds to 'Yes, Proceed'
        try {
          await this.databaseService.dropMySQLVersionsTable().toPromise();
          // On successful drop of MySQL table, trigger the main process to handle the rest
          this.electronService.ipcRenderer.send('force-rerun-migrations');
        } catch (err) {
          // If MySQL is not connected or there's an error, ask user if they want to proceed
          const errorResult = await this.electronService.ipcRenderer.invoke('show-confirm-dialog', {
            type: 'error',
            buttons: ['Cancel', 'Proceed Anyway'],
            defaultId: 0,
            title: 'MySQL Error',
            message: 'Could not drop the versions table on the MySQL server. This might be because MySQL is not configured or is unreachable.',
            detail: `Error: ${err.message}\n\nDo you want to proceed with resetting the local database only?`
          });

          if (errorResult.response === 1) { // 'Proceed Anyway'
            this.electronService.ipcRenderer.send('force-rerun-migrations');
          }
        }
      }
    } catch (error) {
      console.error('Error showing confirmation dialog:', error);
    }
  }


  createInstrumentFormGroup(): FormGroup {
    const instrumentId = uuidv4();
    return this.formBuilder.group({
      id: instrumentId,
      analyzerMachineType: ['', Validators.required],
      interfaceCommunicationProtocol: ['', Validators.required],
      analyzerMachineName: ['', Validators.required],
      analyzerMachineHost: ['', Validators.required],
      analyzerMachinePort: ['', [
        Validators.required,
        Validators.pattern('^[0-9]+$'),
        (control) => {
          const value = control.value;
          if (!value) return null;
          const portNum = parseInt(value);
          return (isNaN(portNum) || portNum < 1 || portNum > 65535) ? { pattern: true } : null;
        }
      ]],
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
    const newInstrument = this.formBuilder.group({
      analyzerMachineType: ['', Validators.required],
      interfaceCommunicationProtocol: ['', Validators.required],
      analyzerMachineName: ['', Validators.required],
      analyzerMachineHost: ['', Validators.required],
      analyzerMachinePort: ['', [
        Validators.required,
        Validators.pattern('^[0-9]+$'),
        (control) => {
          const value = control.value;
          if (!value) return null;
          const portNum = parseInt(value);
          return (isNaN(portNum) || portNum < 1 || portNum > 65535) ? { pattern: true } : null;
        }
      ]],
      interfaceConnectionMode: ['', Validators.required],
      displayorder: ['']
    });

    this.instrumentsSettings.push(newInstrument);
  }

  confirmRemoval(index: number, analyzerMachineName: string, event: Event): void {
    event.preventDefault();
    const confirmed = window.confirm(`Are you sure you want to remove ${analyzerMachineName}?`);
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
      // Store the form values before disconnecting instruments
      const updatedSettings = JSON.parse(JSON.stringify(that.settingsForm.value));

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

      // Show save in progress notification
      const savingNotification = document.createElement('div');
      savingNotification.textContent = 'Saving settings...';
      savingNotification.style.position = 'fixed';
      savingNotification.style.top = '20px';
      savingNotification.style.left = '50%';
      savingNotification.style.transform = 'translateX(-50%)';
      savingNotification.style.padding = '8px 16px';
      savingNotification.style.backgroundColor = 'rgba(0,0,0,0.7)';
      savingNotification.style.color = 'white';
      savingNotification.style.borderRadius = '4px';
      savingNotification.style.zIndex = '1000';
      document.body.appendChild(savingNotification);

      // First, disconnect all instruments if settings are being updated
      // This ensures clean connection state when settings change
      const activeInstruments = Array.from(this.availableInstruments);
      const disconnectPromises = activeInstruments
        .filter(instrument => instrument.isConnected)
        .map(instrument => {
          return new Promise<void>(resolve => {
            this.connectionManagerService.disconnect(instrument);
            // Resolve after a short delay to ensure disconnect has time to process
            setTimeout(() => resolve(), 100);
          });
        });

      // Wait for all disconnections to complete
      Promise.all(disconnectPromises).then(() => {
        // Save settings to electron store
        that.electronStoreService.set('commonConfig', updatedSettings.commonSettings);
        that.electronStoreService.set('instrumentsConfig', updatedSettings.instrumentsSettings);

        // Remove the saving notification
        document.body.removeChild(savingNotification);

        // Show success notification
        new window.Notification('Success', {
          body: 'Updated Interface Tool settings'
        });

        // IMPORTANT: Set a flag in localStorage to indicate we're returning from settings
        localStorage.setItem('returnFromSettings', 'true');

        // IMPORTANT: Also set a session storage key as a backup (sometimes localStorage survives refreshes)
        sessionStorage.setItem('returnFromSettings', 'true');

        // Set a global variable as a backup (window level)
        (window as any).returnFromSettings = true;

        // Navigate back to console after a brief delay to allow settings to take effect
        setTimeout(() => {
          that.router.navigate(['/console'], {
            state: { returnFromSettings: true }
          });
        }, 500);
      });
    } else {
      console.error('Unable to update settings.');

      // Show validation errors
      const controlsWithErrors = this.findInvalidControls(this.settingsForm);
      console.log('Fields with validation errors:', controlsWithErrors);

      // Highlight invalid fields (optional)
      this.markInvalidControlsAsTouched(this.settingsForm);

      // Show error notification
      const errorNotification = document.createElement('div');
      errorNotification.textContent = 'Please fix the validation errors before saving';
      errorNotification.style.position = 'fixed';
      errorNotification.style.top = '20px';
      errorNotification.style.left = '50%';
      errorNotification.style.transform = 'translateX(-50%)';
      errorNotification.style.padding = '8px 16px';
      errorNotification.style.backgroundColor = 'rgba(220,53,69,0.9)';
      errorNotification.style.color = 'white';
      errorNotification.style.borderRadius = '4px';
      errorNotification.style.zIndex = '1000';
      document.body.appendChild(errorNotification);

      setTimeout(() => {
        document.body.removeChild(errorNotification);
      }, 5000);
    }
  }

  // Helper method to find invalid controls
  findInvalidControls(formGroup: FormGroup | FormArray): string[] {
    const invalid = [];
    const controls = formGroup.controls;

    for (const name in controls) {
      if (controls[name].invalid) {
        if (controls[name] instanceof FormGroup || controls[name] instanceof FormArray) {
          const childInvalid = this.findInvalidControls(controls[name] as FormGroup | FormArray);
          if (childInvalid.length > 0) {
            invalid.push(`${name} (${childInvalid.join(', ')})`);
          }
        } else {
          invalid.push(name);
        }
      }
    }

    return invalid;
  }

  // Helper method to mark all controls as touched to show validation errors
  markInvalidControlsAsTouched(formGroup: FormGroup | FormArray) {
    Object.keys(formGroup.controls).forEach(key => {
      const control = formGroup.get(key);

      if (control instanceof FormGroup || control instanceof FormArray) {
        this.markInvalidControlsAsTouched(control);
      } else if (control.invalid) {
        control.markAsTouched();
      }
    });
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
  cleanPortNumber(event: any, index: any): void {
    const input = event.target;
    const originalValue = input.value;

    // Remove non-numeric characters
    const numericValue = originalValue.replace(/[^0-9]/g, '');

    // If the value changed (non-numeric characters were found)
    if (originalValue !== numericValue) {
      // Get current cursor position
      const start = input.selectionStart;

      // Update the form control value based on whether this is an instrument port or MySQL port
      if (index === 'mysqlPort') {
        this.settingsForm.get('commonSettings.mysqlPort').setValue(numericValue);
      } else {
        this.instrumentsSettings.at(index).get('analyzerMachinePort').setValue(numericValue);
      }

      // After Angular updates the DOM, restore cursor position
      setTimeout(() => {
        // Adjust cursor position based on how many characters were removed
        const newPosition = Math.max(0, start - (originalValue.length - numericValue.length));
        input.setSelectionRange(newPosition, newPosition);
      }, 0);
    }

    // Validate range (1-65535)
    if (numericValue) {
      const portNum = parseInt(numericValue);
      if (portNum < 1 || portNum > 65535) {
        if (index === 'mysqlPort') {
          this.settingsForm.get('commonSettings.mysqlPort').setErrors({ pattern: true });
        } else {
          this.instrumentsSettings.at(index).get('analyzerMachinePort').setErrors({ pattern: true });
        }
      }
    }
  }

  // Add to your SettingsComponent class
  copyToClipboard(text: string): void {
    navigator.clipboard.writeText(text)
      .then(() => {
        // Optional: show a small notification that copying was successful
        const notification = document.createElement('div');
        notification.textContent = 'Copied to clipboard!';
        notification.style.position = 'fixed';
        notification.style.bottom = '20px';
        notification.style.left = '50%';
        notification.style.transform = 'translateX(-50%)';
        notification.style.padding = '8px 16px';
        notification.style.backgroundColor = 'rgba(0,0,0,0.7)';
        notification.style.color = 'white';
        notification.style.borderRadius = '4px';
        notification.style.zIndex = '1000';

        document.body.appendChild(notification);

        setTimeout(() => {
          document.body.removeChild(notification);
        }, 2000);
      })
      .catch(err => {
        console.error('Could not copy text: ', err);
      });
  }

  // Password visibility toggle
  togglePasswordVisibility(): void {
    const passwordField = document.querySelector('[name=mysqlPassword]') as HTMLInputElement;
    if (passwordField) {
      passwordField.type = passwordField.type === 'password' ? 'text' : 'password';
    }
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
