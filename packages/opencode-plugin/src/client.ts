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
}
