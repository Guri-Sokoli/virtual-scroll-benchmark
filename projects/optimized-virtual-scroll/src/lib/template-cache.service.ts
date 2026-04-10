/**
 * Template Cache Service
 *
 * Manages a pool of detached Angular `EmbeddedViewRef` instances so that
 * views scrolling out of the visible range can be reused rather than
 * being destroyed and recreated. This dramatically reduces garbage
 * collection pressure and DOM allocation overhead during scrolling.
 *
 * The cache operates as a simple LIFO (stack) pool. When a view is no
 * longer visible it is detached from the container and pushed onto the
 * stack. When a new view is needed, the cache pops an existing view,
 * updates its context, and re-attaches it — avoiding template
 * instantiation entirely.
 */

import {
  EmbeddedViewRef,
  Injectable,
  TemplateRef,
  ViewContainerRef,
} from '@angular/core';

/** The shape of the implicit context passed to each template instance. */
export interface VirtualRowContext<T> {
  /** The current item. Accessed via `let item` in the template. */
  $implicit: T;
  /** Same item available as `ovs-virtual-for` microsyntax variable. */
  ovsVirtualFor: T;
  /** The absolute index of the item within the full data array. */
  index: number;
}

@Injectable()
export class TemplateCacheService<T> {
  /** Pool of detached views ready for reuse. */
  private pool: EmbeddedViewRef<VirtualRowContext<T>>[] = [];

  /** Maximum number of detached views to keep alive. */
  private _maxCacheSize = 100;

  /** Current pool size (for diagnostics). */
  get cachedViewCount(): number {
    return this.pool.length;
  }

  set maxCacheSize(value: number) {
    this._maxCacheSize = Math.max(0, value);
    this.trimPool();
  }

  /**
   * Obtain a view — either recycled from the pool or freshly created.
   * The returned view's context is updated to reflect the provided item
   * and index. An optional `containerIndex` keeps views in correct DOM order.
   */
  obtainView(
    template: TemplateRef<VirtualRowContext<T>>,
    container: ViewContainerRef,
    item: T,
    index: number,
    containerIndex?: number,
  ): EmbeddedViewRef<VirtualRowContext<T>> {
    const ctx: VirtualRowContext<T> = {
      $implicit: item,
      ovsVirtualFor: item,
      index,
    };

    const cached = this.pool.pop();

    if (cached) {
      // Reuse existing view — update context
      cached.context.$implicit = item;
      cached.context.ovsVirtualFor = item;
      cached.context.index = index;
      container.insert(cached, containerIndex);
      // Apply context changes immediately; scroll updates run outside Angular zone.
      cached.detectChanges();
      return cached;
    }

    // Create a fresh view at the correct position
    return container.createEmbeddedView(
      template,
      ctx,
      containerIndex !== undefined ? { index: containerIndex } : undefined,
    );
  }

  /**
   * Return a view to the pool for later reuse.
   * The view is detached (not destroyed) from the DOM.
   */
  recycle(
    view: EmbeddedViewRef<VirtualRowContext<T>>,
    container: ViewContainerRef,
  ): void {
    const viewIndex = container.indexOf(view);
    if (viewIndex !== -1) {
      container.detach(viewIndex);
    }

    if (this.pool.length < this._maxCacheSize) {
      this.pool.push(view);
    } else {
      view.destroy();
    }
  }

  /** Destroy all cached views and clear the pool. */
  clear(): void {
    for (const view of this.pool) {
      view.destroy();
    }
    this.pool.length = 0;
  }

  /** Trim pool to max cache size, destroying excess views. */
  private trimPool(): void {
    while (this.pool.length > this._maxCacheSize) {
      const view = this.pool.pop();
      view?.destroy();
    }
  }
}
