# MemWeave Backend Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the MemWeave backend foundation: TypeScript project scaffold, core memory types, decay/reinforcement math, SQLite schema, repositories, and a minimal REST API.

**Architecture:** This plan implements the first executable slice of the MemWeave spec: one `memweave-server` process owns SQLite writes and exposes Fastify REST endpoints. MCP, automatic injection, LLM compression, sqlite-vec retrieval, and Web UI are separate follow-up plans built on this foundation.

**Tech Stack:** Node.js 20+, TypeScript, Fastify, better-sqlite3, Zod, pino, Vitest, SQLite FTS5.

---

## Scope Split

The full MemWeave spec spans backend, MCP, LLM workers, retrieval/injection algorithms, and Web UI. This plan deliberately implements **Backend Core Foundation only** so each milestone is testable.

Follow-up plans after this one:

1. `memweave-retrieval-injection.md` — vector/BM25/graph/causal search, cache-aware injection bundles.
2. `memweave-mcp-shim.md` — stdio MCP shim forwarding to REST.
3. `memweave-llm-workers.md` — value gate, compression, edge extraction, consolidation workers.
4. `memweave-web-ui.md` — Calm Memory Atlas UI.

Commits are not included in this plan because the workspace is currently not a git repository and commits require explicit user approval.

---

## File Structure

Create these files:

```text
package.json
tsconfig.json
vitest.config.ts
src/core/types.ts
src/core/decay.ts
src/core/config.ts
src/db/schema.ts
src/db/database.ts
src/db/repositories/memory-repo.ts
src/server/http.ts
src/server/bootstrap.ts
tests/core/decay.test.ts
tests/db/memory-repo.test.ts
tests/server/http.test.ts
```

Responsibilities:

- `src/core/types.ts`: Shared domain types and Zod schemas.
- `src/core/decay.ts`: Deterministic strength initialization, decay, and reinforcement math.
- `src/core/config.ts`: JSONC config loader with environment variable expansion.
- `src/db/schema.ts`: SQLite DDL for core tables and FTS5 triggers.
- `src/db/database.ts`: DB connection, migration bootstrap, transaction helper.
- `src/db/repositories/memory-repo.ts`: Memory CRUD, scope persistence, access logging.
- `src/server/http.ts`: Fastify app factory and REST routes.
- `src/server/bootstrap.ts`: CLI entrypoint for `memweave-server`.

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Create package manifest**

Create `package.json`:

```json
{
  "name": "memweave",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/server/bootstrap.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@fastify/cors": "11.2.0",
    "better-sqlite3": "12.10.0",
    "fastify": "5.8.5",
    "jsonc-parser": "3.3.1",
    "pino": "10.3.1",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@types/better-sqlite3": "7.6.13",
    "@types/node": "25.9.2",
    "tsx": "4.22.4",
    "typescript": "6.0.3",
    "vitest": "4.1.8"
  }
}
```

- [ ] **Step 2: Create TypeScript config**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Create Vitest config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts']
  }
});
```

- [ ] **Step 4: Install dependencies**

Run:

```bash
npm install
```

Expected: dependencies install successfully and `package-lock.json` is created.

- [ ] **Step 5: Verify scaffold**

Run:

```bash
npm run typecheck
```

Expected: PASS. There are no source files yet, so TypeScript should exit 0.

---

## Task 2: Core Types and Zod Schemas

**Files:**
- Create: `src/core/types.ts`

- [ ] **Step 1: Create domain types**

Create `src/core/types.ts`:

```typescript
import { z } from 'zod';

export const MemoryTierSchema = z.enum(['short', 'medium', 'long']);
export type MemoryTier = z.infer<typeof MemoryTierSchema>;

export const MemoryTypeSchema = z.enum([
  'fact',
  'decision',
  'preference',
  'event',
  'project_context',
  'lesson',
  'code_pattern',
  'bug',
  'workflow'
]);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;

export const EdgeTypeSchema = z.enum([
  'causes',
  'enables',
  'contradicts',
  'supersedes',
  'references',
  'related_to',
  'before',
  'after',
  'duplicates',
  'refines'
]);
export type EdgeType = z.infer<typeof EdgeTypeSchema>;

export const ScopeKeySchema = z.enum(['project', 'domain', 'topic']);
export type ScopeKey = z.infer<typeof ScopeKeySchema>;

