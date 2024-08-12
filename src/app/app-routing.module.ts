import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { PageNotFoundComponent } from './shared/components';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { HomeRoutingModule } from './home/home-routing.module';
import { ConsoleComponent } from './components/console/console.component';
import { RawDataComponentComponent } from './components/raw-data-component/raw-data-component.component';
import { SettingsComponent } from './components/settings/settings.component';

const routes: Routes = [
  {
    path: '',
    redirectTo: 'home',
    pathMatch: 'full'
  },
  {
    path: 'dashboard',
    component: DashboardComponent
  },
  {
    path: 'console',
    component: ConsoleComponent
  },
  {
    path: 'settings',
    component: SettingsComponent
  },
  {
    path: 'raw-data-component',
    component: RawDataComponentComponent
  },
  {
    path: '**',
    component: PageNotFoundComponent
  }
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, {}),
    HomeRoutingModule
  ],
  exports: [RouterModule]
})
export class AppRoutingModule { }
