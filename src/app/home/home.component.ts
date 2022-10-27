import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ElectronStoreService } from '../services/electron-store.service';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit {
  public settings: any = {};
  public user: { login: string; password: string } = {
    login: '',
    password: ''
  };
  constructor(private router: Router, private store: ElectronStoreService) {
    this.settings = this.store.get('appSettings');

    console.error(this.settings.interfaceAutoConnect);

    if (this.settings.interfaceAutoConnect === 'yes') {
      this.doLogin();
    }
  }

  ngOnInit(): void {
  }

  public doLogin() {
    if (this.settings.interfaceAutoConnect === 'yes' || (this.user.login === 'admin' && this.user.password === 'admin')) {

      this.store.set('loggedin', true);

      if (undefined === this.settings) {
        this.router.navigate(['/settings']);
      } else {
        this.router.navigate(['/dashboard']);
      }

    } else {
      const myNotification = new Notification('Error', {
        body: 'Oops! Please enter valid login credentials.'
      });
      this.router.navigate(['']);
    }

  }

}
