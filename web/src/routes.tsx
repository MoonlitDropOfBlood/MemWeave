import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { AtlasPage } from './pages/AtlasPage';
import { MemoriesPage } from './pages/MemoriesPage';
import { MemoryDetailPage } from './pages/MemoryDetailPage';
import { GraphPage } from './pages/GraphPage';
import { InjectionPage } from './pages/InjectionPage';
import { SleepPage } from './pages/SleepPage';
import { SettingsPage } from './pages/SettingsPage';
import { NotFoundPage } from './pages/NotFoundPage';

export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <AppShell />,
      children: [
        { index: true, element: <Navigate to="/atlas" replace /> },
        { path: 'atlas', element: <AtlasPage /> },
        { path: 'memories', element: <MemoriesPage /> },
        { path: 'memories/:id', element: <MemoryDetailPage /> },
        { path: 'memories/:id/graph', element: <GraphPage /> },
        { path: 'injection', element: <InjectionPage /> },
        { path: 'sleep', element: <SleepPage /> },
        { path: 'settings', element: <SettingsPage /> },
        { path: '*', element: <NotFoundPage /> }
      ]
    }
  ],
  { basename: '/ui' }
);
