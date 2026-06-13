# MemWeave MCP Shim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stdio MCP server (`memweave-mcp`) that exposes 10 MCP tools and forwards requests via HTTP to the existing `memweave-server` REST API.

**Architecture:** A thin stdio MCP server using `@modelcontextprotocol/sdk`. It receives MCP tool calls from AI agents (OpenCode, Cursor), translates them to HTTP requests against `memweave-server` at `http://127.0.0.1:3131`, and returns the response. No database access — purely a protocol bridge.

**Tech Stack:** Node.js 20+, TypeScript, `@modelcontextprotocol/sdk`, existing `memweave-server` REST API.

**Prerequisites:** `memweave-server` must be running on `127.0.0.1:3131` for integration tests.

---

## File Structure

```text
src/mcp/
  index.ts          — MCP server entry point (stdio transport)
  client.ts         — HTTP client for memweave-server REST API
  tools/
    save.ts
    recall.ts
    smart-search.ts
    expand.ts
    graph-query.ts
    file-history.ts
    sessions.ts
    patterns.ts
    consolidate.ts
    forget.ts
  registry.ts       — Tool registration helper
tests/mcp/
  client.test.ts
  tools.test.ts
```

---

## Task 1: MCP Dependency + HTTP Client

**Files:**
- Modify: `package.json` (add dependency)
- Create: `src/mcp/client.ts`
- Create: `tests/mcp/client.test.ts`

- [ ] **Step 1: Add MCP SDK dependency**

Run:

```bash
npm install @modelcontextprotocol/sdk
```

Expected: `@modelcontextprotocol/sdk` added to `package.json` dependencies.

- [ ] **Step 2: Create HTTP client**

Create `src/mcp/client.ts`:

```typescript
export interface McpClientOptions {
  baseUrl: string;
}

export class MemweaveClient {
  private baseUrl: string;

  constructor(options: McpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
      throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  health(): Promise<{ ok: boolean; service: string }> {
    return this.request('GET', '/api/v1/health');
  }

  createMemory(input: Record<string, unknown>): Promise<{ memoryId: string; type: string; tier: string; title: string; summary: string; createdEdges: Array<unknown> }> {
    return this.request('POST', '/api/v1/memories', input);
  }

  getMemory(id: string): Promise<Record<string, unknown>> {
    return this.request('GET', `/api/v1/memories/${encodeURIComponent(id)}`);
  }
}
```

- [ ] **Step 3: Write client tests**

Create `tests/mcp/client.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { MemweaveClient } from '../../src/mcp/client.js';

const BASE = process.env.MEMWEAVE_TEST_URL || 'http://127.0.0.1:3131';

describe('MemweaveClient', () => {
  const client = new MemweaveClient({ baseUrl: BASE });

  it('health returns ok', async () => {
    const result = await client.health();
    expect(result.ok).toBe(true);
    expect(result.service).toBe('memweave-server');
  });

  it('creates and reads a memory', async () => {
    const created = await client.createMemory({
      type: 'fact',
      title: 'MCP test',
      content: 'Created via MCP client test.',
      summary: 'MCP test summary.',
      concepts: ['mcp', 'test'],
      files: [],
      importance: 5,
      confidence: 0.8,
      source: 'user_explicit',
      scopeLevel: 'project',
      scopes: [{ key: 'project', value: 'memory' }],
      sourceClient: 'rest_api'
    });
    expect(created.memoryId).toBeTypeOf('string');

    const loaded = await client.getMemory(created.memoryId);
    expect(loaded.title).toBe('MCP test');
  });
});
```

- [ ] **Step 4: Run client tests**

Run:

```bash
npm test -- tests/mcp/client.test.ts
```

Expected: PASS (requires memweave-server running on 3131).

- [ ] **Step 5: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

---

## Task 2: MCP Server Entry Point + Tool Registry

**Files:**
- Create: `src/mcp/registry.ts`
- Create: `src/mcp/index.ts`

- [ ] **Step 1: Create tool registry**

Create `src/mcp/registry.ts`:

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemweaveClient } from './client.js';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (client: MemweaveClient, args: Record<string, unknown>) => Promise<unknown>;
}

