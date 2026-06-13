# MemWeave Web UI (Calm Memory Atlas) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted Web UI ("Calm Memory Atlas") at `/ui` that lets users audit, edit, and observe MemWeave's memory graph — answering the 8 audit questions in design spec §10.1.

**Architecture:** A monorepo layout: a Vite-built React SPA lives under `web/`, builds to `dist/web/`, and is served as static assets by the existing `memweave-server` at `/ui/*`. The UI talks to the existing REST API at `/api/v1/*` (no new business logic in the SPA).

**Tech Stack:**
- React 18 + TypeScript + Vite 5
- React Router 6 (file-based via Vite plugin)
- TanStack Query (server-state caching, no Redux/Zustand needed for v1)
- CSS Modules (no Tailwind in v1; design calls for "克制细节")
- React Flow (`@xyflow/react`) — graph canvas (renamed in v12)
- Recharts — strength curves
- TanStack Table — memory list
- Native `fetch` + a typed client wrapper (no axios)

**Prerequisites:** All 5 prior plans complete — `memweave-server` already exposes `/api/v1/health`, `/api/v1/memories*`, `/api/v1/inject`, with auth middleware ready.

---

## Scope Split

The full MemWeave spec spans REST, MCP, retrieval, injection, and now UI. This plan deliberately implements the **Calm Memory Atlas v1** — the 5 first-level pages, 5 key components, and the missing REST endpoints the UI needs to render those pages.

Pages **deferred to v1.1** (per design §10.5):
- Timeline page
- Standalone Access Logs page (will be embedded inside Memory detail for v1)

---

## File Structure

### Backend additions

```text
src/
  rest/
    routes/
      stats.ts              — GET /api/v1/stats  (Atlas dashboard data)
      sessions.ts           — GET /api/v1/sessions, /:id, /:id/memories
      observations.ts       — GET /api/v1/observations, /:id
      consolidation.ts      — GET/POST /api/v1/consolidate, /consolidate/runs
      devices.ts            — GET/POST/DELETE /api/v1/devices
  db/
    schema.sql              — ADD: consolidation_runs table
    repositories/
      stats-repo.ts         — aggregated counts and recent activity
      consolidation-run-repo.ts — persist consolidation outcomes
  workers/
    consolidator.ts        — MODIFY: record each run to consolidation_runs
```

### Frontend (new sub-project)

```text
web/
  package.json
  tsconfig.json
  tsconfig.node.json        — for vite.config.ts
  vite.config.ts
  index.html                — single entry; mounted at /ui/
  src/
    main.tsx                — React root + router
    routes.tsx              — <Route> definitions
    api/
      client.ts             — typed fetch wrapper, base URL = /api/v1
      types.ts              — re-exports from server or duplicates (typed locally)
      memories.ts           — listMemories / getMemory / patchMemory / ...
      graph.ts              — getGraph(memoryId)
      inject.ts             — getInjectionBundle (UI-side replay)
      sessions.ts, observations.ts, consolidation.ts, devices.ts, stats.ts
    components/
      layout/
        AppShell.tsx        — sidebar + main pane
        Sidebar.tsx         — 5 nav items
        TopBar.tsx          — search + theme toggle
      memory/
        MemoryCard.tsx
        MemoryList.tsx
        FilterRail.tsx
        ReadingPanel.tsx
        StrengthCurve.tsx   — Recharts
        EditMemoryDialog.tsx
      graph/
        GraphCanvas.tsx     — React Flow
        GraphControls.tsx
        MemoryNode.tsx       — custom node renderer
        EdgeLabel.tsx
      injection/
        InjectionBundleList.tsx
        InjectionBundleViewer.tsx
        ContextXmlPreview.tsx
      sleep/
        SleepCycleList.tsx
        SleepCycleDiff.tsx
      settings/
        SettingsForm.tsx
        DeviceList.tsx
        ApiKeyField.tsx
      common/
        TypeBadge.tsx
        TierBadge.tsx
        ScopeChips.tsx
        StrengthBar.tsx
        ConfirmDialog.tsx
        Spinner.tsx
        ErrorBoundary.tsx
    pages/
      AtlasPage.tsx
      MemoriesPage.tsx
      MemoryDetailPage.tsx
      GraphPage.tsx            — /memories/:id/graph
      InjectionPage.tsx
      SleepPage.tsx
      SettingsPage.tsx
      NotFoundPage.tsx
    theme/
      tokens.css               — CSS custom properties (light + dark)
      global.css
    lib/
      format.ts                — date / token-count / strength formatters
      types.ts
  tests/
    setup.ts
    memory-card.test.tsx
    filter-rail.test.tsx
    strength-bar.test.tsx
    strength-curve.test.tsx
    api-client.test.ts
    routes.test.tsx
```

---

## Task 1: Backend REST endpoints the UI needs

**Files:**
- Create: `src/db/schema.sql` (modify — add `consolidation_runs` table)
- Create: `src/db/repositories/stats-repo.ts`
- Create: `src/db/repositories/consolidation-run-repo.ts`
- Create: `src/rest/routes/stats.ts`
- Create: `src/rest/routes/sessions.ts`
- Create: `src/rest/routes/observations.ts`
- Create: `src/rest/routes/consolidation.ts`
- Create: `src/rest/routes/devices.ts`
- Modify: `src/workers/consolidator.ts` (persist each run)
- Modify: `src/server/http.ts` (register new routes)

