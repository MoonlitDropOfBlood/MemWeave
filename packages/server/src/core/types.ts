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

export const SourceClientSchema = z.enum(['opencode', 'cursor', 'claude_code', 'codex', 'rest_api']);
export type SourceClient = z.infer<typeof SourceClientSchema>;

export const ScopeTagSchema = z.object({
  key: ScopeKeySchema,
  value: z.string().min(1)
});
export type ScopeTag = z.infer<typeof ScopeTagSchema>;

/**
 * Hard limits on user-controllable memory fields. These exist to keep a
 * buggy or malicious LLM from inserting 10MB of text, 10k concepts, etc.,
 * which would balloon the FTS5 index and slow down every search.
 */
export const MEMORY_LIMITS = {
  /** Max body length in chars. ~30k tokens; well above any single memory. */
  CONTENT_MAX: 100_000,
  /** Max concept count per memory. Real memories have 3-10. */
  CONCEPTS_MAX: 50,
  /** Max file associations per memory. */
  FILES_MAX: 50
} as const;

export const CreateMemoryInputSchema = z.object({
  tenantId: z.string().min(1),
  type: MemoryTypeSchema,
  title: z.string().min(1).max(120),
  content: z.string().min(1).max(MEMORY_LIMITS.CONTENT_MAX),
  summary: z.string().min(1).max(500),
  concepts: z.array(z.string().min(1).max(100)).max(MEMORY_LIMITS.CONCEPTS_MAX).default([]),
  files: z.array(z.string().min(1).max(500)).max(MEMORY_LIMITS.FILES_MAX).default([]),
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
  'manual_view',
  'dedup_reinforce'
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
