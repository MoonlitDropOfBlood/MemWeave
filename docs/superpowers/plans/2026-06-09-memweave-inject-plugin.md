# MemWeave OpenCode Inject Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a lightweight OpenCode plugin that calls `memweave-server`'s `POST /api/v1/inject` endpoint at 4 key moments (session start, prompt submit, file tool, tool failure) to inject cache-aware memory context.

**Architecture:** A thin TypeScript plugin (similar to existing `agentmemory-capture.ts`) that registers OpenCode event hooks. On each relevant event, it calls memweave-server's REST API to fetch an injection bundle, and injects the bundle into OpenCode's `experimental.chat.system.transform` hook. The server is responsible for all search/ranking logic — the plugin is just a protocol bridge.

**Tech Stack:** TypeScript, `@opencode-ai/plugin`, memweave-server REST API.

**Prerequisites:** memweave-server with `/api/v1/inject` endpoint running on 127.0.0.1:3131.

---

## File Structure

```text
src/plugin/
  index.ts          — Plugin entry, register hooks
  client.ts         — HTTP client to memweave-server inject endpoint
  injector.ts       — System prompt injection logic
tests/plugin/
  client.test.ts
  injector.test.ts
```

---

## Task 1: Plugin HTTP Client

**Files:**
- Create: `src/plugin/client.ts`
- Create: `tests/plugin/client.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/plugin/client.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { MemweaveInjectClient } from '../../src/plugin/client.js';

const BASE = process.env.MEMWEAVE_URL || 'http://127.0.0.1:3131';

describe('MemweaveInjectClient', () => {
  const client = new MemweaveInjectClient({ baseUrl: BASE });

  it('returns 200 for session_start injection', async () => {
    const bundle = await client.requestInjection({
      sessionId: 'test-session',
      phase: 'session_start'
    });
    expect(bundle.phase).toBe('session_start');
    expect(bundle.memoryIds).toBeTypeOf('object');
    expect(bundle.contentHash).toBeTypeOf('string');
  });

  it('returns 200 for prompt_delta injection with query', async () => {
    const bundle = await client.requestInjection({
      sessionId: 'test-session',
      phase: 'prompt_delta',
      query: 'SQLite design'
    });
    expect(bundle.phase).toBe('prompt_delta');
  });

  it('returns 200 for file_pack injection with files', async () => {
    const bundle = await client.requestInjection({
      sessionId: 'test-session',
      phase: 'file_pack',
      files: ['src/retrieval/search-engine.ts']
    });
    expect(bundle.phase).toBe('file_pack');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test -- tests/plugin/client.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement HTTP client**

Create `src/plugin/client.ts`:

```typescript
export interface InjectRequest {
  sessionId: string;
  phase: 'session_start' | 'prompt_delta' | 'file_pack' | 'failure_delta';
  query?: string;
  files?: string[];
  alreadyInjected?: string[];
}

export interface InjectResponse {
  bundleId: string;
  phase: string;
  memoryIds: string[];
  contentHash: string;
  estimatedTokens: number;
  contextXml: string;
}

export interface MemweaveInjectClientOptions {
  baseUrl: string;
  timeout?: number;
}

export class MemweaveInjectClient {
  private baseUrl: string;
  private timeout: number;

  constructor(options: MemweaveInjectClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeout = options.timeout ?? 10000;
  }