export const ScopeLevelSchema = z.enum(['global', 'project']);
export type ScopeLevel = z.infer<typeof ScopeLevelSchema>;

export const MemorySourceSchema = z.enum(['user_explicit', 'agent_capture', 'system_inferred']);
export type MemorySource = z.infer<typeof MemorySourceSchema>;

export const SourceClientSchema = z.enum(['opencode', 'cursor', 'claude_code', 'rest_api']);
export type SourceClient = z.infer<typeof SourceClientSchema>;

export const ScopeTagSchema = z.object({
  key: ScopeKeySchema,
  value: z.string().min(1)
});
export type ScopeTag = z.infer<typeof ScopeTagSchema>;

export const CreateMemoryInputSchema = z.object({
  tenantId: z.string().min(1),
  type: MemoryTypeSchema,
  title: z.string().min(1).max(120),
  content: z.string().min(1),
  summary: z.string().min(1).max(500),
  concepts: z.array(z.string().min(1)).default([]),
  files: z.array(z.string().min(1)).default([]),
  importance: z.number().int().min(1).max(10),
  confidence: z.number().min(0).max(1),
  source: MemorySourceSchema,
  scopeLevel: ScopeLevelSchema,
  scopes: z.array(ScopeTagSchema).default([]),
  sourceClient: SourceClientSchema.nullable().default(null),
  sourceDeviceId: z.string().nullable().default(null),
  sourceSessionId: z.string().nullable().default(null)
});
export type CreateMemoryInput = z.infer<typeof CreateMemoryInputSchema>;

export interface MemoryRecord extends CreateMemoryInput {
  id: string;
  tier: MemoryTier;
  strength: number;
  tau: number;
  accessCount: number;
  lastAccessedAt: number | null;
  lastReinforcedAt: number | null;
  lastDecayAt: number | null;
  reinforcementScore: number;
  promotedAt: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  evictionReason: string | null;
}

export const AccessSourceSchema = z.enum([
  'recall',
  'smart_search',
  'context_inject',
  'file_history',
  'graph_query',
  'manual_view'
]);
export type AccessSource = z.infer<typeof AccessSourceSchema>;

export interface AccessLogInput {
  tenantId: string;
  memoryId: string;
  sessionId: string | null;
  deviceId: string | null;
  source: AccessSource;
  query: string | null;
  rank: number | null;
  score: number | null;
  usedInContext: boolean;
}
```

- [ ] **Step 2: Verify types compile**

Run:

```bash
npm run typecheck
```

Expected: PASS.

---

## Task 3: Decay and Reinforcement Utilities (TDD)

**Files:**
- Create: `tests/core/decay.test.ts`
- Create: `src/core/decay.ts`

- [ ] **Step 1: Write failing tests for decay math**

Create `tests/core/decay.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  applyDecay,
  initialStrengthFromImportance,
  reinforcementBoost,
  tauFor
} from '../../src/core/decay.js';

const DAY = 24 * 60 * 60 * 1000;