export function registerTools(server: McpServer, client: MemweaveClient, tools: McpTool[]): void {
  for (const tool of tools) {
    server.tool(
      tool.name,
      tool.description,
      tool.inputSchema,
      async (args) => {
        try {
          const result = await tool.handler(client, args);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: message }) }], isError: true };
        }
      }
    );
  }
}
```

- [ ] **Step 2: Create MCP server entry point**

Create `src/mcp/index.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MemweaveClient } from './client.js';
import { registerTools, type McpTool } from './registry.js';
import { saveTool } from './tools/save.js';
import { recallTool } from './tools/recall.js';
import { smartSearchTool } from './tools/smart-search.js';
import { expandTool } from './tools/expand.js';
import { graphQueryTool } from './tools/graph-query.js';
import { fileHistoryTool } from './tools/file-history.js';
import { sessionsTool } from './tools/sessions.js';
import { patternsTool } from './tools/patterns.js';
import { consolidateTool } from './tools/consolidate.js';
import { forgetTool } from './tools/forget.js';

const BASE_URL = process.env.MEMWEAVE_URL || 'http://127.0.0.1:3131';
const client = new MemweaveClient({ baseUrl: BASE_URL });
const server = new McpServer({ name: 'memweave-mcp', version: '0.1.0' });

const tools: McpTool[] = [
  saveTool,
  recallTool,
  smartSearchTool,
  expandTool,
  graphQueryTool,
  fileHistoryTool,
  sessionsTool,
  patternsTool,
  consolidateTool,
  forgetTool
];

registerTools(server, client, tools);

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 3: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS (will warn about missing tool modules, which are created in Task 3).

---

## Task 3: Tool Handlers

**Files:**
- Create: `src/mcp/tools/save.ts`
- Create: `src/mcp/tools/recall.ts`
- Create: `src/mcp/tools/smart-search.ts`
- Create: `src/mcp/tools/expand.ts`
- Create: `src/mcp/tools/graph-query.ts`
- Create: `src/mcp/tools/file-history.ts`
- Create: `src/mcp/tools/sessions.ts`
- Create: `src/mcp/tools/patterns.ts`
- Create: `src/mcp/tools/consolidate.ts`
- Create: `src/mcp/tools/forget.ts`

- [ ] **Step 1: Create save tool**

Create `src/mcp/tools/save.ts`:

```typescript
import type { McpTool } from '../registry.js';

export const saveTool: McpTool = {
  name: 'memory_save',
  description: 'Save an insight, decision, or fact to long-term memory.',
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The memory content' },
      type: { type: 'string', enum: ['fact', 'decision', 'preference', 'event', 'project_context', 'lesson', 'code_pattern', 'bug', 'workflow'], description: 'Memory type (auto-detected if omitted)' },
      title: { type: 'string', description: 'Short title' },
      concepts: { type: 'array', items: { type: 'string' }, description: 'Searchable keywords' },
      files: { type: 'array', items: { type: 'string' }, description: 'Associated file paths' },
      scopeLevel: { type: 'string', enum: ['global', 'project'], description: 'Scope level' },
      scopes: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } } }, description: 'Scope tags' },
      importance: { type: 'number', description: '1-10 importance' }
    },
    required: ['content']
  },
  handler: async (client, args) => {
    return client.createMemory(args as Record<string, unknown>);
  }
};
```

- [ ] **Step 2: Create recall tool**

Create `src/mcp/tools/recall.ts`:

```typescript
import type { McpTool } from '../registry.js';

export const recallTool: McpTool = {
  name: 'memory_recall',
  description: 'Search past observations by keywords.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'number', description: 'Max results (default 5)' },
      types: { type: 'array', items: { type: 'string' }, description: 'Filter by memory types' }
    },
    required: ['query']
  },
  handler: async (client, args) => {
    return client.request('POST', '/api/v1/memories/search', args);
  }
};
```

- [ ] **Step 3: Create smart-search tool**

Create `src/mcp/tools/smart-search.ts`:

```typescript
import type { McpTool } from '../registry.js';

export const smartSearchTool: McpTool = {
  name: 'memory_smart_search',
  description: 'Hybrid semantic+keyword search with progressive disclosure.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'number', description: 'Max results (default 8)' },
      types: { type: 'array', items: { type: 'string' }, description: 'Filter by memory types' },
      includeGraph: { type: 'boolean', description: 'Include graph expansion' },
      includeCausal: { type: 'boolean', description: 'Include causal chain recall' },
      mode: { type: 'string', enum: ['compact', 'full'], description: 'Result detail level' }
    },
    required: ['query']
  },
  handler: async (client, args) => {
    return client.request('POST', '/api/v1/memories/search', { ...args, mode: args.mode ?? 'compact' });
  }
};
```