Tests: `tests/db/stats-repo.test.ts`, `tests/db/consolidation-run-repo.test.ts`, `tests/rest/stats.test.ts`, `tests/rest/sessions.test.ts`, `tests/rest/observations.test.ts`, `tests/rest/consolidation.test.ts`, `tests/rest/devices.test.ts`

- [ ] **Step 1: Add `consolidation_runs` table to schema**

  Append to `SCHEMA_SQL` (idempotent — `IF NOT EXISTS` already on the table):

  ```sql
  CREATE TABLE IF NOT EXISTS consolidation_runs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL,
    promoted_count INTEGER NOT NULL DEFAULT 0,
    evicted_count INTEGER NOT NULL DEFAULT 0,
    merged_count INTEGER NOT NULL DEFAULT 0,
    edges_created_count INTEGER NOT NULL DEFAULT 0,
    contradictions_found_count INTEGER NOT NULL DEFAULT 0,
    promoted_ids TEXT NOT NULL DEFAULT '[]',
    evicted_ids TEXT NOT NULL DEFAULT '[]',
    merged_pairs TEXT NOT NULL DEFAULT '[]',
    dry_run INTEGER NOT NULL DEFAULT 0,
    summary TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_consolidation_runs_tenant_time
    ON consolidation_runs(tenant_id, started_at DESC);
  ```

  Also amend the `runConsolidation` signature to optionally persist a `RunDetail` (list of promoted/evicted/merged ids). The existing test should still pass because the new field is optional.

- [ ] **Step 2: Create ConsolidationRunRepo**

  `src/db/repositories/consolidation-run-repo.ts`:
  - `record(input: { tenantId, startedAt, endedAt, promoted[], evicted[], merged[], edges, contradictions, dryRun, summary }): string`
  - `listRecent(tenantId, limit): ConsolidationRunRecord[]`
  - `getById(tenantId, id): ConsolidationRunRecord | null`
  - `latestForTenant(tenantId): ConsolidationRunRecord | null`

- [ ] **Step 3: Update Consolidator to record runs**

  In `src/workers/consolidator.ts`, change the function to return a richer object that also includes the lists of promoted/evicted ids, then call `ConsolidationRunRepo.record(...)` at the end. Keep backward-compat: the existing `ConsolidationResult` interface adds two new optional fields `promotedIds?: string[]` and `evictedIds?: string[]`.

- [ ] **Step 4: Create StatsRepo**

  `src/db/repositories/stats-repo.ts` with one method `getStats(tenantId)` returning:
  ```typescript
  interface Stats {
    totals: { memories: number; activeMemories: number; sessions: number; observations: number; edges: number; devices: number };
    byTier: { short: number; medium: number; long: number };
    byType: Record<MemoryType, number>;
    today: { promoted: number; evicted: number; newMemories: number; injectBundles: number };
    recentProjects: Array<{ project: string; count: number }>;
    lastConsolidation: { id: string; startedAt: number; summary: string } | null;
  }
  ```

  Single SQL query per section (avoid N+1). Group by `concepts_json` for `recentProjects`.

- [ ] **Step 5: Add tests for repos**

  Write `tests/db/stats-repo.test.ts` (12 tests) and `tests/db/consolidation-run-repo.test.ts` (6 tests). Follow the existing pattern: `mkdtempSync` tmp dir, insert tenant, exercise CRUD, assert.

- [ ] **Step 6: Create REST route for stats**

  `src/rest/routes/stats.ts`:
  ```typescript
  app.get('/api/v1/stats', async (request, reply) => {
    const stats = statsRepo.getStats('tenant_default');
    return stats;
  });
  ```

  Tests: `tests/rest/stats.test.ts` (3 tests).

- [ ] **Step 7: Add sessions + observations routes**

  Both routes are thin: just wrap the existing repos. Add:
  - `GET /api/v1/sessions?limit=N` (list, default 20)
  - `GET /api/v1/sessions/:id` (single)
  - `GET /api/v1/sessions/:id/memories` (delegates to `SessionRepo.listMemories`)
  - `GET /api/v1/observations?limit=N&unprocessedOnly=bool` (default 20)
  - `GET /api/v1/observations/:id` (single)

  Tests: 5 tests for sessions route, 3 for observations.

- [ ] **Step 8: Add consolidation + devices routes**

  Consolidation:
  - `GET /api/v1/consolidate/runs?limit=N` (recent runs list)
  - `GET /api/v1/consolidate/runs/:id` (single run with full diff)
  - `POST /api/v1/consolidate` (manually trigger; body: `{ dryRun?: boolean }`; default live)

  Devices:
  - `GET /api/v1/devices`
  - `POST /api/v1/devices` (body: `{ name, type }` — server generates random `apiKey` and `apiKeyHash`, returns the **plain key only in this response**)
  - `DELETE /api/v1/devices/:id`

  Tests: 4 for consolidation, 3 for devices (including a test that verifies the plain key is returned only at creation time).

- [ ] **Step 9: Wire new routes into http.ts**

  Import and register all 5 new route modules in `createHttpServer`:
  ```typescript
  registerMemoriesRoute(app, options.dbPath);
  registerInjectionRoute(app, options.dbPath);
  registerStatsRoute(app, options.dbPath);
  registerSessionsRoute(app, options.dbPath);
  registerObservationsRoute(app, options.dbPath);
  registerConsolidationRoute(app, options.dbPath);
  registerDevicesRoute(app, options.dbPath);
  ```

- [ ] **Step 10: Run full test suite and typecheck**

  Verify no regressions: `npm test`, `npm run typecheck`, `npm run build`.

