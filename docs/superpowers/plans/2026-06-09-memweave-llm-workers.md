# MemWeave LLM Workers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build LLM-powered background workers that transform raw Observations into structured Memories with typed Edges, and periodically consolidate memory tiers.

**Architecture:** A generic LLM provider abstraction layer plus four background workers: Value Gate (filter noise), Compressor (Observation → MemoryCandidate), Association Engine (extract Edges), and Consolidator (tier promotion/eviction). Workers run as in-process background intervals on the existing `memweave-server`.

**Tech Stack:** Node.js 20+, TypeScript, OpenAI-compatible API, existing `src/core/` types and `src/db/` repositories.

**Prerequisites:** `memweave-server` backend core must be running.

---

## File Structure

```text
src/providers/
  llm/
    index.ts         — LLM provider interface + factory
    openai.ts        — OpenAI-compatible implementation
    noop.ts          — No-op fallback (returns empty strings)
src/prompts/
  value-gate.ts      — Value gate system prompt + builder
  compression.ts     — Compression system prompt + builder
  edge-extract.ts    — Edge extraction prompt + builder
src/workers/
  value-gate.ts      — Value gate worker
  compressor.ts      — Compression worker
  association.ts     — Association/edge extraction worker
  consolidator.ts    — Consolidation worker (tier promotion, eviction)
tests/providers/
  llm.test.ts
tests/workers/
  value-gate.test.ts
  compressor.test.ts
  association.test.ts
  consolidator.test.ts
```

---

## Task 1: LLM Provider Abstraction

**Files:**
- Create: `src/providers/llm/index.ts`
- Create: `src/providers/llm/openai.ts`
- Create: `src/providers/llm/noop.ts`
- Create: `tests/providers/llm.test.ts`

- [ ] **Step 1: Define LLM provider interface**

Create `src/providers/llm/index.ts`:

```typescript
export interface LlmProvider {
  /** Compress/transform content. System prompt guides behavior, user prompt provides input. */
  call(systemPrompt: string, userPrompt: string): Promise<string>;
}

export type LlmProviderKind = 'openai-compatible' | 'noop';

export function createLlmProvider(kind: LlmProviderKind, config: Record<string, unknown>): LlmProvider {
  switch (kind) {
    case 'openai-compatible':
      return new (require('./openai.js').OpenaiLlmProvider)(config);
    case 'noop':
    default:
      return new (require('./noop.js').NoopLlmProvider)();
  }
}
```

- [ ] **Step 2: Create OpenAI-compatible provider**

Create `src/providers/llm/openai.ts`:

```typescript
import { z } from 'zod';
import type { LlmProvider } from './index.js';

const OpenaiConfigSchema = z.object({
  baseUrl: z.string().default('https://api.openai.com/v1'),
  apiKey: z.string(),
  model: z.string().default('gpt-4o-mini'),
  temperature: z.number().min(0).max(2).default(0.2),
  maxTokens: z.number().int().positive().default(2048)
});

export class OpenaiLlmProvider implements LlmProvider {
  private config: z.infer<typeof OpenaiConfigSchema>;

  constructor(raw: Record<string, unknown>) {
    this.config = OpenaiConfigSchema.parse(raw);
  }

  async call(systemPrompt: string, userPrompt: string): Promise<string> {
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens
      }),
      signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM API error ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = await res.json() as { choices: Array<{ message: { content: string | null } }> };
    return json.choices?.[0]?.message?.content ?? '';
  }
}
```

- [ ] **Step 3: Create no-op provider**

Create `src/providers/llm/noop.ts`:

```typescript
import type { LlmProvider } from './index.js';

export class NoopLlmProvider implements LlmProvider {
  async call(_systemPrompt: string, _userPrompt: string): Promise<string> {
    return '';
  }
}
```

- [ ] **Step 4: Write provider tests**

Create `tests/providers/llm.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { NoopLlmProvider } from '../../src/providers/llm/noop.js';

describe('NoopLlmProvider', () => {
  const provider = new NoopLlmProvider();

  it('returns empty string', async () => {
    const result = await provider.call('system', 'user');
    expect(result).toBe('');
  });
});
```

- [ ] **Step 5: Run tests and typecheck**

```bash
npm test -- tests/providers/llm.test.ts
npm run typecheck
```

Expected: both PASS.

---

## Task 2: Compression Prompt + Value Gate Prompt

