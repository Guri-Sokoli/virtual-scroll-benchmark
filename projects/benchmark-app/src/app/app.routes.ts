import { Routes } from '@angular/router';
import { CdkBenchmarkComponent } from './pages/cdk-benchmark.component';
import { OptimizedBenchmarkComponent } from './pages/optimized-benchmark.component';
import { DemoComponent } from './pages/demo.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'demo' },
  { path: 'demo', component: DemoComponent },
  { path: 'cdk', component: CdkBenchmarkComponent },
  { path: 'optimized', component: OptimizedBenchmarkComponent },
];
