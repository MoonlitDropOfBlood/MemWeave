/**
 * In-process service container for the embedded MCP server.
 *
 * Replaces the old HTTP-based MemweaveClient. Tools call methods on
 * this object directly. As of v0.4 the MCP server is embedded in
 * the main server process, so the indirection through fetch is gone.
 */
import type { Db } from '../db/database.js';
import type { LlmProvider } from '../providers/llm/index.js';
import type { EmbeddingProvider } from '../providers/embedding/index.js';
import { MemoryRepo } from '../db/repositories/memory-repo.js';
import { EdgeRepo } from '../db/repositories/edge-repo.js';
import { SessionRepo } from '../db/repositories/session-repo.js';
import { ConsolidationRunRepo } from '../db/repositories/consolidation-run-repo.js';
import { AccessLogRepo } from '../db/repositories/access-log-repo.js';
import { UserProfileRepo, type UserProfile } from '../db/repositories/user-profile-repo.js';
import { searchMemories as runSearch } from '../retrieval/search-engine.js';
import { graphExpand as runGraphExpand } from '../retrieval/graph-traversal.js';
import { runConsolidation } from '../workers/consolidator.js';
import type { EdgeType } from '../core/types.js';
import { CreateMemoryInputSchema } from '../core/types.js';

const TENANT_DEFAULT = 'tenant_default';

export interface McpServiceOptions {
  db: Db;
  tenantId?: string;
  /** LLM provider (for search-time query embedding + future LLM tools). */
  llmProvider?: LlmProvider;
  /** Embedding provider (for search-time query embedding). */
  embeddingProvider?: EmbeddingProvider;
}

export class McpService {
  private readonly db: Db;
  private readonly tenantId: string;
  private readonly memoryRepo: MemoryRepo;
  private readonly edgeRepo: EdgeRepo;
  private readonly sessionRepo: SessionRepo;
  private readonly runRepo: ConsolidationRunRepo;
  private readonly accessLogRepo: AccessLogRepo;
  private readonly profileRepo: UserProfileRepo;
  private readonly llmProvider?: LlmProvider;
  private readonly embeddingProvider?: EmbeddingProvider;

  constructor(options: McpServiceOptions) {
    this.db = options.db;
    this.tenantId = options.tenantId ?? TENANT_DEFAULT;
    this.memoryRepo = new MemoryRepo(this.db);
    this.edgeRepo = new EdgeRepo(this.db);
    this.sessionRepo = new SessionRepo(this.db);
    this.runRepo = new ConsolidationRunRepo(this.db);
    this.accessLogRepo = new AccessLogRepo(this.db);
    this.profileRepo = new UserProfileRepo(this.db);
    this.llmProvider = options.llmProvider;
    this.embeddingProvider = options.embeddingProvider;
  }

  async createMemory(input: Record<string, unknown>): Promise<unknown> {
    // The MCP tool surface only takes user-facing fields (content,
    // type, title, concepts, files, scopes, importance). Server-side
    // fields like tenantId, source, summary, importance/confidence,
    // scopeLevel are filled here so the LLM never has to know about
    // them. The summary is auto-derived from content (capped) to
    // avoid forcing the LLM to write a parallel summary.
    const content = typeof input['content'] === 'string' ? input['content'] : '';
    const title = typeof input['title'] === 'string' ? input['title'] : '';
    const summary = content.length > 0 ? content.slice(0, 200) : title;
    const importance = typeof input['importance'] === 'number'
      ? input['importance']
      : 5;
    const concepts = Array.isArray(input['concepts']) ? input['concepts'] : [];
    const files = Array.isArray(input['files']) ? input['files'] : [];
    const scopes = Array.isArray(input['scopes'])
      ? input['scopes'] as Array<{ key: string; value: string }>
      : [];
    const scopeLevel = scopes.some((s) => s.key === 'project') ? 'project' : 'global';

    const enriched = {
      tenantId: this.tenantId,
      type: input['type'] ?? 'fact',
      title,
      content,
      summary,
      concepts,
      files,
      importance,
      // Default confidence: 0.8 (high) for explicit user saves; the
      // MemoryRepo's write-side dedup gate uses this to score Jaccard
      // against existing memories, so a reasonable default is fine.
      confidence: 0.8,
      source: 'user_explicit' as const,
      scopeLevel,
      scopes
    };
    const parsed = CreateMemoryInputSchema.parse(enriched);
    return this.memoryRepo.create(parsed);
  }

