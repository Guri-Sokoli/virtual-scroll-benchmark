/**
 * Unit Tests: OvsVirtualScrollViewportComponent
 *
 * Integration tests for the viewport component with the directive.
 */

import { Component } from '@angular/core';
import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { OvsVirtualScrollViewportComponent } from './optimized-virtual-scroll.component';
import { OvsVirtualForDirective } from './virtual-for.directive';

@Component({
  standalone: true,
  imports: [OvsVirtualScrollViewportComponent, OvsVirtualForDirective],
  template: `
    <ovs-virtual-scroll-viewport
      [itemCount]="items.length"
      [itemHeight]="32"
      [viewportHeight]="320"
    >
      <div
        *ovsVirtualFor="let item of items; trackBy: trackById"
        [style.height.px]="32"
      >
        {{ item.label }}
      </div>
    </ovs-virtual-scroll-viewport>
  `,
})
class TestHostComponent {
  items = Array.from({ length: 100 }, (_, i) => ({ id: i, label: `Item ${i}` }));
  trackById = (_: number, item: { id: number }) => item.id;
}

describe('OvsVirtualScrollViewportComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
  });

  it('should create the viewport', () => {
    const viewport = fixture.nativeElement.querySelector('ovs-virtual-scroll-viewport');
    expect(viewport).toBeTruthy();
  });

  it('should render the viewport container with correct height', () => {
    const viewportEl = fixture.nativeElement.querySelector('[data-testid="viewport-optimized"]');
    expect(viewportEl).toBeTruthy();
    expect(viewportEl.style.height).toBe('320px');
  });

  it('should render visible rows', () => {
    const rows = fixture.nativeElement.querySelectorAll('[data-testid="viewport-optimized"] div div div');
    // 320px viewport / 32px items = 10 visible + buffer
    expect(rows.length).toBeGreaterThan(0);
  });

  it('should have a spacer element for scroll height', () => {
    const spacer = fixture.nativeElement.querySelector('.ovs-spacer');
    expect(spacer).toBeTruthy();
    // 100 items × 32px = 3200px total
    const spacerHeight = parseInt(spacer.style.height, 10);
    expect(spacerHeight).toBe(3200);
  });

  it('should update when items array changes', () => {
    fixture.componentInstance.items = Array.from(
      { length: 200 },
      (_, i) => ({ id: i, label: `New Item ${i}` }),
    );
    fixture.detectChanges();

    const spacer = fixture.nativeElement.querySelector('.ovs-spacer');
    const spacerHeight = parseInt(spacer.style.height, 10);
    expect(spacerHeight).toBe(6400); // 200 × 32
  });

  it('should keep rows rendered after a large scrollbar jump', fakeAsync(() => {
    const viewportEl = fixture.nativeElement.querySelector('[data-testid="viewport-optimized"]') as HTMLElement;
    expect(viewportEl).toBeTruthy();

    // Simulate an aggressive thumb drag to a far position.
    viewportEl.scrollTop = 2200;
    viewportEl.dispatchEvent(new Event('scroll'));

    tick(32);
    fixture.detectChanges();

    const rows = viewportEl.querySelectorAll('.ovs-content > div');
    expect(rows.length).toBeGreaterThan(0);

    const anyRowHasText = Array.from(rows).some((row) => (row.textContent ?? '').includes('Item'));
    expect(anyRowHasText).toBeTrue();
  }));

  it('should keep visible rows populated during rapid successive scrollbar jumps', fakeAsync(() => {
    const viewportEl = fixture.nativeElement.querySelector('[data-testid="viewport-optimized"]') as HTMLElement;
    expect(viewportEl).toBeTruthy();

    const jumpPositions = [0, 1440, 2720, 960, 2880, 320, 2400, 80];

    for (const top of jumpPositions) {
      viewportEl.scrollTop = top;
      viewportEl.dispatchEvent(new Event('scroll'));

      tick(20);
      fixture.detectChanges();

      const rows = viewportEl.querySelectorAll('.ovs-content > div');
      expect(rows.length).toBeGreaterThan(0);

      const populatedRows = Array.from(rows).filter(
        (row) => (row.textContent ?? '').trim().length > 0,
      );
      expect(populatedRows.length).toBeGreaterThan(0);
    }
  }));
});
