import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ElectronStoreService } from '../services/electron-store.service';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit {
  public user: { login: string; password: string } = {
    login: '',
    password: ''
  };
  constructor(private router: Router, private store: ElectronStoreService) { }

  ngOnInit(): void {
  }

  public doLogin() {
    if (this.user.login === 'admin' && this.user.password === 'admin') {

      this.store.set('loggedin', true);

      const appSettings = this.store.get('appSettings');

      if (undefined === appSettings) {
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