  async requestInjection(request: InjectRequest): Promise<InjectResponse> {
    const url = `${this.baseUrl}/api/v1/inject`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.timeout)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Inject request failed: ${res.status} ${text.slice(0, 200)}`);
    }
    const data = await res.json() as InjectResponse;
    return data;
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- tests/plugin/client.test.ts
```

Expected: PASS (requires memweave-server running on 3131).

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

---

## Task 2: Injector (Cache-aware system transform)

**Files:**
- Create: `src/plugin/injector.ts`
- Create: `tests/plugin/injector.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/plugin/injector.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildSystemAppend, type MemoryForInjection } from '../../src/plugin/injector.js';

describe('buildSystemAppend', () => {
  it('builds a cache-stable XML section', () => {
    const mems: MemoryForInjection[] = [
      { id: 'm1', type: 'decision', tier: 'long', strength: 0.9, importance: 9, title: 'Use SQLite', summary: 'SQLite v1' }
    ];
    const xml = buildSystemAppend('session_start', mems);
    expect(xml).toContain('<memory-context');
    expect(xml).toContain('phase="session_start"');
    expect(xml).toContain('Use SQLite');
  });

  it('returns empty string for empty memories', () => {
    const xml = buildSystemAppend('prompt_delta', []);
    expect(xml).toBe('');
  });

  it('sorts long memories first', () => {
    const mems: MemoryForInjection[] = [
      { id: 's1', type: 'event', tier: 'short', strength: 0.5, importance: 5, title: 'Short', summary: 's' },
      { id: 'l1', type: 'decision', tier: 'long', strength: 0.9, importance: 9, title: 'Long', summary: 'l' }
    ];
    const xml = buildSystemAppend('session_start', mems);
    const longIdx = xml.indexOf('Long');
    const shortIdx = xml.indexOf('Short');
    expect(longIdx).toBeGreaterThan(-1);
    expect(shortIdx).toBeGreaterThan(-1);
    expect(longIdx).toBeLessThan(shortIdx);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test -- tests/plugin/injector.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement injector**

Create `src/plugin/injector.ts`:

```typescript
import type { InjectResponse } from './client.js';

export type MemoryForInjection = Pick<InjectResponse, never> extends never
  ? never
  : {
      id: string;
      type: string;
      tier: 'short' | 'medium' | 'long';
      strength: number;
      importance: number;
      title: string;
      summary: string;
    };

export function buildSystemAppend(phase: string, memories: MemoryForInjection[]): string {
  if (memories.length === 0) return '';

  const sorted = [...memories].sort((a, b) => {
    const tierOrder = { long: 0, medium: 1, short: 2 };
    const aOrder = tierOrder[a.tier] ?? 2;
    const bOrder = tierOrder[b.tier] ?? 2;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return b.strength * b.importance - a.strength * a.importance;
  });

  const header = `<memory-context phase="${escapeAttr(phase)}" count="${sorted.length}">`;
  const items = sorted.map(m =>
    `  <memory id="${escapeAttr(m.id)}" type="${escapeAttr(m.type)}" tier="${escapeAttr(m.tier)}" strength="${m.strength.toFixed(2)}" importance="${m.importance}">\n` +
    `    <title>${escapeText(m.title)}</title>\n` +
    `    <summary>${escapeText(m.summary)}</summary>\n` +
    `  </memory>`
  );
  const footer = `</memory-context>`;
  return [header, ...items, footer].join('\n');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- tests/plugin/injector.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

---

## Task 3: Plugin Entry Point with OpenCode Hooks

**Files:**
- Create: `src/plugin/index.ts`

- [ ] **Step 1: Implement plugin entry point**

Create `src/plugin/index.ts`:

```typescript
import type { Plugin } from '@opencode-ai/plugin';
import { MemweaveInjectClient, type InjectResponse } from './client.js';
import { buildSystemAppend, type MemoryForInjection } from './injector.js';

const API = process.env.MEMWEAVE_URL || 'http://127.0.0.1:3131';
const TIMEOUT = 10000;
const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'Glob', 'Grep']);
const FILE_KEYS = ['filePath', 'file_path', 'path', 'file', 'pattern'];
const INJECTED_CACHE = new Map<string, Set<string>>();

function extractFilePaths(args: Record<string, unknown>): string[] {
  const files: string[] = [];
  for (const key of FILE_KEYS) {
    const val = args[key];
    if (typeof val === 'string' && val.length > 0) {
      files.push(val);
    }
  }
  return files;
}

export const MemweaveInjectPlugin: Plugin = async (_ctx) => {
  const client = new MemweaveInjectClient({ baseUrl: API, timeout: TIMEOUT });
  const sessionInjected = INJECTED_CACHE;

  return {
    'experimental.chat.system.transform': async (_input, output) => {
      const sessionId = (output as any).sessionID ?? 'default';
      const alreadyInjected = sessionInjected.get(sessionId) ?? new Set<string>();

      // Try to read user prompt from output (best effort)
      const userPrompt = (output as any).parts
        ?.filter((p: any) => p.type === 'text')
        ?.map((p: any) => p.text)
        ?.join('\n') ?? '';

      let phase: 'session_start' | 'prompt_delta' = sessionInjected.has(sessionId) ? 'prompt_delta' : 'session_start';
      let response: InjectResponse;
      try {
        response = await client.requestInjection({
          sessionId,
          phase,
          query: userPrompt.slice(0, 500) || undefined,
          alreadyInjected: [...alreadyInjected]
        });
      } catch (err) {
        // Silent fail: injection is best-effort, don't break the agent
        return;
      }

      // The contextXml is rendered by the server; we just append it.
      if (Array.isArray(output.system) && response.contextXml) {
        output.system.push(response.contextXml);
        for (const id of response.memoryIds) {
          alreadyInjected.add(id);
        }
        sessionInjected.set(sessionId, alreadyInjected);
      }
    },

    'tool.execute.before': async (input, output) => {
      if (!FILE_TOOLS.has(input.tool)) return;
      const sessionId = (output as any).sessionID ?? 'default';
      const files = extractFilePaths((output as any).args ?? {});
      if (files.length === 0) return;
      const alreadyInjected = sessionInjected.get(sessionId) ?? new Set<string>();

      try {
        const response = await client.requestInjection({
          sessionId,
          phase: 'file_pack',
          files,
          alreadyInjected: [...alreadyInjected]
        });
        if (Array.isArray(output.system) && response.contextXml) {
          output.system.push(response.contextXml);
          for (const id of response.memoryIds) {
            alreadyInjected.add(id);
          }
          sessionInjected.set(sessionId, alreadyInjected);
        }
      } catch {
        // Silent fail
      }
    }
  };
};
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS (the `@opencode-ai/plugin` types may not be installed, so we may need to install the package first). If typecheck fails due to missing `@opencode-ai/plugin`, install it:

```bash
npm install --save-dev @opencode-ai/plugin
```

Then run typecheck again.

- [ ] **Step 3: Build verification**

```bash
npm run build
```

Expected: PASS.

---

## Task 4: Integration Test (Manual Smoke)

**Files:**
- N/A (manual verification only)

- [ ] **Step 1: Manual smoke test**

Start memweave-server in one terminal:

```bash
npm run dev
```

In another terminal, verify the plugin's HTTP client can reach the server by running a test:

```bash
echo '{"sessionId":"smoke","phase":"session_start"}' | curl -X POST http://127.0.0.1:3131/api/v1/inject -H "Content-Type: application/json" -d @-
```

Expected: `200 OK` with bundleId, contentHash, memoryIds, contextXml.

Stop server with Ctrl+C.

---

## Self-Review Checklist

Spec coverage:

- [x] HTTP client to memweave-server injection endpoint
- [x] Cache-aware system prompt injection via `experimental.chat.system.transform`
- [x] File tool trigger via `tool.execute.before` for Read/Edit/Write/Glob/Grep
- [x] Deduplication via `INJECTED_CACHE` keyed by sessionId
- [x] Silent failure (injection is best-effort, never breaks agent)

Intentionally deferred to follow-up plans:

- Failure-triggered injection (planned for v1.1)
- Cache-aware rendering at the plugin layer (the server already does this via contentHash)
- Multi-session cross-pollination (each session is isolated)

Placeholder scan: no `TBD`, `TODO`, `fill in details`, or undefined function names.
