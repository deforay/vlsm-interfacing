import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit {
  public user: { login: string, password: string } = {
    login: '',
    password: ''
  };

  constructor(private router: Router) { 


  }

  ngOnInit() {
  }

  doLogin(){
    if(this.user.login == 'admin' && this.user.password == 'admin'){

      const Store = require('electron-store');
      const store = new Store();

      store.set('loggedin', true);  

      let appSettings = store.get('appSettings');
      if(undefined == appSettings){
        this.router.navigate(['/settings']);
      }else{
        this.router.navigate(['/dashboard']);
      }
      
    }else{
      let myNotification = new Notification('Error', {
        body: 'Oops! Please enter valid login credentials.'
      })      
      this.router.navigate(['']);
    }
    
  }

}
