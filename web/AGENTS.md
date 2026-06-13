# web/

**React 18 + Vite 5 admin UI. "Calm Memory Atlas" — 7 pages, warm-paper theme.**

## OVERVIEW

The browser-side companion to the server. Built into `dist/web/` and served at `/ui/` by the Fastify server. Uses `@tanstack/react-query` for data, `@xyflow/react` for the graph page, and `recharts` for dashboard stats.

## STRUCTURE

```
web/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tests/                  # vitest + happy-dom
│   ├── setup.ts
│   ├── api-client.test.ts
│   ├── format.test.ts
│   └── strength-bar.test.tsx
└── src/
    ├── main.tsx            # createRoot + QueryClient + RouterProvider
    ├── routes.tsx          # createBrowserRouter with basename: '/ui'
    ├── api/
    │   ├── client.ts       # Typed fetch wrapper → /api/v1
    │   └── types.ts        # Mirrors server's response shapes
    ├── components/
    │   ├── layout/AppShell.tsx
    │   ├── common/         # Badge, StrengthBar, ScopeChips, TypeBadge
    │   └── memory/MemoryCard.tsx
    ├── pages/              # 7 pages, each with co-located .module.css
    │   ├── AtlasPage.tsx           # /atlas — dashboard
    │   ├── MemoriesPage.tsx        # /memories — list + filter + detail
    │   ├── MemoryDetailPage.tsx    # /memories/:id
    │   ├── GraphPage.tsx           # /memories/:id/graph
    │   ├── InjectionPage.tsx       # /injection
    │   ├── SleepPage.tsx           # /sleep
    │   ├── SettingsPage.tsx        # /settings
    │   └── NotFoundPage.tsx
    ├── lib/format.ts       # formatters (dates, strength, importance)
    └── theme/
        ├── tokens.css      # CSS custom properties (light + dark)
        └── global.css
```

## WHERE TO LOOK

| Task | Location | Notes |
|---|---|---|
| Add a page | `pages/<Name>Page.tsx` + `routes.tsx` | Co-locate `.module.css` |
| Add a UI primitive | `components/common/` | One file + one CSS module |
| Add a fetch endpoint | `api/client.ts` | Typed wrapper; return type from `api/types.ts` |
| Change colors / spacing | `theme/tokens.css` | CSS custom properties; never hardcode hex in components |
| Add a dashboard chart | `pages/AtlasPage.tsx` | Recharts components |

## CONVENTIONS

- **CSS Modules** for all styling (`Foo.module.css`). No Tailwind, no styled-components.
- **CSS variables only** for colors / spacing. Hex values live in `tokens.css`; the rest of the code references `var(--accent)` etc.
- **React Query** for all server data. `useQuery` / `useMutation`; default `staleTime: 30_000` (see `main.tsx`).
- **React Router 6** (`createBrowserRouter`) with `basename: '/ui'`. All paths are relative to that.
- Functional components + hooks only. No class components.
- `@xyflow/react` for the graph; `recharts` for charts; don't add new heavy deps.

## ANTI-PATTERNS

- **NEVER** introduce a different framework (Next, Remix, Svelte, …). Vite + React 18 is the only stack.
- **NEVER** bypass the API client. Components fetch via `apiClient.xxx()`, not raw `fetch`.
- **NEVER** hardcode the server URL. The Vite dev server proxies `/api` to `:3131`; production proxies through the Fastify server.
- **NEVER** import from `dist/` or `src/`. They are separate workspaces.
- **NEVER** add a CSS-in-JS library. The theme is tokens.css.