- [ ] **Step 4: Create expand tool**

Create `src/mcp/tools/expand.ts`:

```typescript
import type { McpTool } from '../registry.js';

export const expandTool: McpTool = {
  name: 'memory_expand',
  description: 'Expand a compact memory into full detail with graph and causal chain.',
  inputSchema: {
    type: 'object',
    properties: {
      memoryId: { type: 'string', description: 'Memory ID to expand' },
      includeGraph: { type: 'boolean', description: 'Include graph neighbors' },
      includeCausal: { type: 'boolean', description: 'Include causal chain' }
    },
    required: ['memoryId']
  },
  handler: async (client, args) => {
    return client.request('GET', `/api/v1/memories/${encodeURIComponent(args.memoryId as string)}`, args);
  }
};
```

- [ ] **Step 5: Create graph-query tool**

Create `src/mcp/tools/graph-query.ts`:

```typescript
import type { McpTool } from '../registry.js';

export const graphQueryTool: McpTool = {
  name: 'memory_graph_query',
  description: 'Query the relationship graph around a memory.',
  inputSchema: {
    type: 'object',
    properties: {
      memoryId: { type: 'string', description: 'Starting memory ID' },
      depth: { type: 'number', description: 'Traversal depth (1-3)' },
      edgeTypes: { type: 'array', items: { type: 'string' }, description: 'Filter by edge types' },
      direction: { type: 'string', enum: ['in', 'out', 'both'], description: 'Edge direction' },
      limit: { type: 'number', description: 'Max results' }
    },
    required: ['memoryId']
  },
  handler: async (client, args) => {
    return client.request('GET', `/api/v1/memories/${encodeURIComponent(args.memoryId as string)}/graph`, args);
  }
};
```

- [ ] **Step 6: Create file-history tool**

Create `src/mcp/tools/file-history.ts`:

```typescript
import type { McpTool } from '../registry.js';

export const fileHistoryTool: McpTool = {
  name: 'memory_file_history',
  description: 'Get past observations about specific files.',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'File path to query' },
      limit: { type: 'number', description: 'Max results' },
      types: { type: 'array', items: { type: 'string' }, description: 'Filter by memory types' },
      includeBugs: { type: 'boolean', description: 'Include bug memories' },
      includePatterns: { type: 'boolean', description: 'Include code pattern memories' }
    },
    required: ['filePath']
  },
  handler: async (client, args) => {
    return client.request('POST', '/api/v1/memories/search', { query: args.filePath, types: args.types, limit: args.limit ?? 10 });
  }
};
```

- [ ] **Step 7: Create sessions tool**

Create `src/mcp/tools/sessions.ts`:

```typescript
import type { McpTool } from '../registry.js';

export const sessionsTool: McpTool = {
  name: 'memory_sessions',
  description: 'List recent sessions with status and observation counts.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max sessions (default 10)' },
      project: { type: 'string', description: 'Filter by project' },
      sourceClient: { type: 'string', description: 'Filter by client type' }
    }
  },
  handler: async (client, args) => {
    return client.request('GET', '/api/v1/sessions', args);
  }
};
```

- [ ] **Step 8: Create patterns tool**

Create `src/mcp/tools/patterns.ts`:

```typescript
import type { McpTool } from '../registry.js';

export const patternsTool: McpTool = {
  name: 'memory_patterns',
  description: 'Detect recurring patterns across sessions.',
  inputSchema: {
    type: 'object',
    properties: {
      type: { type: 'string', description: 'Filter by memory type' },
      sinceDays: { type: 'number', description: 'Look back period in days' },
      limit: { type: 'number', description: 'Max results' }
    }
  },
  handler: async (client, args) => {
    return client.request('POST', '/api/v1/memories/search', { query: 'pattern', ...args, limit: args.limit ?? 10 });
  }
};
```

- [ ] **Step 9: Create consolidate tool**

Create `src/mcp/tools/consolidate.ts`:

```typescript
import type { McpTool } from '../registry.js';

export const consolidateTool: McpTool = {
  name: 'memory_consolidate',
  description: 'Run the memory consolidation pipeline.',
  inputSchema: {
    type: 'object',
    properties: {
      tier: { type: 'string', enum: ['short', 'medium', 'long', 'all'], description: 'Which tier to consolidate' },
      dryRun: { type: 'boolean', description: 'Preview without making changes' }
    }
  },
  handler: async (client, args) => {
    return client.request('POST', '/api/v1/consolidate', args);
  }
};
```

