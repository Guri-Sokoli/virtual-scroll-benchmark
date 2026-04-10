import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <main class="app-shell">
      <header class="topbar">
        <h1>Virtual Scroll Benchmark Kit</h1>
        <nav>
          <a routerLink="/demo" routerLinkActive="active">🎯 Live Demo</a>
          <a routerLink="/cdk" routerLinkActive="active">CDK Baseline</a>
          <a routerLink="/optimized" routerLinkActive="active">Optimized</a>
        </nav>
      </header>

      <section class="controls">
        <strong>Presets:</strong>
        @for (p of presets; track p.label) {
          <a [routerLink]="'/cdk'" [queryParams]="p.query">CDK {{ p.label }}</a>
          <a [routerLink]="'/optimized'" [queryParams]="p.query">Opt {{ p.label }}</a>
        }
      </section>

      <section class="hint">
        Query string: <code>size</code>, <code>itemHeight</code>,
        <code>viewportHeight</code>, <code>dynamic</code>, <code>maxCanvasHeight</code>.
      </section>

      <section class="content">
        <router-outlet />
      </section>
    </main>
  `,
  styles: [`
    .app-shell { font-family: system-ui, sans-serif; padding: 16px; max-width: 960px; margin: 0 auto; }
    .topbar { display: flex; align-items: center; gap: 24px; margin-bottom: 8px; }
    .topbar h1 { font-size: 18px; margin: 0; }
    .topbar nav { display: flex; gap: 12px; }
    .topbar nav a { text-decoration: none; color: #475569; padding: 4px 8px; border-radius: 4px; font-size: 13px; }
    .topbar nav a.active { background: #e0e7ff; color: #3730a3; font-weight: 600; }
    .controls { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 8px 0; font-size: 12px; }
    .controls a { padding: 3px 8px; border: 1px solid #cbd5e1; border-radius: 4px; text-decoration: none; color: #475569; }
    .controls a:hover { background: #f1f5f9; }
    .hint { font-size: 11px; color: #94a3b8; margin-bottom: 12px; }
    .hint code { background: #f1f5f9; padding: 1px 4px; border-radius: 2px; }
    .content { margin-top: 8px; }
  `],
})
export class AppComponent {
  readonly presets = [
    { label: '10k',  query: { size: 10000,  itemHeight: 32, viewportHeight: 560, dynamic: 0 } },
    { label: '50k',  query: { size: 50000,  itemHeight: 32, viewportHeight: 560, dynamic: 0 } },
    { label: '100k', query: { size: 100000, itemHeight: 32, viewportHeight: 560, dynamic: 0 } },
    { label: '50k dyn', query: { size: 50000, itemHeight: 32, viewportHeight: 560, dynamic: 1 } },
  ];
}
