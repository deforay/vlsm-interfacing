import { TestBed } from '@angular/core/testing';

import { CobasService } from './cobas.service';

describe('CobasService', () => {
  beforeEach(() => TestBed.configureTestingModule({}));

  it('should be created', () => {
    const service: CobasService = TestBed.get(CobasService);
    expect(service).toBeTruthy();
  });
});
