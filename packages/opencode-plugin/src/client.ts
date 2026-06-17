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

export interface ReportSessionRequest {
  sessionId: string;
  source: 'opencode' | 'cli' | 'mcp' | 'web' | 'sdk';
  title: string;
  deviceId?: string;
}

export interface ObservationScope {
  key: 'project' | 'domain' | 'topic';
  value: string;
}

export interface ReportObservationRequest {
  sessionId: string;
  messageId: string;
  hookType: 'chat.user' | 'chat.assistant' | 'chat.tool';
  text: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  /**
   * v0.5.4+: scope tags attached to the observation. The OpenCode
   * plugin uses `process.cwd()` as a stable `project` value so the
   * consolidation worker can inherit project scoping onto the
   * promoted memory. The server tolerates an empty array for
   * back-compat.
   */
  scopes?: ObservationScope[];
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

  /** Idempotent: server upserts on sessionId. */
  async reportSession(req: ReportSessionRequest): Promise<void> {
    const url = `${this.baseUrl}/api/v1/sessions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(this.timeout)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`reportSession failed: ${res.status} ${text.slice(0, 200)}`);
    }
  }

  /** Idempotent: server upserts on (sessionId, messageId). */
  async reportObservation(req: ReportObservationRequest): Promise<void> {
    const url = `${this.baseUrl}/api/v1/observations`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(this.timeout)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`reportObservation failed: ${res.status} ${text.slice(0, 200)}`);
    }
  }
}
