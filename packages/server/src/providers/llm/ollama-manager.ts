import { spawn } from 'node:child_process';
import { logger } from '../../server/logger.js';
import type { OllamaConfig } from '../../core/config.js';

export interface EnsureResult {
  /** True when Ollama is reachable and the model is available. */
  ready: boolean;
  /** Human-readable status for the doctor command / logs. */
  detail: string;
}

/**
 * Ensure a local Ollama server is running and the configured model is pulled.
 *
 * This is the zero-config fallback path: when `llm.provider === 'ollama'` and
 * no external endpoint is configured, we try to bring up a local Ollama so the
 * LLM-dependent features (compression, value-gate, edge-extraction) work out
 * of the box. Every step is best-effort and fail-silent — if Ollama can't be
 * reached, started, or the model can't be pulled, we return `{ ready: false }`
 * and the caller degrades to the noop LLM (rule-based consolidation).
 *
 * The user must have Ollama installed (`ollama` on PATH). We do NOT bundle or
 * install Ollama ourselves — that's a system dependency the doctor command
 * checks for and reports.
 */
export async function ensureOllamaReady(config: OllamaConfig): Promise<EnsureResult> {
  const baseUrl = `http://${config.host}:${config.port}`;

  // 1. Probe: is Ollama already serving?
  const probe = await probeOllama(baseUrl);
  if (!probe.reachable) {
    if (!config.autoStart) {
      return { ready: false, detail: `Ollama not reachable at ${baseUrl} (autoStart disabled)` };
    }
    // 2. Try to spawn `ollama serve` in the background.
    const started = tryStartOllama();
    if (!started) {
      return {
        ready: false,
        detail: `Ollama not reachable at ${baseUrl} and 'ollama' not on PATH. Install from https://ollama.com, or set llm.provider to 'openai-compatible'/'noop'.`
      };
    }
    // Wait for the server to come up (up to 10s).
    const up = await waitForOllama(baseUrl, 10_000);
    if (!up) {
      return { ready: false, detail: `Started 'ollama serve' but it did not become reachable at ${baseUrl} within 10s` };
    }
    logger.info({ baseUrl }, 'ollama serve started');
  }

  // 3. Is the configured model already pulled?
  const models = await listModels(baseUrl);
  if (!models.includes(config.model)) {
    if (!config.autoPull) {
      return { ready: false, detail: `Model '${config.model}' not pulled (autoPull disabled). Run: ollama pull ${config.model}` };
    }
    // 4. Pull the model. This can take minutes on first run (~2GB download).
    logger.info({ model: config.model }, 'pulling ollama model (first use, may take a while)');
    const pulled = await pullModel(config.host, config.port, config.model);
    if (!pulled) {
      return { ready: false, detail: `Failed to pull model '${config.model}'. Run manually: ollama pull ${config.model}` };
    }
    logger.info({ model: config.model }, 'ollama model pulled');
  }

  return { ready: true, detail: `Ollama ready at ${baseUrl}, model ${config.model}` };
}

async function probeOllama(baseUrl: string): Promise<{ reachable: boolean }> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return { reachable: res.ok };
  } catch {
    return { reachable: false };
  }
}

async function waitForOllama(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { reachable } = await probeOllama(baseUrl);
    if (reachable) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function listModels(baseUrl: string): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const json = await res.json() as { models?: Array<{ name: string }> };
    return (json.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

/**
 * Spawn `ollama serve` detached so it survives the parent process. Returns
 * true if the spawn succeeded (not whether the server is up — caller polls).
 */
function tryStartOllama(): boolean {
  try {
    const child = spawn('ollama', ['serve'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.on('error', (err) => {
      logger.warn({ err: err.message }, 'failed to spawn ollama serve');
    });
    // Detach so the child isn't tied to the parent's lifecycle.
    child.unref();
    return true;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'failed to start ollama');
    return false;
  }
}

/**
 * Pull a model via `ollama pull`. Streams progress to the log. Resolves true
 * on exit code 0. Uses the CLI (not the /api/pull HTTP endpoint) so progress
 * is visible to the user running `memweave` in the foreground.
 */
function pullModel(host: string, port: number, model: string): Promise<boolean> {
  return new Promise((resolve) => {
    const env = { ...process.env, OLLAMA_HOST: `${host}:${port}` };
    const child = spawn('ollama', ['pull', model], { stdio: ['ignore', 'pipe', 'pipe'], env });
    let lastProgress = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text && text !== lastProgress) {
        lastProgress = text;
        logger.info({ model, progress: text.slice(0, 80) }, 'ollama pull');
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      logger.warn({ model, err: chunk.toString().trim().slice(0, 120) }, 'ollama pull stderr');
    });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}
