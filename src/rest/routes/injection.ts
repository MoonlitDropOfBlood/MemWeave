import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { openDatabase } from '../../db/database.js';
import { searchMemories } from '../../retrieval/search-engine.js';
import { buildStablePack, buildDeltaPack, createContentHash, type MemoryLite } from '../../injection/bundler.js';
import { formatMemoriesAsXml, type MemoryForFormat } from '../../injection/formatter.js';

const TENANT_DEFAULT = 'tenant_default';

const InjectRequestSchema = z.object({
  sessionId: z.string().min(1),
  phase: z.enum(['session_start', 'prompt_delta', 'file_pack', 'failure_delta']),
  query: z.string().optional(),
  files: z.array(z.string()).optional(),
  alreadyInjected: z.array(z.string()).optional()
});

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

export function registerInjectionRoute(app: FastifyInstance, dbPath: string): void {
  app.post('/api/v1/inject', async (request, reply) => {
    const input = InjectRequestSchema.parse(request.body);
    const db = openDatabase(dbPath);

    try {
      const alreadyInjected = new Set(input.alreadyInjected ?? []);
      let result: { memoryIds: string[]; contentHash: string; estimatedTokens: number };
      let contextMemories: MemoryForFormat[] = [];

      if (input.phase === 'session_start') {
        // Stable pack: top long/medium memories
        const stableRows = db.prepare(`
          SELECT id, type, tier, title, summary, strength, importance
          FROM memories
          WHERE tenant_id = ? AND deleted_at IS NULL
            AND (tier = 'long' OR (tier = 'medium' AND strength >= 0.4))
            AND access_count >= 1
          ORDER BY tier ASC, strength * importance DESC
          LIMIT 50
        `).all(TENANT_DEFAULT) as MemoryLite[];

        result = buildStablePack(stableRows, { budget: 1200 });
        contextMemories = stableRows.filter(m => result.memoryIds.includes(m.id)) as MemoryForFormat[];
      } else {
        // Delta pack: search for relevant memories
        if (!input.query && (!input.files || input.files.length === 0)) {
          // Nothing to search for, return empty bundle
          result = { memoryIds: [], contentHash: createContentHash(input.phase, []), estimatedTokens: 0 };
        } else {
          const search = await searchMemories(db, TENANT_DEFAULT, {
            query: input.query ?? input.files?.join(' ') ?? '',
            limit: 10
          });
          const candidates: MemoryLite[] = search.results.map(r => ({
            id: r.candidate.memory.id,
            type: r.candidate.memory.type,
            tier: r.candidate.memory.tier,
            title: r.candidate.memory.title,
            summary: r.candidate.memory.summary,
            strength: r.candidate.memory.strength,
            importance: r.candidate.memory.importance
          }));
          result = buildDeltaPack(candidates, { alreadyInjected, budget: 800 });
          contextMemories = candidates.filter(m => result.memoryIds.includes(m.id)) as MemoryForFormat[];
        }
      }

      const contextXml = formatMemoriesAsXml(input.phase, contextMemories);
      const bundleId = `${input.sessionId}:${input.phase}:${result.contentHash}`;

      const body: InjectResponse = {
        bundleId,
        phase: input.phase,
        memoryIds: result.memoryIds,
        contentHash: result.contentHash,
        estimatedTokens: result.estimatedTokens,
        contextXml
      };
      return reply.code(200).send(body);
    } finally {
      db.close();
    }
  });
}