describe('decay utilities', () => {
  it('normalizes importance 1-10 into strength 0-1', () => {
    expect(initialStrengthFromImportance(1)).toBe(0.1);
    expect(initialStrengthFromImportance(7)).toBe(0.7);
    expect(initialStrengthFromImportance(10)).toBe(1);
  });

  it('returns tau from tier and importance band', () => {
    expect(tauFor('short', 2)).toBe(1);
    expect(tauFor('short', 5)).toBe(2);
    expect(tauFor('medium', 8)).toBe(30);
    expect(tauFor('long', 10)).toBe(Number.POSITIVE_INFINITY);
  });

  it('applies exponential decay based on elapsed days', () => {
    const now = Date.now();
    const lastDecayAt = now - 2 * DAY;
    const decayed = applyDecay({ strength: 1, tau: 2, lastDecayAt, now });
    expect(decayed.strength).toBeCloseTo(Math.exp(-1), 5);
    expect(decayed.lastDecayAt).toBe(now);
  });

  it('does not decay permanent memory', () => {
    const now = Date.now();
    const lastDecayAt = now - 365 * DAY;
    const decayed = applyDecay({ strength: 0.8, tau: Number.POSITIVE_INFINITY, lastDecayAt, now });
    expect(decayed.strength).toBe(0.8);
    expect(decayed.lastDecayAt).toBe(now);
  });

  it('maps access sources to reinforcement boost', () => {
    expect(reinforcementBoost({ usedInContext: false, explicitReference: false, userConfirmed: false })).toBe(0.02);
    expect(reinforcementBoost({ usedInContext: true, explicitReference: false, userConfirmed: false })).toBe(0.1);
    expect(reinforcementBoost({ usedInContext: true, explicitReference: true, userConfirmed: false })).toBe(0.15);
    expect(reinforcementBoost({ usedInContext: true, explicitReference: false, userConfirmed: true })).toBe(0.3);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- tests/core/decay.test.ts
```

Expected: FAIL because `src/core/decay.ts` does not exist.

- [ ] **Step 3: Implement decay utilities**

Create `src/core/decay.ts`:

```typescript
import type { MemoryTier } from './types.js';

const TAU_TABLE: Record<MemoryTier, Array<{ min: number; max: number; tau: number }>> = {
  short: [
    { min: 1, max: 3, tau: 1 },
    { min: 4, max: 6, tau: 2 },
    { min: 7, max: 9, tau: 7 },
    { min: 10, max: 10, tau: 30 }
  ],
  medium: [
    { min: 1, max: 3, tau: 5 },
    { min: 4, max: 6, tau: 14 },
    { min: 7, max: 9, tau: 30 },
    { min: 10, max: 10, tau: 60 }
  ],
  long: [
    { min: 1, max: 3, tau: 60 },
    { min: 4, max: 6, tau: 180 },
    { min: 7, max: 10, tau: Number.POSITIVE_INFINITY }
  ]
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function initialStrengthFromImportance(importance: number): number {
  const bounded = Math.max(1, Math.min(10, Math.round(importance)));
  return bounded / 10;
}

export function tauFor(tier: MemoryTier, importance: number): number {
  const bounded = Math.max(1, Math.min(10, Math.round(importance)));
  const row = TAU_TABLE[tier].find((entry) => bounded >= entry.min && bounded <= entry.max);
  if (!row) throw new Error(`No tau mapping for tier=${tier} importance=${bounded}`);
  return row.tau;
}

export interface ApplyDecayInput {
  strength: number;
  tau: number;
  lastDecayAt: number | null;
  now: number;
}

export function applyDecay(input: ApplyDecayInput): { strength: number; lastDecayAt: number } {
  const current = Math.max(0, Math.min(1, input.strength));
  if (input.lastDecayAt === null) return { strength: current, lastDecayAt: input.now };
  if (!Number.isFinite(input.tau)) return { strength: current, lastDecayAt: input.now };
  const elapsedDays = Math.max(0, (input.now - input.lastDecayAt) / DAY_MS);
  const decayFactor = Math.exp(-elapsedDays / input.tau);
  return { strength: Math.max(0, current * decayFactor), lastDecayAt: input.now };
}

export interface ReinforcementInput {
  usedInContext: boolean;
  explicitReference: boolean;
  userConfirmed: boolean;
}

export function reinforcementBoost(input: ReinforcementInput): number {
  if (input.userConfirmed) return 0.3;
  if (input.explicitReference) return 0.15;
  if (input.usedInContext) return 0.1;
  return 0.02;
}
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
npm test -- tests/core/decay.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

---

## Task 4: Config Loader

**Files:**
- Create: `src/core/config.ts`

- [ ] **Step 1: Create config loader**

Create `src/core/config.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { parse } from 'jsonc-parser';
import { z } from 'zod';

const ConfigSchema = z.object({
  server: z.object({
    host: z.string().default('127.0.0.1'),
    port: z.number().int().min(1).max(65535).default(3131)
  }).default({}),
  storage: z.object({
    path: z.string().default('~/.memweave/data/memweave.db')
  }).default({}),
  auth: z.object({
    defaultTenantName: z.string().default('default'),
    deviceApiKey: z.string().default('dev-local-key')
  }).default({})
});

export type MemWeaveConfig = z.infer<typeof ConfigSchema>;

export function expandPath(value: string): string {
  if (value.startsWith('~/')) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

export function expandEnv(value: string): string {
  if (!value.startsWith('env://')) return value;
  const name = value.slice('env://'.length);
  const resolved = process.env[name];
  if (!resolved) throw new Error(`Missing environment variable ${name}`);
  return resolved;
}

export function loadConfig(path?: string): MemWeaveConfig {
  if (!path) return ConfigSchema.parse({});
  const raw = readFileSync(path, 'utf8');
  return ConfigSchema.parse(parse(raw));
}
```

- [ ] **Step 2: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

---

## Task 5: SQLite Schema and Database Bootstrap

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/database.ts`

- [ ] **Step 1: Create SQL schema**

Create `src/db/schema.ts`:

```typescript
export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  last_seen_at INTEGER,
  registered_at INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  device_id TEXT,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  observation_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT NOT NULL,
  concepts_json TEXT NOT NULL DEFAULT '[]',
  concepts_text TEXT NOT NULL DEFAULT '',
  files_json TEXT NOT NULL DEFAULT '[]',
  importance INTEGER NOT NULL,
  confidence REAL NOT NULL,
  strength REAL NOT NULL,
  source TEXT NOT NULL,
  scope_level TEXT NOT NULL,
  source_client TEXT,
  source_device_id TEXT,
  source_session_id TEXT,
  tau REAL NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at INTEGER,
  last_reinforced_at INTEGER,
  last_decay_at INTEGER,
  reinforcement_score REAL NOT NULL DEFAULT 0,
  promoted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  eviction_reason TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memory_scopes (
  memory_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(memory_id, key, value),
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  from_memory_id TEXT NOT NULL,
  to_memory_id TEXT NOT NULL,
  type TEXT NOT NULL,
  strength REAL NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (from_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  FOREIGN KEY (to_memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  hook_type TEXT NOT NULL,
  tool_name TEXT,
  tool_input TEXT,
  tool_output TEXT,
  timestamp INTEGER NOT NULL,
  memory_id TEXT,
  processed INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS access_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  session_id TEXT,
  device_id TEXT,
  source TEXT NOT NULL,
  query TEXT,
  rank INTEGER,
  score REAL,
  used_in_context INTEGER NOT NULL DEFAULT 0,
  accessed_at INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  title,
  summary,
  content,
  concepts_text,
  content='memories',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memory_fts(rowid, title, summary, content, concepts_text)
  VALUES (new.rowid, new.title, new.summary, new.content, new.concepts_text);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, title, summary, content, concepts_text)
  VALUES ('delete', old.rowid, old.title, old.summary, old.content, old.concepts_text);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, title, summary, content, concepts_text)
  VALUES ('delete', old.rowid, old.title, old.summary, old.content, old.concepts_text);
  INSERT INTO memory_fts(rowid, title, summary, content, concepts_text)
  VALUES (new.rowid, new.title, new.summary, new.content, new.concepts_text);
END;

CREATE INDEX IF NOT EXISTS idx_memories_tenant_tier_strength ON memories(tenant_id, tier, strength DESC);
CREATE INDEX IF NOT EXISTS idx_memories_tenant_type_created ON memories(tenant_id, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_scopes_tenant_key_value ON memory_scopes(tenant_id, key, value);
CREATE INDEX IF NOT EXISTS idx_memory_scopes_memory_id ON memory_scopes(memory_id);
CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_memory_id);
CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_memory_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_memory_time ON access_logs(memory_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_tenant_time ON access_logs(tenant_id, accessed_at DESC);
`;
```

- [ ] **Step 2: Create database bootstrap**

Create `src/db/database.ts`:

```typescript
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';

export type Db = Database.Database;

export function openDatabase(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec(SCHEMA_SQL);
  return db;
}

export function transaction<T>(db: Db, fn: () => T): T {
  return db.transaction(fn)();
}
```

- [ ] **Step 3: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

---

## Task 6: Memory Repository (TDD)

**Files:**
- Create: `tests/db/memory-repo.test.ts`
- Create: `src/db/repositories/memory-repo.ts`

- [ ] **Step 1: Write failing repository tests**

Create `tests/db/memory-repo.test.ts`:

```typescript
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/database.js';
import { openDatabase } from '../../src/db/database.js';
import { MemoryRepo } from '../../src/db/repositories/memory-repo.js';

let db: Db;
let repo: MemoryRepo;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-'));
  db = openDatabase(join(dir, 'test.db'));
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  repo = new MemoryRepo(db);
});

afterEach(() => db.close());

describe('MemoryRepo', () => {
  it('creates and reads a memory with scopes', () => {
    const memory = repo.create({
      tenantId: 'tenant_default',
      type: 'decision',
      title: 'Use MCP + REST',
      content: 'MemWeave exposes MCP for agents and REST for UI/scripts.',
      summary: 'Use MCP + REST for v1.',
      concepts: ['mcp', 'rest', 'interface'],
      files: [],
      importance: 8,
      confidence: 0.9,
      source: 'user_explicit',
      scopeLevel: 'project',
      scopes: [
        { key: 'project', value: 'memory' },
        { key: 'topic', value: 'architecture' }
      ],
      sourceClient: 'rest_api',
      sourceDeviceId: null,
      sourceSessionId: null
    });

    const loaded = repo.getById('tenant_default', memory.id);
    expect(loaded?.title).toBe('Use MCP + REST');
    expect(loaded?.strength).toBe(0.8);
    expect(loaded?.scopes).toEqual([
      { key: 'project', value: 'memory' },
      { key: 'topic', value: 'architecture' }
    ]);
  });

  it('records access logs and reinforces memory', () => {
    const memory = repo.create({
      tenantId: 'tenant_default',
      type: 'fact',
      title: 'SQLite is the default store',
      content: 'MemWeave stores v1 data in SQLite.',
      summary: 'SQLite is the default store.',
      concepts: ['sqlite'],
      files: [],
      importance: 6,
      confidence: 0.8,
      source: 'system_inferred',
      scopeLevel: 'project',
      scopes: [{ key: 'project', value: 'memory' }],
      sourceClient: null,
      sourceDeviceId: null,
      sourceSessionId: null
    });

    repo.recordAccess({
      tenantId: 'tenant_default',
      memoryId: memory.id,
      sessionId: null,
      deviceId: null,
      source: 'context_inject',
      query: 'storage design',
      rank: 1,
      score: 0.92,
      usedInContext: true
    });

    const loaded = repo.getById('tenant_default', memory.id);
    expect(loaded?.accessCount).toBe(1);
    expect(loaded?.strength).toBeCloseTo(0.7, 5);
    expect(loaded?.lastReinforcedAt).toBeTypeOf('number');
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- tests/db/memory-repo.test.ts
```

Expected: FAIL because `MemoryRepo` does not exist.

- [ ] **Step 3: Implement MemoryRepo**

Create `src/db/repositories/memory-repo.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import type { Db } from '../database.js';
import type { AccessLogInput, CreateMemoryInput, MemoryRecord, ScopeTag } from '../../core/types.js';
import { initialStrengthFromImportance, reinforcementBoost, tauFor } from '../../core/decay.js';

interface MemoryRow {
  id: string;
  tenant_id: string;
  tier: 'short' | 'medium' | 'long';
  type: MemoryRecord['type'];
  title: string;
  content: string;
  summary: string;
  concepts_json: string;
  files_json: string;
  importance: number;
  confidence: number;
  strength: number;
  source: MemoryRecord['source'];
  scope_level: MemoryRecord['scopeLevel'];
  source_client: MemoryRecord['sourceClient'];
  source_device_id: string | null;
  source_session_id: string | null;
  tau: number;
  access_count: number;
  last_accessed_at: number | null;
  last_reinforced_at: number | null;
  last_decay_at: number | null;
  reinforcement_score: number;
  promoted_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  eviction_reason: string | null;
}

export class MemoryRepo {
  constructor(private readonly db: Db) {}

  create(input: CreateMemoryInput): MemoryRecord {
    const now = Date.now();
    const id = randomUUID();
    const tier = input.importance >= 10 ? 'long' : input.importance >= 7 && input.confidence > 0.75 ? 'medium' : 'short';
    const strength = initialStrengthFromImportance(input.importance);
    const tau = tauFor(tier, input.importance);
    const conceptsJson = JSON.stringify(input.concepts);
    const filesJson = JSON.stringify(input.files);
    const conceptsText = input.concepts.join(' ');

    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO memories (
          id, tenant_id, tier, type, title, content, summary,
          concepts_json, concepts_text, files_json, importance, confidence,
          strength, source, scope_level, source_client, source_device_id,
          source_session_id, tau, access_count, last_accessed_at,
          last_reinforced_at, last_decay_at, reinforcement_score,
          promoted_at, created_at, updated_at, deleted_at, eviction_reason
        ) VALUES (
          @id, @tenantId, @tier, @type, @title, @content, @summary,
          @conceptsJson, @conceptsText, @filesJson, @importance, @confidence,
          @strength, @source, @scopeLevel, @sourceClient, @sourceDeviceId,
          @sourceSessionId, @tau, 0, NULL, NULL, @now, 0,
          NULL, @now, @now, NULL, NULL
        )
      `).run({ ...input, id, tier, strength, tau, conceptsJson, conceptsText, filesJson, now });

      const scopeStmt = this.db.prepare(`
        INSERT INTO memory_scopes (memory_id, tenant_id, key, value, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const scope of input.scopes) scopeStmt.run(id, input.tenantId, scope.key, scope.value, now);
    });
    tx();

    const created = this.getById(input.tenantId, id);
    if (!created) throw new Error(`Failed to create memory ${id}`);
    return created;
  }

  getById(tenantId: string, id: string): MemoryRecord | null {
    const row = this.db.prepare('SELECT * FROM memories WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL')
      .get(tenantId, id) as MemoryRow | undefined;
    if (!row) return null;
    const scopes = this.db.prepare('SELECT key, value FROM memory_scopes WHERE tenant_id = ? AND memory_id = ? ORDER BY key, value')
      .all(tenantId, id) as ScopeTag[];
    return this.mapRow(row, scopes);
  }

  recordAccess(input: AccessLogInput): void {
    const now = Date.now();
    const id = randomUUID();
    const boost = reinforcementBoost({
      usedInContext: input.usedInContext,
      explicitReference: false,
      userConfirmed: false
    });

    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO access_logs (
          id, tenant_id, memory_id, session_id, device_id,
          source, query, rank, score, used_in_context, accessed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.tenantId,
        input.memoryId,
        input.sessionId,
        input.deviceId,
        input.source,
        input.query,
        input.rank,
        input.score,
        input.usedInContext ? 1 : 0,
        now
      );

      this.db.prepare(`
        UPDATE memories
        SET access_count = access_count + 1,
            last_accessed_at = ?,
            last_reinforced_at = CASE WHEN ? >= 0.1 THEN ? ELSE last_reinforced_at END,
            reinforcement_score = min(1, reinforcement_score + ?),
            strength = min(1, strength + ?),
            updated_at = ?
        WHERE tenant_id = ? AND id = ?
      `).run(now, boost, now, boost, boost, now, input.tenantId, input.memoryId);
    });
    tx();
  }

  private mapRow(row: MemoryRow, scopes: ScopeTag[]): MemoryRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      tier: row.tier,
      type: row.type,
      title: row.title,
      content: row.content,
      summary: row.summary,
      concepts: JSON.parse(row.concepts_json) as string[],
      files: JSON.parse(row.files_json) as string[],
      importance: row.importance,
      confidence: row.confidence,
      strength: row.strength,
      source: row.source,
      scopeLevel: row.scope_level,
      scopes,
      sourceClient: row.source_client,
      sourceDeviceId: row.source_device_id,
      sourceSessionId: row.source_session_id,
      tau: row.tau,
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at,
      lastReinforcedAt: row.last_reinforced_at,
      lastDecayAt: row.last_decay_at,
      reinforcementScore: row.reinforcement_score,
      promotedAt: row.promoted_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
      evictionReason: row.eviction_reason
    };
  }
}
```

- [ ] **Step 4: Run repository tests**

Run:

```bash
npm test -- tests/db/memory-repo.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

---

## Task 7: Minimal HTTP Server

**Files:**
- Create: `tests/server/http.test.ts`
- Create: `src/server/http.ts`
- Create: `src/server/bootstrap.ts`

- [ ] **Step 1: Write failing HTTP tests**

Create `tests/server/http.test.ts`:

```typescript
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHttpServer } from '../../src/server/http.js';

let app: FastifyInstance;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-http-'));
  app = await createHttpServer({ dbPath: join(dir, 'test.db') });
});

afterEach(async () => app.close());

describe('HTTP server', () => {
  it('returns health status', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, service: 'memweave-server' });
  });

  it('creates and reads memory', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      payload: {
        type: 'decision',
        title: 'Use MemWeave name',
        content: 'The project is named MemWeave to avoid legal confusion.',
        summary: 'Project name is MemWeave.',
        concepts: ['memweave', 'naming'],
        files: [],
        importance: 8,
        confidence: 0.9,
        source: 'user_explicit',
        scopeLevel: 'project',
        scopes: [{ key: 'project', value: 'memory' }],
        sourceClient: 'rest_api'
      }
    });

    expect(create.statusCode).toBe(201);
    const body = create.json() as { memoryId: string };
    expect(body.memoryId).toBeTypeOf('string');

    const read = await app.inject({ method: 'GET', url: `/api/v1/memories/${body.memoryId}` });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ title: 'Use MemWeave name', type: 'decision' });
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- tests/server/http.test.ts
```

Expected: FAIL because `createHttpServer` does not exist.

- [ ] **Step 3: Implement HTTP server**

Create `src/server/http.ts`:

```typescript
import Fastify from 'fastify';
import { z } from 'zod';
import { CreateMemoryInputSchema } from '../core/types.js';
import { openDatabase } from '../db/database.js';
import { MemoryRepo } from '../db/repositories/memory-repo.js';

