'use client';

import dynamic from 'next/dynamic';
import type { AppState } from '@/lib/domain/types';

const Dashboard = dynamic(() => import('./dashboard').then(module => module.Dashboard), {
  loading: () => <main className="login-page"><p className="loading" role="status">Çalışma alanı yükleniyor…</p></main>,
});

export function DashboardEntry({initialState}: {initialState?: Promise<AppState | null>}) {
  return <Dashboard initialState={initialState} />;
}
