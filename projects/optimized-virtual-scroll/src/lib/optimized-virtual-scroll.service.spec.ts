import { TestBed } from '@angular/core/testing';

import { OptimizedVirtualScrollService } from './optimized-virtual-scroll.service';

describe('OptimizedVirtualScrollService', () => {
  let service: OptimizedVirtualScrollService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(OptimizedVirtualScrollService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