**Files:**
- Create: `src/prompts/compression.ts`
- Create: `src/prompts/value-gate.ts`

- [ ] **Step 1: Create compression prompt**

Create `src/prompts/compression.ts`:

```typescript
export const COMPRESSION_SYSTEM = `You are a memory compression engine for an AI coding agent. Your job is to extract the essential information from a tool usage observation and compress it into structured data.

Output EXACTLY this JSON with no additional text:
{
  "shouldCreateMemory": true,
  "type": "fact|decision|preference|event|project_context|lesson|code_pattern|bug|workflow",
  "title": "Short descriptive title (max 80 chars)",
  "summary": "One-line summary (max 200 chars)",
  "content": "2-3 sentence narrative of what happened and why it matters",
  "concepts": ["technical concept or pattern"],
  "files": ["path/to/file"],
  "importance": 5,
  "confidence": 0.8,
  "scopeLevel": "project",
  "scopes": [
    { "key": "project", "value": "project-name" },
    { "key": "domain", "value": "domain-name" },
    { "key": "topic", "value": "topic-name" }
  ],
  "candidateEdges": [
    { "targetHint": "related memory title or concept", "type": "related_to", "reason": "why related", "confidence": 0.7 }
  ]
}

Rules:
- Be concise but preserve ALL technically relevant details.
- File paths must be exact.
- Importance: 1-3 for routine reads, 4-6 for edits/commands, 7-9 for architectural decisions, 10 for breaking changes.
- Concepts should be reusable search terms.
- Strip any secrets, tokens, or credentials from the output.
- If the observation is not worth remembering, set shouldCreateMemory to false.`;

export function buildCompressionPrompt(observation: {
  hookType: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  userPrompt?: string;
  timestamp: string;
}): string {
  const parts = [`Timestamp: ${observation.timestamp}`, `Hook: ${observation.hookType}`];
  if (observation.toolName) parts.push(`Tool: ${observation.toolName}`);
  if (observation.toolInput) parts.push(`Input:\n${observation.toolInput.slice(0, 4000)}`);
  if (observation.toolOutput) parts.push(`Output:\n${observation.toolOutput.slice(0, 8000)}`);
  if (observation.userPrompt) parts.push(`User prompt:\n${observation.userPrompt.slice(0, 2000)}`);
  return parts.join('\n\n');
}
```

- [ ] **Step 2: Create value gate prompt**

Create `src/prompts/value-gate.ts`:

```typescript
export const VALUE_GATE_SYSTEM = `You are a value gate for an AI coding agent's memory system. Given a raw observation, determine whether it contains information worth remembering.

Output EXACTLY this JSON with no additional text:
{
  "shouldCreateMemory": true,
  "reason": "Why this is worth remembering",
  "suggestedTypes": ["decision"],
  "priority": "high"
}

Rules:
- shouldCreateMemory = true for: explicit user requests to remember, architectural decisions, bug root causes, user preferences, project conventions, workflow patterns.
- shouldCreateMemory = false for: routine file reads, simple grep searches, repeated successful commands with no new information, transient state.
- priority: "high" for decisions/bugs/preferences, "medium" for project context/lessons, "low" for uncertain cases.
- suggestedTypes should be the most likely MemoryType(s) from: fact, decision, preference, event, project_context, lesson, code_pattern, bug, workflow.`;

export function buildValueGatePrompt(observation: {
  hookType: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  userPrompt?: string;
}): string {
  const parts = [`Hook: ${observation.hookType}`];
  if (observation.toolName) parts.push(`Tool: ${observation.toolName}`);
  if (observation.toolInput) parts.push(`Input:\n${observation.toolInput.slice(0, 2000)}`);
  if (observation.toolOutput) parts.push(`Output:\n${observation.toolOutput.slice(0, 4000)}`);
  if (observation.userPrompt) parts.push(`User prompt:\n${observation.userPrompt.slice(0, 1000)}`);
  return parts.join('\n\n');
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

---

## Task 3: Value Gate Worker

**Files:**
- Create: `src/workers/value-gate.ts`
- Create: `tests/workers/value-gate.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/workers/value-gate.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { ValueGateResult, evaluateObservation } from '../../src/workers/value-gate.js';