export interface CreateHttpServerOptions {
  dbPath: string;
}

export async function createHttpServer(options: CreateHttpServerOptions) {
  const app = Fastify({ logger: false });
  const db = openDatabase(options.dbPath);
  const memoryRepo = new MemoryRepo(db);

  db.prepare('INSERT OR IGNORE INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'dev-local-key', Date.now());

  app.addHook('onClose', async () => db.close());

  app.get('/api/v1/health', async () => ({ ok: true, service: 'memweave-server' }));

  app.post('/api/v1/memories', async (request, reply) => {
    const input = CreateMemoryInputSchema.parse({
      ...(request.body as Record<string, unknown>),
      tenantId: 'tenant_default'
    });
    const memory = memoryRepo.create(input);
    return reply.code(201).send({
      memoryId: memory.id,
      type: memory.type,
      tier: memory.tier,
      title: memory.title,
      summary: memory.summary,
      createdEdges: []
    });
  });

  app.get('/api/v1/memories/:id', async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const memory = memoryRepo.getById('tenant_default', params.id);
    if (!memory) {
      return reply.code(404).send({
        error: { code: 'MEMORY_NOT_FOUND', message: `Memory ${params.id} not found` }
      });
    }
    return memory;
  });

  return app;
}
```

Create `src/server/bootstrap.ts`:

```typescript
import { expandPath, loadConfig } from '../core/config.js';
import { createHttpServer } from './http.js';

