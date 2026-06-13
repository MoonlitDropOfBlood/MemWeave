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