  async getMemory(id: string): Promise<unknown> {
    return this.memoryRepo.getById(this.tenantId, id);
  }

  async deleteMemory(id: string): Promise<{ ok: true; memoryId: string; deletedAt: number }> {
    const deletedAt = Date.now();
    this.db.prepare('UPDATE memories SET deleted_at = ? WHERE tenant_id = ? AND id = ?')
      .run(deletedAt, this.tenantId, id);
    return { ok: true, memoryId: id, deletedAt };
  }

  async searchMemories(input: Record<string, unknown>): Promise<unknown> {
    // Search engine validates its own input shape; cast is safe at
    // this boundary because every tool has a Zod-validated schema.
    const opts = input as Record<string, unknown>;

    // ── Query embedding (the wiring that was missing) ────────────────────
    // The vector layer is skipped unless `queryEmbedding` is supplied
    // (search-engine.ts:88 guard). Previously NO caller generated one, so
    // vector/graph/causal layers were dead and retrieval was BM25-only. When
    // an embedding provider is configured (default: local-xenova), embed the
    // query string here so the full 4-layer fusion actually runs.
    if (
      !opts.queryEmbedding &&
      this.embeddingProvider &&
      typeof opts.query === 'string' &&
      opts.query.trim().length > 0 &&
      opts.bm25Only !== true
    ) {
      try {
        const vec = await this.embeddingProvider.embed(opts.query);
        opts.queryEmbedding = vec;
      } catch {
        // Embedding failure is non-fatal — search degrades to BM25.
      }
    }

    return runSearch(this.db, this.tenantId, opts as unknown as Parameters<typeof runSearch>[2]);
  }

  /**
   * Explicitly create an edge between two memories. This is the most reliable
   * way to establish associations: the agent knows the relationship at save
   * time (no LLM inference needed). Previously there was NO way to create an
   * edge other than the graph-worker (LLM-based, which was never started).
   */
  createEdge(input: {
    fromMemoryId: string;
    toMemoryId: string;
    type: EdgeType;
    reason?: string;
    strength?: number;
  }): { ok: true; edgeId: string } {
    // Validate both memories exist and are in the same tenant.
    const from = this.memoryRepo.getById(this.tenantId, input.fromMemoryId);
    const to = this.memoryRepo.getById(this.tenantId, input.toMemoryId);
    if (!from) throw new Error(`Memory not found: ${input.fromMemoryId}`);
    if (!to) throw new Error(`Memory not found: ${input.toMemoryId}`);
    if (input.fromMemoryId === input.toMemoryId) throw new Error('Cannot link a memory to itself');

    const record = this.edgeRepo.create({
      tenantId: this.tenantId,
      fromMemoryId: input.fromMemoryId,
      toMemoryId: input.toMemoryId,
      type: input.type,
      strength: input.strength ?? 0.7,
      reason: input.reason ?? ''
    });
    return { ok: true, edgeId: record.id };
  }

  // ── User profile (batch F) ─────────────────────────────────────────────
  getProfile(userKey: string = 'default'): UserProfile | null {
    return this.profileRepo.get(this.tenantId, userKey);
  }

  updateProfile(input: { userKey?: string; traits?: string[]; summary?: string }): UserProfile {
    return this.profileRepo.upsert({
      tenantId: this.tenantId,
      userKey: input.userKey ?? 'default',
      traits: input.traits,
      summary: input.summary
    });
  }

  async graphQuery(memoryId: string, opts: { depth?: number; direction?: 'in' | 'out' | 'both'; limit?: number }): Promise<unknown> {
    return runGraphExpand(this.db, {
      tenantId: this.tenantId,
      startMemoryId: memoryId,
      depth: opts.depth ?? 1,
      direction: opts.direction ?? 'both',
      maxNodes: opts.limit ?? 30
    });
  }

  async listSessions(opts: { limit?: number }): Promise<unknown> {
    const rows = this.sessionRepo.listRecent(this.tenantId, opts.limit ?? 10);
    return { sessions: rows, total: rows.length };
  }

  async triggerConsolidation(opts: { tier?: 'short' | 'medium' | 'long' | 'all'; dryRun?: boolean }): Promise<unknown> {
    return runConsolidation(this.db, this.tenantId, { dryRun: opts.dryRun ?? false });
  }

  CreateMemoryInputSchema = CreateMemoryInputSchema;
}