const configPath = process.env.MEMWEAVE_CONFIG;
const config = loadConfig(configPath);
const app = await createHttpServer({ dbPath: expandPath(config.storage.path) });

await app.listen({ host: config.server.host, port: config.server.port });
```

- [ ] **Step 4: Run HTTP tests**

Run:

```bash
npm test -- tests/server/http.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run all tests and typecheck**

Run:

```bash
npm test
npm run typecheck
```

Expected: both PASS.

---

## Task 8: Final Verification for Backend Core Plan

**Files:**
- Verify all files above.

- [ ] **Step 1: Run complete test suite**

Run:

```bash
npm test
```

Expected: PASS with all test files:

```text
tests/core/decay.test.ts
tests/db/memory-repo.test.ts
tests/server/http.test.ts
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: PASS and `dist/` is created.

- [ ] **Step 4: Manual smoke test server**

Run:

```bash
npm run dev
```

Expected:

```text
Fastify starts on 127.0.0.1:3131
```

In another terminal:

```bash
curl http://127.0.0.1:3131/api/v1/health
```

Expected:

```json
{"ok":true,"service":"memweave-server"}
```

Stop server with Ctrl+C.

---

## Self-Review Checklist

Spec coverage for this first implementation slice:

- [x] MemWeave naming and package scaffold
- [x] Core MemoryType / EdgeType / scope types
- [x] importance / strength / tau / decay semantics
- [x] SQLite schema for tenants, devices, sessions, memories, scopes, edges, observations, access logs
- [x] FTS5 table and triggers
- [x] AccessLog reinforcement path
- [x] Minimal REST health and Memory create/read endpoints

Intentionally deferred to follow-up plans:

- sqlite-vec runtime integration and vector search
- LLM value gate / compression / edge extraction
- smart search / RRF / graph traversal
- cache-aware injection bundles
- MCP shim
- Web UI

Placeholder scan: no placeholder markers, vague deferred implementation phrases, or undefined function names remain.