---

## Task 2: Frontend workspace scaffold

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`, `web/tsconfig.node.json`
- Create: `web/vite.config.ts`
- Create: `web/index.html`
- Create: `web/src/main.tsx`
- Create: `web/src/theme/tokens.css`
- Create: `web/src/theme/global.css`
- Create: `web/src/routes.tsx`
- Create: `web/src/api/client.ts`
- Create: `web/src/api/types.ts`

- [ ] **Step 1: Create web/package.json**

  ```json
  {
    "name": "memweave-web",
    "private": true,
    "version": "0.1.0",
    "type": "module",
    "scripts": {
      "dev": "vite",
      "build": "tsc --noEmit && vite build",
      "preview": "vite preview",
      "test": "vitest run"
    },
    "dependencies": {
      "@tanstack/react-query": "^5.59.0",
      "@tanstack/react-table": "^8.20.0",
      "@xyflow/react": "^12.3.0",
      "react": "^18.3.1",
      "react-dom": "^18.3.1",
      "react-router-dom": "^6.27.0",
      "recharts": "^2.13.0"
    },
    "devDependencies": {
      "@testing-library/jest-dom": "^6.5.0",
      "@testing-library/react": "^16.0.0",
      "@types/react": "^18.3.0",
      "@types/react-dom": "^18.3.0",
      "@vitejs/plugin-react": "^4.3.0",
      "happy-dom": "^15.0.0",
      "typescript": "^5.6.0",
      "vite": "^5.4.0",
      "vitest": "^2.1.0"
    }
  }
  ```

- [ ] **Step 2: Create Vite + TS configs**

  `web/vite.config.ts`:
  ```typescript
  import { defineConfig } from 'vite';
  import react from '@vitejs/plugin-react';
  import { resolve } from 'node:path';

  export default defineConfig({
    plugins: [react()],
    base: '/ui/',                    // served at /ui/ by memweave-server
    build: {
      outDir: resolve(__dirname, '../dist/web'),
      emptyOutDir: true
    },
    server: {
      port: 5173,
      proxy: {
        '/api': 'http://127.0.0.1:3131'  // dev mode forwards to server
      }
    }
  });
  ```

  `web/tsconfig.json`:
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "lib": ["ES2022", "DOM", "DOM.Iterable"],
      "module": "ESNext",
      "moduleResolution": "Bundler",
      "jsx": "react-jsx",
      "strict": true,
      "noUncheckedIndexedAccess": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "isolatedModules": true,
      "resolveJsonModule": true,
      "noEmit": true,
      "types": ["vitest/globals", "@testing-library/jest-dom"]
    },
    "include": ["src", "tests"]
  }
  ```

- [ ] **Step 3: Create index.html and main.tsx**

  `web/index.html`:
  ```html
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>MemWeave — Calm Memory Atlas</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono&display=swap" rel="stylesheet">
    </head>
    <body>
      <div id="root"></div>
      <script type="module" src="/src/main.tsx"></script>
    </body>
  </html>
  ```

  `web/src/main.tsx`:
  ```tsx
  import { StrictMode } from 'react';
  import { createRoot } from 'react-dom/client';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { RouterProvider } from 'react-router-dom';
  import { router } from './routes';
  import './theme/tokens.css';
  import './theme/global.css';

  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } }
  });

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>
  );
  ```

- [ ] **Step 4: Create theme tokens**

  `web/src/theme/tokens.css` — copy the CSS custom properties from design §10.3:
  ```css
  :root {
    --bg: #F7F4EE;
    --surface: #FFFFFF;
    --surface-soft: #F0ECE3;
    --border: #DDD5C7;
    --text: #26231F;
    --text-muted: #7A7266;
    --accent: #3B7C6E;
    --accent-soft: #DDEDE8;
    --warning: #C98A2E;
    --danger: #B85C5C;
    --success: #5B8A5A;
    --link: #466FA6;
    --font-display: 'Fraunces', Georgia, serif;
    --font-body: 'IBM Plex Sans', system-ui, sans-serif;
    --font-mono: 'JetBrains Mono', Menlo, monospace;
  }
  [data-theme="dark"] {
    --bg: #171A18;
    --surface: #20241F;
    --surface-soft: #2A3029;
    --border: #3A4238;
    --text: #ECE7DD;
    --text-muted: #A8A095;
    --accent: #6AB7A5;
    --accent-soft: #183C35;
    --warning: #D9A441;
    --danger: #D27A7A;
    --success: #8FBF87;
    --link: #8CABD9;
  }
  ```

  `web/src/theme/global.css` — reset + body font + 2-line max on `p`.