- [ ] **Step 10: Create forget tool**

Create `src/mcp/tools/forget.ts`:

```typescript
import type { McpTool } from '../registry.js';

export const forgetTool: McpTool = {
  name: 'memory_forget',
  description: 'Delete specific memories with audit trail.',
  inputSchema: {
    type: 'object',
    properties: {
      memoryIds: { type: 'array', items: { type: 'string' }, description: 'Memory IDs to delete' },
      reason: { type: 'string', description: 'Reason for deletion' },
      hardDelete: { type: 'boolean', description: 'Bypass soft delete' }
    },
    required: ['memoryIds', 'reason']
  },
  handler: async (client, args) => {
    const ids = (args.memoryIds as string[]).join(',');
    return client.request('DELETE', `/api/v1/memories/${encodeURIComponent(ids)}`, args);
  }
};
```

- [ ] **Step 11: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

---

## Task 4: Integration Tests

**Files:**
- Create: `tests/mcp/tools.test.ts`

- [ ] **Step 1: Write integration tests**

Create `tests/mcp/tools.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { MemweaveClient } from '../../src/mcp/client.js';

const BASE = process.env.MEMWEAVE_TEST_URL || 'http://127.0.0.1:3131';

describe('MCP tools via client', () => {
  const client = new MemweaveClient({ baseUrl: BASE });

  it('save tool creates a memory', async () => {
    const result = await client.createMemory({
      type: 'decision',
      title: 'MCP integration test',
      content: 'Testing MCP shim save tool.',
      summary: 'MCP integration test.',
      concepts: ['mcp'],
      files: [],
      importance: 5,
      confidence: 0.8,
      source: 'user_explicit',
      scopeLevel: 'project',
      scopes: [{ key: 'project', value: 'memory' }],
      sourceClient: 'rest_api'
    });
    expect(result.memoryId).toBeTypeOf('string');
  });

  it('recall tool searches memories', async () => {
    const result = await client.request('POST', '/api/v1/memories/search', { query: 'MCP', limit: 5 });
    expect(Array.isArray(result)).toBe(true);
  });

  it('expand tool reads a memory', async () => {
    const created = await client.createMemory({
      type: 'fact',
      title: 'Expand test',
      content: 'Testing expand.',
      summary: 'Expand test.',
      concepts: ['expand'],
      files: [],
      importance: 3,
      confidence: 0.7,
      source: 'user_explicit',
      scopeLevel: 'project',
      scopes: [],
      sourceClient: 'rest_api'
    });
    const loaded = await client.getMemory(created.memoryId);
    expect(loaded.title).toBe('Expand test');
  });
});
```

- [ ] **Step 2: Run integration tests**

Run:

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected: PASS (requires memweave-server running on 3131).

- [ ] **Step 3: Run all tests and typecheck**

Run:

```bash
npm test
npm run typecheck
```

Expected: both PASS.

---

## Task 5: CLI Entry Point + Package Script

**Files:**
- Modify: `package.json` (add `memweave-mcp` bin script)

- [ ] **Step 1: Add bin script to package.json**

Edit `package.json` to add:

```json
{
  "bin": {
    "memweave-mcp": "./dist/src/mcp/index.js"
  }
}
```

- [ ] **Step 2: Add MCP start script**

Edit `package.json` scripts to add:

```json
{
  "scripts": {
    "mcp": "tsx src/mcp/index.ts"
  }
}
```

- [ ] **Step 3: Typecheck + build**

Run:

```bash
npm run typecheck
npm run build
```

Expected: both PASS.

- [ ] **Step 4: Verify MCP server starts**

Run:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}' | npx tsx src/mcp/index.ts | head -c 500
```

Expected: Returns an MCP initialize response JSON.

---

## Self-Review Checklist

Spec coverage:

- [x] 10 MCP tools defined with input schemas
- [x] stdio transport for AI agent integration
- [x] HTTP forwarding to memweave-server
- [x] Error handling returns structured error responses
- [x] CLI entry point for `memweave-mcp`

Placeholder scan: no `TBD`, `TODO`, `fill in details`, or undefined function names.
