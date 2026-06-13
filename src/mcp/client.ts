import { z } from 'zod';

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  service: z.string()
});

export const CreateMemoryResponseSchema = z.object({
  memoryId: z.string(),
  type: z.string(),
  tier: z.string(),
  title: z.string(),
  summary: z.string(),
  createdEdges: z.array(z.any())
});

const GenericObjectSchema = z.record(z.string(), z.unknown());

/**
 * Shape of a single search hit returned by /api/v1/memories/search.
 *
 * In `mode: 'compact'` (default) the server returns only the 7 fields below.
 * In `mode: 'full'` the server also includes `content`, `concepts`, `files`,
 * `importance`, `confidence`, `strength`, `scopes` — all optional here so
 * the same schema validates both modes.
 *
 * `sources` is always a string[] in both modes.
 */
export const SearchResultSchema = z.object({
  memoryId: z.string(),
  type: z.string(),
  tier: z.string(),
  title: z.string(),
  summary: z.string(),
  finalScore: z.number(),
  sources: z.array(z.string()),
  // mode: 'full' extras (all optional)
  content: z.string().optional(),
  concepts: z.array(z.string()).optional(),
  files: z.array(z.string()).optional(),
  importance: z.number().optional(),
  confidence: z.number().optional(),
  strength: z.number().optional(),
  scopes: z.array(z.object({ key: z.string(), value: z.string() })).optional()
});

/** Response from POST /api/v1/memories/search. */
export const SearchResponseSchema = z.object({
  results: z.array(SearchResultSchema),
  totalCandidates: z.number()
});

/** Response from GET /api/v1/memories/:id/graph. */
export const GraphResponseSchema = z.object({
  nodes: z.array(z.object({
    id: z.string(),
    type: z.string(),
    tier: z.string(),
    title: z.string(),
    summary: z.string()
  })),
  edges: z.array(z.object({
    id: z.string(),
    fromMemoryId: z.string(),
    toMemoryId: z.string(),
    type: z.string(),
    strength: z.number(),
    reason: z.string()
  }))
});

/** Response from GET /api/v1/sessions (list endpoint). */
export const SessionSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  deviceId: z.string().nullable(),
  source: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  observationCount: z.number()
});

export const SessionsListResponseSchema = z.object({
  sessions: z.array(SessionSchema),
  total: z.number()
});

/** Response from POST /api/v1/consolidate. The route returns `{ run }` wrapping a single run record. */
export const ConsolidationRunSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
  promoted: z.array(z.string()),
  evicted: z.array(z.string()),
  merged: z.array(z.array(z.string())),
  edgesCreated: z.number(),
  contradictionFound: z.number(),
  dryRun: z.boolean(),
  summary: z.string()
});

export const ConsolidationTriggerResponseSchema = z.object({
  run: ConsolidationRunSchema
});

/** Response from DELETE /api/v1/memories/:id (soft delete). */
export const ForgetResponseSchema = z.object({
  ok: z.boolean(),
  memoryId: z.string(),
  deletedAt: z.number()
});

export interface McpClientOptions {
  baseUrl: string;
  timeout?: number;
}

export class MemweaveClient {
  private baseUrl: string;
  private timeout: number;

  constructor(options: McpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeout = options.timeout ?? 10_000;
  }

  public async request<T>(method: string, path: string, body: unknown | undefined, schema: z.ZodType<T>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { code: 'PARSE_ERROR', message: res.statusText } }));
      const code: string = err?.error?.code ?? 'UNKNOWN';
      const message: string = err?.error?.message ?? `HTTP ${res.status}`;
      throw new Error(`[${code}] ${message}`);
    }

    const data: unknown = await res.json();
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error(`Unexpected response shape: expected object, got ${data === null ? 'null' : typeof data}`);
    }

    return schema.parse(data);
  }

  health(): Promise<z.infer<typeof HealthResponseSchema>> {
    return this.request('GET', '/api/v1/health', undefined, HealthResponseSchema);
  }

  createMemory(input: Record<string, unknown>): Promise<z.infer<typeof CreateMemoryResponseSchema>> {
    return this.request('POST', '/api/v1/memories', input, CreateMemoryResponseSchema);
  }

  getMemory(id: string): Promise<Record<string, unknown>> {
    return this.request('GET', `/api/v1/memories/${encodeURIComponent(id)}`, undefined, GenericObjectSchema);
  }
}
