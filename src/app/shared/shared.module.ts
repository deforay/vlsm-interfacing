import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { TranslateDirective, TranslatePipe } from '@ngx-translate/core';

import { PageNotFoundComponent } from './components/';
import { WebviewDirective } from './directives/';
import { FormsModule } from '@angular/forms';

@NgModule({
  declarations: [PageNotFoundComponent, WebviewDirective],
  imports: [CommonModule, TranslatePipe, TranslateDirective, FormsModule],
  exports: [TranslatePipe, TranslateDirective, WebviewDirective, FormsModule]
})
export class SharedModule {}
