import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../packages/server/src/db/database.js';
import type { LlmProvider } from '../../packages/server/src/providers/llm/index.js';
import { openDatabase } from '../../packages/server/src/db/database.js';
import { MemoryRepo } from '../../packages/server/src/db/repositories/memory-repo.js';
import { enrichMemories } from '../../packages/server/src/workers/enricher.js';

let db: Db;
let dir: string;
let dbPath: string;
let repo: MemoryRepo;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mw-enrich-'));
  dbPath = join(dir, 'test.db');
  db = openDatabase(dbPath);
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  repo = new MemoryRepo(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A fake LLM that returns a canned JSON response (or a sequence of them). */
function fakeLlm(responses: string[]): LlmProvider {
  let i = 0;
  return {
    async call() {
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      return r;
    }
  };
}

function createRawMemory(title: string, content: string, concepts: string[] = []) {
  return repo.create({
    tenantId: 'tenant_default', type: 'fact', title, content, summary: content.slice(0, 200),
    concepts, files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
    scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
  });
}

describe('enrichMemories', () => {
  it('enriches a memory with empty concepts: fills title/summary/concepts', async () => {
    const mem = createRawMemory('OK that is fine. Let me check the issue', 'some raw conversation text about typescript strict mode');
    // concepts empty → candidate for enrichment
    expect(mem.concepts).toEqual([]);

    const llm = fakeLlm([JSON.stringify({
      shouldCreateMemory: true,
      type: 'decision',
      title: 'Use strict TypeScript',
      summary: 'Enable noImplicitAny and exactOptionalPropertyTypes',
      content: 'The team decided to enforce strict TS mode.',
      concepts: ['typescript', 'strict', 'noImplicitAny'],
      importance: 7
    })]);

    const result = await enrichMemories(dbPath, 'tenant_default', llm, undefined, { batchSize: 10 });
    expect(result.enriched).toBe(1);

    const updated = repo.getById('tenant_default', mem.id);
    expect(updated).not.toBeNull();
    expect(updated!.title).toBe('Use strict TypeScript');
    expect(updated!.concepts).toEqual(['typescript', 'strict', 'noImplicitAny']);
    expect(updated!.type).toBe('decision');
    expect(updated!.importance).toBe(7);
  });

  it('parses LLM output wrapped in markdown fences', async () => {
    createRawMemory('Let me research this', 'raw text');
    const llm = fakeLlm(['```json\n{"title":"Researched","summary":"s","content":"c","concepts":["x"],"importance":5,"type":"fact"}\n```']);
    const result = await enrichMemories(dbPath, 'tenant_default', llm, undefined);
    expect(result.enriched).toBe(1);
  });

  it('parses LLM output with trailing commas and prose preamble', async () => {
    const mem = createRawMemory('Let me research this', 'raw text');
    const llm = fakeLlm(['Here is the result:\n{"title":"Researched","summary":"s","content":"c","concepts":["x",],"importance":5,"type":"fact",}']);
    const result = await enrichMemories(dbPath, 'tenant_default', llm, undefined);
    expect(result.enriched).toBe(1);
    expect(repo.getById('tenant_default', mem.id)!.title).toBe('Researched');
  });

  it('keeps original values when LLM returns unparseable output (no data loss)', async () => {
    const mem = createRawMemory('Let me research this', 'original content here');
    const llm = fakeLlm(['I could not produce JSON for this input.']);
    const result = await enrichMemories(dbPath, 'tenant_default', llm, undefined);
    expect(result.enriched).toBe(0);
    expect(result.skipped).toBe(1);
    const unchanged = repo.getById('tenant_default', mem.id);
    expect(unchanged!.title).toBe('Let me research this');
    expect(unchanged!.content).toBe('original content here');
  });

  it('skips memory when LLM says shouldCreateMemory=false', async () => {
    const mem = createRawMemory('Let me research this', 'trivial chitchat');
    const llm = fakeLlm(['{"shouldCreateMemory":false}']);
    const result = await enrichMemories(dbPath, 'tenant_default', llm, undefined);
    expect(result.enriched).toBe(0);
    expect(result.skipped).toBe(1);
    // memory is NOT deleted — just skipped
    expect(repo.getById('tenant_default', mem.id)).not.toBeNull();
  });

  it('clamps invalid type to original, clamps importance to [1,10]', async () => {
    const mem = createRawMemory('Let me research this', 'raw text');
    const llm = fakeLlm([JSON.stringify({
      title: 'T', summary: 's', content: 'c',
      concepts: ['x'], importance: 999, type: 'nonsense_type'
    })]);
    await enrichMemories(dbPath, 'tenant_default', llm, undefined);
    const updated = repo.getById('tenant_default', mem.id)!;
    expect(updated.type).toBe('fact'); // original type preserved
    expect(updated.importance).toBe(10); // clamped
  });

  it('does not pick up memories that already have concepts and clean titles', async () => {
    createRawMemory('Clean Title Here', 'content', ['existing', 'concepts']);
    const llm = fakeLlm(['{"title":"should not be used"}']);
    const result = await enrichMemories(dbPath, 'tenant_default', llm, undefined);
    expect(result.enriched).toBe(0);
    expect(result.skipped).toBe(0); // not even a candidate
  });

  it('respects batchSize limit', async () => {
    for (let i = 0; i < 5; i++) createRawMemory(`Let me do ${i}`, `content ${i}`);
    const llm = fakeLlm([JSON.stringify({ title: 'T', summary: 's', content: 'c', concepts: ['x'], importance: 5, type: 'fact' })]);
    const result = await enrichMemories(dbPath, 'tenant_default', llm, undefined, { batchSize: 2 });
    expect(result.enriched).toBe(2);
  });

  it('dedupes and clamps concepts from LLM output', async () => {
    const mem = createRawMemory('Let me research this', 'raw text');
    const llm = fakeLlm([JSON.stringify({
      title: 'T', summary: 's', content: 'c',
      concepts: ['x', 'x', 'y'.repeat(100), 'z'], importance: 5, type: 'fact'
    })]);
    await enrichMemories(dbPath, 'tenant_default', llm, undefined);
    const updated = repo.getById('tenant_default', mem.id)!;
    expect(updated.concepts).toEqual(['x', 'y'.repeat(100).slice(0, 80), 'z']);
  });
});
