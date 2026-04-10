/**
 * Unit Tests: TemplateCacheService
 *
 * Tests the view recycling pool for correctness:
 * - View creation when pool is empty
 * - View reuse from pool
 * - Pool size limits
 * - Context updates on reuse
 * - Cleanup behavior
 */

import { Component, TemplateRef, ViewChild, ViewContainerRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TemplateCacheService, VirtualRowContext } from './template-cache.service';

// Minimal host component to get a real TemplateRef and ViewContainerRef
@Component({
  standalone: true,
  template: `
    <ng-template #rowTemplate let-item>
      <div>{{ item.label }}</div>
    </ng-template>
    <div #container></div>
  `,
})
class TestHostComponent {
  @ViewChild('rowTemplate', { static: true })
  template!: TemplateRef<VirtualRowContext<any>>;

  @ViewChild('container', { read: ViewContainerRef, static: true })
  container!: ViewContainerRef;
}

describe('TemplateCacheService', () => {
  let service: TemplateCacheService<{ id: number; label: string }>;
  let host: TestHostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [TemplateCacheService],
    }).compileComponents();

    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
    host = fixture.componentInstance;
    service = TestBed.inject(TemplateCacheService);
  });

  it('should start with empty pool', () => {
    expect(service.cachedViewCount).toBe(0);
  });

  it('should create a new view when pool is empty', () => {
    const view = service.obtainView(
      host.template,
      host.container,
      { id: 0, label: 'Item 0' },
      0,
    );

    expect(view).toBeTruthy();
    expect(view.context.$implicit.id).toBe(0);
    expect(view.context.index).toBe(0);
  });

  it('should reuse a recycled view instead of creating new', () => {
    // Create and recycle a view
    const view1 = service.obtainView(
      host.template,
      host.container,
      { id: 0, label: 'Item 0' },
      0,
    );
    service.recycle(view1, host.container);
    expect(service.cachedViewCount).toBe(1);

    // Obtain again — should reuse
    const view2 = service.obtainView(
      host.template,
      host.container,
      { id: 1, label: 'Item 1' },
      1,
    );

    expect(service.cachedViewCount).toBe(0); // pool emptied
    expect(view2.context.$implicit.id).toBe(1); // context updated
    expect(view2.context.index).toBe(1);
  });

  it('should update context when reusing view', () => {
    const view = service.obtainView(
      host.template,
      host.container,
      { id: 0, label: 'First' },
      0,
    );

    expect(view.context.$implicit.label).toBe('First');

    service.recycle(view, host.container);

    const reused = service.obtainView(
      host.template,
      host.container,
      { id: 99, label: 'Updated' },
      99,
    );

    expect(reused.context.$implicit.label).toBe('Updated');
    expect(reused.context.$implicit.id).toBe(99);
    expect(reused.context.index).toBe(99);
    expect(reused.context.ovsVirtualFor.id).toBe(99);
  });

  it('should respect maxCacheSize', () => {
    service.maxCacheSize = 3;

    // Create 5 views
    const views = [];
    for (let i = 0; i < 5; i++) {
      views.push(
        service.obtainView(
          host.template,
          host.container,
          { id: i, label: `Item ${i}` },
          i,
        ),
      );
    }

    // Recycle all 5 — only 3 should be kept
    for (const v of views) {
      service.recycle(v, host.container);
    }

    expect(service.cachedViewCount).toBe(3);
  });

  it('should clear all cached views', () => {
    // Create all views first
    const views = [];
    for (let i = 0; i < 5; i++) {
      views.push(
        service.obtainView(
          host.template,
          host.container,
          { id: i, label: `Item ${i}` },
          i,
        ),
      );
    }

    // Then recycle all
    for (const v of views) {
      service.recycle(v, host.container);
    }

    expect(service.cachedViewCount).toBe(5);
    service.clear();
    expect(service.cachedViewCount).toBe(0);
  });

  it('should handle rapid create-recycle-reuse cycles', () => {
    // Simulate scrolling: create views, recycle them, create new ones
    for (let cycle = 0; cycle < 10; cycle++) {
      const views = [];
      for (let i = 0; i < 5; i++) {
        views.push(
          service.obtainView(
            host.template,
            host.container,
            { id: cycle * 5 + i, label: `Item ${cycle * 5 + i}` },
            cycle * 5 + i,
          ),
        );
      }
      for (const v of views) {
        service.recycle(v, host.container);
      }
    }

    // Pool should have accumulated views (up to max)
    expect(service.cachedViewCount).toBeLessThanOrEqual(100);
    expect(service.cachedViewCount).toBeGreaterThan(0);
  });

  it('should insert view at correct container index', () => {
    // Create views at specific positions
    const view0 = service.obtainView(
      host.template,
      host.container,
      { id: 0, label: 'A' },
      0,
      0, // containerIndex
    );
    const view1 = service.obtainView(
      host.template,
      host.container,
      { id: 1, label: 'B' },
      1,
      1,
    );

    expect(host.container.length).toBe(2);
    expect(host.container.indexOf(view0)).toBe(0);
    expect(host.container.indexOf(view1)).toBe(1);
  });
});