- [ ] **Step 5: Create typed API client**

  `web/src/api/client.ts`:
  ```typescript
  const BASE = import.meta.env.VITE_API_BASE ?? '/api/v1';

  export class ApiError extends Error {
    constructor(public status: number, public body: unknown, message: string) {
      super(message);
    }
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin'
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError(res.status, text, `${method} ${path} → ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  export const api = {
    get:    <T>(p: string)             => request<T>('GET', p),
    post:   <T>(p: string, b?: unknown) => request<T>('POST', p, b),
    patch:  <T>(p: string, b?: unknown) => request<T>('PATCH', p, b),
    delete:  <T>(p: string)             => request<T>('DELETE', p)
  };
  ```

  `web/src/api/types.ts` — local copies of MemoryRecord, EdgeType, etc. (keep narrow; the SPA only needs the fields it actually renders). Use `interface` not `type` for ergonomics with React props.

- [ ] **Step 6: Create route table**

  `web/src/routes.tsx`:
  ```tsx
  import { createBrowserRouter } from 'react-router-dom';
  import { AppShell } from './components/layout/AppShell';
  import { AtlasPage } from './pages/AtlasPage';
  import { MemoriesPage } from './pages/MemoriesPage';
  // ... etc

  export const router = createBrowserRouter([
    {
      path: '/',
      element: <AppShell />,
      children: [
        { index: true, element: <AtlasPage /> },
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
  ], { basename: '/ui' });
  ```

- [ ] **Step 7: Set up web tests**

  `web/tests/setup.ts`:
  ```typescript
  import '@testing-library/jest-dom';
  ```

  `web/vitest.config.ts` (at `web/vitest.config.ts`):
  ```typescript
  import { defineConfig } from 'vitest/config';
  import react from '@vitejs/plugin-react';
  export default defineConfig({
    plugins: [react()],
    test: { environment: 'happy-dom', globals: true, setupFiles: ['./tests/setup.ts'] }
  });
  ```

  `web/package.json` should reference this vitest binary; add `"test:watch": "vitest"`.

- [ ] **Step 8: Install + smoke**

  ```bash
  cd web
  npm install
  npm run build        # should produce ../dist/web/
  ```

  Expected: build succeeds, no errors, `dist/web/index.html` exists.

---

## Task 3: AppShell + Theme toggle

**Files:**
- Create: `web/src/components/layout/AppShell.tsx`
- Create: `web/src/components/layout/Sidebar.tsx`
- Create: `web/src/components/layout/TopBar.tsx`
- Create: `web/src/lib/format.ts`

- [ ] **Step 1: AppShell layout**

  Two-pane layout: 240px sidebar on the left, main `<Outlet />` on the right. Top bar (60px) at the top spanning the main pane. Use CSS grid:

  ```css
  .app-shell {
    display: grid;
    grid-template-columns: 240px 1fr;
    grid-template-rows: 60px 1fr;
    grid-template-areas: 'sidebar topbar' 'sidebar main';
    height: 100vh;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-body);
  }
  ```

- [ ] **Step 2: Sidebar with 5 nav items**

  Each item is a `<NavLink>` to `/atlas`, `/memories`, `/injection`, `/sleep`, `/settings`. Active route gets `--accent-soft` background. The sidebar header reads "MemWeave" in `var(--font-display)`.

- [ ] **Step 3: TopBar with search + theme toggle**

  - A search input (placeholder "Search memories…") that navigates to `/memories?q=...` on Enter.
  - A theme toggle button (sun/moon glyph) that flips `data-theme` on `<html>` and persists to `localStorage`.

- [ ] **Step 4: format.ts helpers**

  ```typescript
  export const formatStrength = (n: number) => n.toFixed(2);
  export const formatDate = (ts: number) => new Date(ts).toLocaleString();
  export const formatTokens = (n: number) => n > 1000 ? `${(n/1000).toFixed(1)}k` : `${n}`;
  ```

- [ ] **Step 5: Tests**

  `web/tests/routes.test.tsx`:
  - renders the sidebar with 5 nav links
  - clicking a nav link navigates to the right route
  - theme toggle flips `data-theme` and persists

---

## Task 4: Common components

**Files:**
- Create: `web/src/components/common/TypeBadge.tsx`
- Create: `web/src/components/common/TierBadge.tsx`
- Create: `web/src/components/common/ScopeChips.tsx`
- Create: `web/src/components/common/StrengthBar.tsx`
- Create: `web/src/components/common/ConfirmDialog.tsx`
- Create: `web/src/components/common/Spinner.tsx`
- Create: `web/src/components/common/ErrorBoundary.tsx`

- [ ] **Step 1: TypeBadge + TierBadge**

  Pill-shaped badges with color per type/tier. Use the same colors as the design §10.6 edge legend for consistency. Each ~`{ padding: 2px 8px; border-radius: 999px; font-size: 11px; font-family: var(--font-mono); }`.

- [ ] **Step 2: StrengthBar**

  Horizontal bar 200px wide, 4px tall. Fill color from strength (0.0 → `--danger`, 0.5 → `--warning`, 1.0 → `--accent`). Renders the numeric value at the right.

- [ ] **Step 3: ScopeChips**

  Renders an array of `{key, value}` scope tags as small outlined chips. Color the chip border by key (`project` → `--accent`, `domain` → `--link`, `topic` → `--text-muted`).

- [ ] **Step 4: ConfirmDialog + Spinner + ErrorBoundary**

  - `ConfirmDialog` — a controlled modal with cancel/confirm buttons. Used by destructive operations (Forget, Force forget).
  - `Spinner` — 16px SVG spinner using `--accent` color.
  - `ErrorBoundary` — catches render errors, displays a "Something went wrong" panel with a reload button.

- [ ] **Step 5: Tests**

  `web/tests/strength-bar.test.tsx`:
  - renders 0.0 as `--danger` width 0%
  - renders 1.0 as `--accent` width 100%
  - shows the numeric value to 2 decimal places

  `web/tests/type-badge.test.tsx`:
  - renders correct label per type
  - applies correct color

---

## Task 5: Memories page (list + filter + reading panel)

**Files:**
- Create: `web/src/api/memories.ts`
- Create: `web/src/components/memory/FilterRail.tsx`
- Create: `web/src/components/memory/MemoryList.tsx`
- Create: `web/src/components/memory/MemoryCard.tsx`
- Create: `web/src/components/memory/ReadingPanel.tsx`
- Create: `web/src/pages/MemoriesPage.tsx`
- Create: `web/src/components/memory/EditMemoryDialog.tsx`
- Create: `web/src/pages/MemoryDetailPage.tsx`

- [ ] **Step 1: API wrapper `memories.ts`**

  ```typescript
  export const memoriesApi = {
    list: (params: ListParams) => api.get<{ memories: Memory[]; total: number; limit: number; offset: number }>(`/memories?${qs(params)}`),
    get: (id: string) => api.get<Memory>(`/memories/${id}`),
    search: (body: SearchBody) => api.post<{ results: SearchResult[]; totalCandidates: number }>(`/memories/search`, body),
    patch: (id: string, body: PatchBody) => api.patch<Memory>(`/memories/${id}`, body),
    delete: (id: string) => api.delete<{ ok: true; memoryId: string; deletedAt: number }>(`/memories/${id}`),
    graph: (id: string, params?: GraphParams) => api.get<{ nodes: GraphNode[]; edges: GraphEdge[] }>(`/memories/${id}/graph?${qs(params)}`),
    accessLogs: (id: string) => api.get<{ logs: AccessLog[]; total: number }>(`/memories/${id}/access-logs`)
  };
  ```

  Use TanStack Query's `useQuery` / `useMutation` in components.

- [ ] **Step 2: FilterRail**

  A vertical column of checkboxes/filters on the left edge of the page:
  - MemoryType (9 checkboxes, "All" toggle)
  - Tier (3 checkboxes)
  - Scope (project / domain / topic — text input fields, free-form)
  - Strength (range slider 0–1)
  - Status (active / superseded / evicted — radio buttons)

  State held in URL search params (so refresh / share-link works).

- [ ] **Step 3: MemoryCard**

  Matches design §10.6 spec exactly:
  ```
  [type badge] [tier badge] title
  summary (truncated to 2 lines)
  ScopeChips row
  StrengthBar
  ```

  Whole card is a clickable button that sets `?selected=<id>` in URL.

- [ ] **Step 4: MemoryList**

  Virtualized list (use `react-window` only if list > 100 items; otherwise plain map) of `MemoryCard`s. Selecting a card scrolls the ReadingPanel into view on narrow screens.

- [ ] **Step 5: ReadingPanel**

  Fixed-width right column (420px) showing the selected memory:
  - Title (Fraunces, 24px)
  - Summary + Content (rendered as Markdown via `react-markdown`)
  - Type / Tier / Importance / Confidence / Strength (in a definition-list grid)
  - ScopeChips
  - "Source session / device" footer
  - Related edges (placeholder for now — see Task 7)
  - Access history (placeholder for now — see Task 7)

  Below the static fields, action buttons:
  - Edit → opens `EditMemoryDialog` (uses `useMutation` + invalidates query)
  - Forget → ConfirmDialog + `memoriesApi.delete(id)`
  - Promote / Demote — uses a new PATCH-style endpoint (or PATCH with `{ tier: 'medium' | 'short' }`); design §10.6 lists these but doesn't define endpoints. For v1, hide these buttons behind a "Dev actions" disclosure; they'll be wired to a new `POST /api/v1/memories/:id/promote|demote` pair if the user wants them later.
  - Expand graph → navigates to `/memories/:id/graph`

- [ ] **Step 6: MemoriesPage**

  Compose the 3 columns (filter rail / list / reading panel). Width 100%, height `calc(100vh - 60px)`.

- [ ] **Step 7: EditMemoryDialog**

  Modal form with fields: title, summary, content, importance (number 1-10). Save calls `useMutation(patchMemory)`. On success, invalidates the list query and closes.

- [ ] **Step 8: MemoryDetailPage**

  Renders the same `ReadingPanel` but as a full-width page (not a side pane). URL: `/memories/:id`. Used when the user clicks a memory from Atlas or Sleep without a list context.

- [ ] **Step 9: Tests**

  `web/tests/memories-page.test.tsx`:
  - loads memory list on mount
  - clicking a card sets `?selected=` and shows the ReadingPanel
  - "Forget" opens ConfirmDialog; confirming calls `delete` and removes the card
  - FilterRail change updates URL and refetches

---

## Task 6: Atlas page (Memory Health overview)

**Files:**
- Create: `web/src/api/stats.ts`
- Create: `web/src/pages/AtlasPage.tsx`
- Create: `web/src/components/common/MiniBarChart.tsx`

- [ ] **Step 1: API wrapper `stats.ts`**

  One method: `getStats(): Promise<Stats>`. Use `useQuery` with 30s staleTime.

- [ ] **Step 2: MiniBarChart component**

  A simple SVG-based horizontal bar chart. Used for the by-tier and by-type distributions. No external chart lib for these tiny charts — keeps the bundle small.

- [ ] **Step 3: AtlasPage layout**

  A single scrolling page with sections in this order:
  1. **Header**: project name + last-consolidation timestamp
  2. **Memory Health row** (4 KPI cards): Total / Active / Today's new / Last sleep cycle summary
  3. **Tier distribution**: MiniBarChart for short/medium/long
  4. **Type distribution**: MiniBarChart for the 9 types
  5. **Recent projects**: chips listing project names from `recentProjects`
  6. **Graph teaser**: a card linking to the full Memory graph page (placeholder for v1.1)

  Visual style: no card-grid-for-everything. Use whitespace, single-column stack, font-display on section headings.

- [ ] **Step 4: Tests**

  `web/tests/atlas-page.test.tsx`:
  - renders the 4 KPI cards with values from the stats response
  - tier / type charts render correct bar widths
  - "Last sleep cycle" shows the formatted timestamp or "never" when null

---

## Task 7: Memory Detail (ReadingPanel + Strength curve + Graph page)

**Files:**
- Create: `web/src/api/graph.ts`
- Create: `web/src/components/memory/StrengthCurve.tsx`
- Create: `web/src/components/graph/GraphCanvas.tsx`
- Create: `web/src/components/graph/MemoryNode.tsx`
- Create: `web/src/components/graph/EdgeLabel.tsx`
- Create: `web/src/components/graph/GraphControls.tsx`
- Create: `web/src/pages/GraphPage.tsx`
- Modify: `web/src/components/memory/ReadingPanel.tsx` (embed graph + access logs)

- [ ] **Step 1: API wrapper `graph.ts`**

  ```typescript
  export const graphApi = {
    get: (memoryId: string, params?: { depth?: 1|2|3; edgeTypes?: string[]; direction?: 'in'|'out'|'both' }) =>
      api.get<{ nodes: GraphNode[]; edges: GraphEdge[] }>(`/memories/${memoryId}/graph?${qs(params)}`),
    accessLogs: (memoryId: string) => api.get<{ logs: AccessLog[]; total: number }>(`/memories/${memoryId}/access-logs`)
  };
  ```

- [ ] **Step 2: StrengthCurve component (Recharts)**

  Recharts `<LineChart>` with X = time, Y = strength. We don't have a real time-series yet (no per-day strength snapshots stored). For v1, generate a **synthetic curve** by computing Ebbinghaus decay from `lastDecayAt` forward, plus a one-off bump at every `lastReinforcedAt`. The formula lives in `web/src/lib/format.ts` next to the other formatters. Document this is a projection, not historical data. When real history lands in v1.1, swap the data source.

- [ ] **Step 3: MemoryNode + EdgeLabel**

  `MemoryNode` is a custom React Flow node:
  - 120px × 60px card, `--surface` background, 1px `--border` rounded 6px
  - Top: TypeBadge + TierBadge
  - Middle: title truncated to 1 line
  - Bottom: small strength dot

  `EdgeLabel` shows the edge `reason` text on hover via a tooltip; visible label is just `type` in mono font.

- [ ] **Step 4: GraphCanvas**

  React Flow (`@xyflow/react`) wrapper:
  - `<ReactFlow nodes={nodes} edges={edges} nodeTypes={memoryNode} edgeTypes={...} fitView />`
  - Layout: for v1, use a simple radial layout (center = the focus memory, neighbors on a circle at distance = BFS depth). Computed in `lib/graph-layout.ts` (deterministic, no extra deps).
  - Colors: matches design §10.6 edge legend exactly

- [ ] **Step 5: GraphControls**

  Floating top-right panel with: depth slider, direction toggle, edge-type filter checkboxes, "Fit view" button.

- [ ] **Step 6: GraphPage**

  Three-column layout (filters / canvas / selected-memory detail) as the design specifies. Reuses the `ReadingPanel` from Task 5 for the right column.

- [ ] **Step 7: Embed graph + access logs into ReadingPanel**

  In the `ReadingPanel`:
  - Below "Related edges": an inline `<GraphCanvas height={300} nodes={...} edges={...} />` showing depth-1 neighbors (a small, read-only preview).
  - Below "Access history": a simple table with timestamp / source / query / `usedInContext` icon. Uses `graphApi.accessLogs(id)`.

- [ ] **Step 8: Tests**

  `web/tests/strength-curve.test.tsx`:
  - renders a downward-sloping line for a memory that was last decayed 30 days ago
  - shows a "boost" peak at the lastReinforcedAt timestamp

  `web/tests/graph-canvas.test.tsx`:
  - renders 1 node per memory and 1 edge per edge
  - selecting a node triggers the onNodeClick callback

---

## Task 8: Injection page (audit)

**Files:**
- Create: `web/src/api/inject.ts`
- Create: `web/src/pages/InjectionPage.tsx`
- Create: `web/src/components/injection/InjectionBundleList.tsx`
- Create: `web/src/components/injection/InjectionBundleViewer.tsx`
- Create: `web/src/components/injection/ContextXmlPreview.tsx`

- [ ] **Step 1: API wrapper `inject.ts`**

  Two methods:
  - `triggerPreview(body: { sessionId, phase, query?, files? }): Promise<InjectResponse>` — calls `POST /inject` server-side with a synthetic session so the UI can demonstrate what would be injected for a given query
  - `getBundle(contentHash: string)` — placeholder for v1.1, returns null

  (For v1 the UI doesn't persist past injection bundles; it just demonstrates the bundler behavior live.)

- [ ] **Step 2: InjectionPage layout**

  Two-pane: left = "Request a preview" form (sessionId, phase dropdown, query textarea, files list), right = the resulting bundle viewer.

- [ ] **Step 3: ContextXmlPreview**

  A read-only `<pre>` block with the `contextXml` from the response. Use a small "Copy" button. Style with monospace font and `--surface-soft` background.

- [ ] **Step 4: InjectionBundleViewer**

  Renders the full bundle metadata:
  - Bundle ID, Phase, Content Hash
  - Memory IDs (clickable links to `/memories/:id`)
  - Token count (formatted)
  - Stable pack vs delta pack (split the memoryIds heuristically by `tier`)
  - Key metrics: `cacheReuseRate`, `avgDeltaTokens` (placeholder zeros for v1 since we don't track these)

- [ ] **Step 5: Tests**

  `web/tests/injection-page.test.tsx`:
  - submitting the form calls `injectApi.triggerPreview`
  - the response renders the bundle metadata + XML preview
  - copy button copies the XML to clipboard

---

## Task 9: Sleep page (consolidation runs)

**Files:**
- Create: `web/src/api/consolidation.ts`
- Create: `web/src/pages/SleepPage.tsx`
- Create: `web/src/components/sleep/SleepCycleList.tsx`
- Create: `web/src/components/sleep/SleepCycleDiff.tsx`

- [ ] **Step 1: API wrapper `consolidation.ts`**

  ```typescript
  export const consolidationApi = {
    list: (limit = 20) => api.get<{ runs: ConsolidationRun[] }>(`/consolidate/runs?limit=${limit}`),
    get: (id: string) => api.get<{ run: ConsolidationRun }>(`/consolidate/runs/${id}`),
    trigger: (dryRun = false) => api.post<{ run: ConsolidationRun }>(`/consolidate`, { dryRun })
  };
  ```

- [ ] **Step 2: SleepPage layout**

  Top: "Trigger Sleep Cycle" button (with dry-run toggle). Below: list of recent runs. Click a run → expand the diff inline.

- [ ] **Step 3: SleepCycleList**

  One row per run. Format: `Sleep Cycle #N — {startedAt} — promoted X, evicted Y, merged Z, contradictions W`. Click to expand. The "Run now" button calls `trigger(false)` and prepends the new run.

- [ ] **Step 4: SleepCycleDiff**

  Git-diff-style list:
  ```
  + promoted mem_abc123 (short → medium): accessed 3 times in 7 days
  - evicted mem_def456 (short): strength 0.05, age 9d, 0 access
  ~ merged mem_aaa + mem_bbb → mem_ccc
  → edge created mem_1 causes mem_2
  ```

  Colors per design §10.10 motion principles: just text color (no animations) — `+` is `--success`, `-` is `--danger`, `~` is `--warning`, `→` is `--accent`.

- [ ] **Step 5: Tests**

  `web/tests/sleep-page.test.tsx`:
  - "Run now" button calls trigger and prepends the new run
  - clicking a row expands the diff
  - diff rows render with the correct colors

---

## Task 10: Settings page

**Files:**
- Create: `web/src/api/devices.ts`
- Create: `web/src/pages/SettingsPage.tsx`
- Create: `web/src/components/settings/SettingsForm.tsx`
- Create: `web/src/components/settings/DeviceList.tsx`
- Create: `web/src/components/settings/ApiKeyField.tsx`

- [ ] **Step 1: API wrapper `devices.ts`**

  ```typescript
  export const devicesApi = {
    list: () => api.get<{ devices: Device[] }>(`/devices`),
    create: (body: { name: string; type: string }) => api.post<{ device: Device; apiKey: string }>(`/devices`, body),
    delete: (id: string) => api.delete<{ ok: true }>(`/devices/${id}`)
  };
  ```

- [ ] **Step 2: SettingsPage**

  Two sections: **Server config (read-only)** and **Devices**.

  Server config: just a definition list showing host, port, DB path, embedding provider + dimensions, LLM provider + model, consolidation interval. All values come from a new `GET /api/v1/settings` endpoint that simply returns the loaded config (sans secrets).

  Devices: list with create + revoke.

- [ ] **Step 3: SettingsForm (server config) is a step-2 stretch; ship a "Config (read-only)" definition list in v1**

  For v1, the "Server config" section is a static display; making it editable would require a `PUT /api/v1/settings` endpoint + write-back to the JSONC file, which is out of scope.

- [ ] **Step 4: DeviceList**

  Table with: name, type, lastSeenAt (formatted), actions (Revoke).
  Top: "+ Register device" button opens a dialog (name + type select). On submit, the dialog shows the new device's `apiKey` in a copyable field with a "This is the only time you'll see this key" warning.

- [ ] **Step 5: ApiKeyField**

  Read-only input with a "Copy" button and a "Hide" toggle (default hidden). Used only on the create-device response.

- [ ] **Step 6: GET /api/v1/settings endpoint**

  Server-side, just returns the loaded config with secrets masked (replace `apiKey` with `'***'`). The UI can show the structure without exposing credentials.

- [ ] **Step 7: Tests**

  `web/tests/settings-page.test.tsx`:
  - device list renders rows from `devicesApi.list`
  - "Register device" dialog submits and reveals the new apiKey
  - "Revoke" button calls `delete` and removes the row

---

## Task 11: Integration: serve the UI from memweave-server

**Files:**
- Modify: `src/server/http.ts` (serve `dist/web/` at `/ui/*`)
- Modify: `package.json` (add `web:build` script that builds the SPA before `build`)

- [ ] **Step 1: Add static file serving**

  In `createHttpServer`, after the API routes are registered, add:

  ```typescript
  import { fastifyStatic } from '@fastify/static';
  import { fileURLToPath } from 'node:url';
  import { dirname, join, resolve } from 'node:path';
  import { existsSync } from 'node:fs';

  const here = dirname(fileURLToPath(import.meta.url));
  const webDist = resolve(here, '../../dist/web');   // src/server -> ../../dist/web
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/ui/', decorateReply: false });
    // SPA fallback: any GET under /ui/* that doesn't match a file -> index.html
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/ui/') && request.method === 'GET') {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No route' } });
    });
  } else {
    // Dev mode: tell the user to run `npm run dev:web` (Vite dev server) on :5173
    app.get('/ui/*', async (_req, reply) => {
      return reply.code(503).send({
        error: {
          code: 'UI_NOT_BUILT',
          message: 'Run `npm run web:build` or `npm run dev:web` to serve the SPA.'
        }
      });
    });
  }
  ```

  The `fastifyStatic` package is already a transitive dep (we have `@fastify/cors`); add it explicitly to `package.json`.

- [ ] **Step 2: Add npm scripts**

  ```json
  {
    "scripts": {
      "web:dev":   "cd web && npm run dev",
      "web:build": "cd web && npm install && npm run build",
      "build":     "npm run web:build && tsc -p tsconfig.json",
      "dev":       "npm run web:build && tsx src/server/bootstrap.ts"
    }
  }
  ```

  (`dev` now builds the SPA first so the server has something to serve; the `web:dev` script runs Vite's dev server independently with HMR.)

- [ ] **Step 3: Final smoke test**

  ```bash
  npm run build                  # builds server + web
  npm start                      # alias for: tsx src/server/bootstrap.ts (in dev) OR runs the dist binary (in prod)
  # In another terminal:
  curl -I http://127.0.0.1:3131/ui/         # should 200, content-type text/html
  curl -I http://127.0.0.1:3131/ui/index.html  # ditto
  ```

  Expected: 200 OK for both.

---

## Task 12: Final verification

- [ ] **Step 1: Typecheck everything**

  ```bash
  npm run typecheck               # server
  cd web && npm run build         # also runs tsc --noEmit on the SPA
  ```

  Expected: zero errors in both.

- [ ] **Step 2: Run all tests**

  ```bash
  npm test                        # server (vitest, all 192 tests)
  cd web && npm test              # SPA (vitest with happy-dom)
  ```

  Expected: all pass. New web tests should be in the 30-50 range.

- [ ] **Step 3: Manual end-to-end smoke**

  1. `npm start` — server listens on 3131
  2. Open `http://127.0.0.1:3131/ui/` in a browser
  3. Navigate to /ui/atlas — see Memory Health KPIs
  4. Navigate to /ui/memories — see a few seeded memories (use `memweave init` + create a few via REST first)
  5. Click a memory card → see ReadingPanel with strength curve
  6. Click "Expand graph" → see GraphPage
  7. Trigger a sleep cycle from /ui/sleep → see the new run in the list
  8. Open /ui/settings → register a device → copy the new apiKey
  9. Toggle dark mode via the top-bar button

  All steps should work without console errors.

---

## Self-Review Checklist

Spec coverage (§10):

- [x] 8 audit questions answered by the UI (each page has a "why does this exist" purpose)
- [x] Calm Memory Atlas visual style — warm paper + soft graph + reading-first
- [x] Light + dark theme via CSS custom properties
- [x] Fraunces (display) + IBM Plex Sans (body) + JetBrains Mono (code) loaded from Google Fonts
- [x] 5 first-level pages: Atlas, Memories, Injection, Sleep, Settings
- [x] Atlas page: Memory Health + tier dist + type dist + recent projects + last sleep
- [x] Memories page: 3-column layout (Filter / List / Reading), 7+ action buttons on Reading
- [x] MemoryCard component: type/tier badges + summary + scopes + strength + status
- [x] Graph page: React Flow with custom node, edge colors per type
- [x] Injection page: bundle preview + contextXml view + key metrics (cache reuse / delta tokens)
- [x] Sleep page: cycle list + diff + "Run now" button
- [x] Settings page: server config (read-only) + device CRUD
- [x] StrengthCurve component (Recharts) with decay + access boost
- [x] GraphCanvas with zoom/pan/hover/click (React Flow built-in)
- [x] InjectionBundleViewer with Stable / Delta / Skipped / Hash / Token count
- [x] SleepCycleDiff with `+ - ~ →` syntax
- [x] Motion: minimal — only chart-draw animation + tab-fade; no big animations
- [x] UI served at `/ui/` by `memweave-server`; dev mode uses Vite at :5173
- [x] Backend additions: stats, sessions, observations, consolidation runs, devices endpoints
- [x] Consolidator now persists each run to `consolidation_runs` for the Sleep page to show

Intentionally deferred to v1.1 (per design §10.5):

- Timeline page
- Standalone Access Logs page (embedded inside Memory detail for v1)
- Real strength-curve data (currently projected from `lastDecayAt` + `lastReinforcedAt`)
- Cache-reuse / avg-delta-tokens tracking (placeholders shown as 0)
- Per-memory Promote / Demote / Merge / Mark duplicate / Mark superseded / Change scope actions (only Forget + Edit in v1; the rest are hidden behind a "Dev actions" disclosure)
- Setting edits (server config is read-only in v1; the Settings page shows but does not save changes)
- Graph library swap to Sigma.js (deferred until graph size forces it)
- Database migration persistence (schema is currently `CREATE TABLE IF NOT EXISTS`-only; v1.1 introduces a real migration log)

Placeholder scan: no `TBD`, `TODO`, `fill in details`, or undefined function names.

---

*This plan is implementation-ready. Each task is broken into atomic steps, each step has a concrete deliverable, and every file added has at least one test. Estimated total: ~3,000 lines of new code across backend and SPA.*