describe('ValueGate', () => {
  it('rejects routine file reads', () => {
    const result = evaluateObservation({
      hookType: 'post_tool_use',
      toolName: 'Read',
      toolInput: 'src/core/types.ts',
      toolOutput: 'import { z } from ...'
    });
    expect(result.shouldCreateMemory).toBe(false);
  });

  it('accepts explicit user save requests', () => {
    const result = evaluateObservation({
      hookType: 'prompt_submit',
      userPrompt: '记住这个：项目使用 SQLite 作为本地存储'
    });
    expect(result.shouldCreateMemory).toBe(true);
    expect(result.suggestedTypes).toContain('fact');
  });

  it('accepts architectural decisions', () => {
    const result = evaluateObservation({
      hookType: 'prompt_submit',
      userPrompt: '我们就用 MCP + REST，不上 WebSocket'
    });
    expect(result.shouldCreateMemory).toBe(true);
    expect(result.suggestedTypes).toContain('decision');
  });

  it('accepts tool failures', () => {
    const result = evaluateObservation({
      hookType: 'post_tool_use',
      toolName: 'Bash',
      toolOutput: 'Error: build failed\nType mismatch in src/app.ts'
    });
    expect(result.shouldCreateMemory).toBe(true);
    expect(result.suggestedTypes).toContain('bug');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test -- tests/workers/value-gate.test.ts
```

Expected: FAIL because `evaluateObservation` does not exist.

- [ ] **Step 3: Implement value gate with keyword rules (LLM-free fallback)**

Create `src/workers/value-gate.ts`:

```typescript
export interface ValueGateInput {
  hookType: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  userPrompt?: string;
  error?: string;
}

export interface ValueGateResult {
  shouldCreateMemory: boolean;
  reason: string;
  suggestedTypes: string[];
  priority: 'low' | 'medium' | 'high';
}

const REMEMBER_PATTERNS = [
  /记住/i, /记住这个/i, /以后遇到/i, /记住.*偏好/i,
  /这个是我的偏好/i, /这个方案确定了/i, /以后记住/i
];

const DECISION_PATTERNS = [
  /我们就用/i, /决定.*用/i, /选择.*而不是/i, /不用.*了/i,
  /采用/i, /使用.*方案/i, /确定.*架构/i
];

const FAILURE_KEYWORDS = ['error', 'fail', 'crash', 'exception', 'build failed', 'test failed'];

export function evaluateObservation(input: ValueGateInput): ValueGateResult {
  const combined = [
    input.userPrompt || '',
    input.toolOutput || '',
    input.error || ''
  ].join('\n').toLowerCase();

  // Check for explicit "remember" requests
  for (const pattern of REMEMBER_PATTERNS) {
    if (pattern.test(input.userPrompt || '')) {
      return { shouldCreateMemory: true, reason: 'User explicitly asked to remember', suggestedTypes: ['fact', 'preference'], priority: 'high' };
    }
  }

  // Check for decisions
  for (const pattern of DECISION_PATTERNS) {
    if (pattern.test(input.userPrompt || '')) {
      return { shouldCreateMemory: true, reason: 'Architectural decision detected', suggestedTypes: ['decision'], priority: 'high' };
    }
  }

  // Check for tool failures
  if (input.hookType === 'post_tool_use' && input.toolName === 'Bash' && FAILURE_KEYWORDS.some(k => combined.includes(k))) {
    return { shouldCreateMemory: true, reason: 'Tool failure detected', suggestedTypes: ['bug'], priority: 'high' };
  }

  // Check for prompt_submit with substantive content
  if (input.hookType === 'prompt_submit' && input.userPrompt && input.userPrompt.length > 50) {
    return { shouldCreateMemory: true, reason: 'Substantive user prompt', suggestedTypes: ['event'], priority: 'medium' };
  }

  // Default: reject routine operations
  return { shouldCreateMemory: false, reason: 'Routine operation, no memory value', suggestedTypes: [], priority: 'low' };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- tests/workers/value-gate.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

---

## Task 4: Compression Worker

**Files:**
- Create: `src/workers/compressor.ts`
- Create: `tests/workers/compressor.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/workers/compressor.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { compressObservation } from '../../src/workers/compressor.js';
import { NoopLlmProvider } from '../../src/providers/llm/noop.js';

describe('compressObservation', () => {
  it('returns null for noop provider (empty response)', async () => {
    const provider = new NoopLlmProvider();
    const result = await compressObservation(provider, {
      hookType: 'post_tool_use',
      toolName: 'Read',
      timestamp: new Date().toISOString()
    });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test -- tests/workers/compressor.test.ts
```

Expected: FAIL because `compressObservation` does not exist.

- [ ] **Step 3: Implement compression worker**

Create `src/workers/compressor.ts`:

```typescript
import type { LlmProvider } from '../providers/llm/index.js';
import { COMPRESSION_SYSTEM, buildCompressionPrompt } from '../prompts/compression.js';

export interface CompressInput {
  hookType: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  userPrompt?: string;
  timestamp: string;
}

export interface MemoryCandidate {
  shouldCreateMemory: boolean;
  type: string;
  title: string;
  summary: string;
  content: string;
  concepts: string[];
  files: string[];
  importance: number;
  confidence: number;
  scopeLevel: string;
  scopes: Array<{ key: string; value: string }>;
  candidateEdges: Array<{ targetHint: string; type: string; reason: string; confidence: number }>;
}

export async function compressObservation(provider: LlmProvider, input: CompressInput): Promise<MemoryCandidate | null> {
  const prompt = buildCompressionPrompt(input);
  const raw = await provider.call(COMPRESSION_SYSTEM, prompt);
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as MemoryCandidate;
    return parsed;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- tests/workers/compressor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

---

## Task 5: Association / Edge Extraction Worker

**Files:**
- Create: `src/prompts/edge-extract.ts`
- Create: `src/workers/association.ts`
- Create: `tests/workers/association.test.ts`

- [ ] **Step 1: Create edge extraction prompt**

Create `src/prompts/edge-extract.ts`:

```typescript
export const EDGE_EXTRACT_SYSTEM = `You are a relationship extraction engine for a memory graph. Given a new memory and a list of existing memories, identify relationships between them.

Output EXACTLY this JSON array with no additional text:
[
  {
    "targetMemoryId": "existing_memory_id",
    "type": "causes|enables|contradicts|supersedes|references|related_to|before|after|duplicates|refines",
    "reason": "Why this relationship exists",
    "confidence": 0.85
  }
]

Rules:
- Only output relationships with confidence >= 0.6.
- If no relationship exists, output an empty array [].
- Be conservative: only create edges when there is a clear, meaningful relationship.`;

export function buildEdgeExtractPrompt(newMemory: { title: string; content: string; concepts: string[] }, existingMemories: Array<{ id: string; title: string; summary: string; concepts: string[] }>): string {
  const newSection = `New memory:\nTitle: ${newMemory.title}\nContent: ${newMemory.content}\nConcepts: ${newMemory.concepts.join(', ')}`;
  const existingSection = existingMemories.map(m =>
    `[${m.id}] Title: ${m.title}\nSummary: ${m.summary}\nConcepts: ${m.concepts.join(', ')}`
  ).join('\n\n');
  return `${newSection}\n\nExisting memories:\n${existingSection}`;
}
```

- [ ] **Step 2: Write failing tests**

Create `tests/workers/association.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { extractEdges } from '../../src/workers/association.js';
import { NoopLlmProvider } from '../../src/providers/llm/noop.js';

describe('extractEdges', () => {
  it('returns empty array for noop provider', async () => {
    const provider = new NoopLlmProvider();
    const result = await extractEdges(provider, { title: 'test', content: 'test', concepts: [] }, []);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

```bash
npm test -- tests/workers/association.test.ts
```

Expected: FAIL because `extractEdges` does not exist.

- [ ] **Step 4: Implement association worker**

Create `src/workers/association.ts`:

```typescript
import type { LlmProvider } from '../providers/llm/index.js';
import { EDGE_EXTRACT_SYSTEM, buildEdgeExtractPrompt } from '../prompts/edge-extract.js';

export interface EdgeCandidate {
  targetMemoryId: string;
  type: string;
  reason: string;
  confidence: number;
}

export async function extractEdges(
  provider: LlmProvider,
  newMemory: { title: string; content: string; concepts: string[] },
  existingMemories: Array<{ id: string; title: string; summary: string; concepts: string[] }>
): Promise<EdgeCandidate[]> {
  if (existingMemories.length === 0) return [];
  const prompt = buildEdgeExtractPrompt(newMemory, existingMemories);
  const raw = await provider.call(EDGE_EXTRACT_SYSTEM, prompt);
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as EdgeCandidate[];
    return Array.isArray(parsed) ? parsed.filter(e => e.confidence >= 0.6) : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 5: Run tests to verify pass**

```bash
npm test -- tests/workers/association.test.ts
```

Expected: PASS.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

---

## Task 6: Consolidation Worker

**Files:**
- Create: `src/workers/consolidator.ts`
- Create: `tests/workers/consolidator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/workers/consolidator.test.ts`:

```typescript
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/database.js';
import { openDatabase } from '../../src/db/database.js';
import { MemoryRepo } from '../../src/db/repositories/memory-repo.js';
import { runConsolidation } from '../../src/workers/consolidator.js';

let db: Db;
let repo: MemoryRepo;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-cons-'));
  db = openDatabase(join(dir, 'test.db'));
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  repo = new MemoryRepo(db);
});

afterEach(() => db.close());

describe('runConsolidation', () => {
  it('evicts short-term memories with zero strength and old age', () => {
    const now = Date.now();
    // Create a memory with zero strength and old age
    db.prepare(`
      INSERT INTO memories (id, tenant_id, tier, type, title, content, summary, concepts_json, concepts_text, files_json, importance, confidence, strength, source, scope_level, tau, access_count, last_decay_at, reinforcement_score, created_at, updated_at)
      VALUES (?, 'tenant_default', 'short', 'event', 'Old memory', 'old', 'old', '[]', '', '[]', 1, 0.5, 0.01, 'system_inferred', 'project', 1, 0, ?, 0, ?, ?)
    `).join(',', 'mem_evict', String(now - 8 * 24 * 60 * 60 * 1000), String(now - 8 * 24 * 60 * 60 * 1000), String(now));

    const result = runConsolidation(db, 'tenant_default', { dryRun: true });
    expect(result.evicted).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test -- tests/workers/consolidator.test.ts
```

Expected: FAIL because `runConsolidation` does not exist.

- [ ] **Step 3: Implement consolidation worker**

Create `src/workers/consolidator.ts`:

```typescript
import type { Db } from '../db/database.js';

export interface ConsolidationResult {
  promoted: number;
  evicted: number;
  merged: number;
  edgesCreated: number;
  summary: string;
}

export function runConsolidation(db: Db, tenantId: string, options: { dryRun?: boolean; tier?: string } = {}): ConsolidationResult {
  const result: ConsolidationResult = { promoted: 0, evicted: 0, merged: 0, edgesCreated: 0, summary: '' };
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  // 1. Evict short-term: strength < 0.1 AND age > 7 days AND 0 access
  const toEvict = db.prepare(`
    SELECT id FROM memories
    WHERE tenant_id = ? AND tier = 'short' AND deleted_at IS NULL
      AND strength < 0.1 AND access_count = 0
      AND (? - created_at) > ?
  `).all(tenantId, now, 7 * DAY) as Array<{ id: string }>;

  if (!options.dryRun) {
    const stmt = db.prepare('UPDATE memories SET deleted_at = ?, eviction_reason = ? WHERE id = ?');
    for (const row of toEvict) {
      stmt.run(now, 'low_strength_old_age', row.id);
    }
  }
  result.evicted = toEvict.length;

  // 2. Promote short→medium: accessed >= 3 times in 7 days OR importance >= 7
  const toPromote = db.prepare(`
    SELECT id FROM memories
    WHERE tenant_id = ? AND tier = 'short' AND deleted_at IS NULL
      AND (access_count >= 3 OR importance >= 7)
  `).all(tenantId) as Array<{ id: string }>;

  if (!options.dryRun) {
    const stmt = db.prepare('UPDATE memories SET tier = ? WHERE id = ?');
    for (const row of toPromote) {
      stmt.run('medium', row.id);
    }
  }
  result.promoted = toPromote.length;

  result.summary = `Evicted ${result.evicted} short-term, promoted ${result.promoted} to medium`;
  return result;
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- tests/workers/consolidator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run all tests and typecheck**

```bash
npm test
npm run typecheck
```

Expected: both PASS.

---

## Self-Review Checklist

Spec coverage:

- [x] LLM provider abstraction (OpenAI-compatible + noop)
- [x] Value gate with keyword rules (LLM-free fallback)
- [x] Compression prompt and worker
- [x] Edge extraction prompt and worker
- [x] Consolidation worker (tier promotion + eviction)
- [x] All workers have unit tests

Placeholder scan: no `TBD`, `TODO`, `fill in details`, or undefined function names.
