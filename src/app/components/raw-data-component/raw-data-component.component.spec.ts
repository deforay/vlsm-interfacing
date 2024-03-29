import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RawDataComponentComponent } from './raw-data-component.component';

describe('RawDataComponentComponent', () => {
  let component: RawDataComponentComponent;
  let fixture: ComponentFixture<RawDataComponentComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RawDataComponentComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(RawDataComponentComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
