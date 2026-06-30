import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { parse, printParseErrorCode } from 'jsonc-parser';
import type { ParseError } from 'jsonc-parser';
import { z } from 'zod';

/**
 * MemWeave config schema, organized into sections matching the design spec (§9.9).
 *
 * Each section is optional and has sensible defaults so a missing config file
 * (or partial override) still works for local development.
 */

// --- Section: server ---
const ServerConfigSchema = z.object({
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(1).max(65535).default(3131)
});

// --- Section: storage ---
const StorageConfigSchema = z.object({
  path: z.string().default('~/.memweave/data/memweave.db')
});

// --- Section: auth ---
const AuthConfigSchema = z.object({
  defaultTenantName: z.string().default('default'),
  deviceApiKey: z.string().default('dev-local-key'),
  /** When true, the Bearer-token middleware is enforced on /api/v1/* (except /health). */
  requireAuth: z.boolean().default(false)
});

// --- Section: ollama (local LLM fallback) ---
const OllamaConfigSchema = z.object({
  /** Ollama server host. Default: 127.0.0.1. */
  host: z.string().default('127.0.0.1'),
  /** Ollama server port. Default: 11434. */
  port: z.number().int().min(1).max(65535).default(11434),
  /** Model to use for LLM tasks (compression/value-gate/edge-extract). */
  model: z.string().default('qwen2.5:3b'),
  /** When true, attempt to spawn `ollama serve` if the server isn't running. */
  autoStart: z.boolean().default(true),
  /** When true, `ollama pull` the model on first use if it isn't present. */
  autoPull: z.boolean().default(true),
  /** Timeout (ms) for a single LLM call. Default: 120s (local CPU inference is slow). */
  timeoutMs: z.number().int().positive().default(120000)
});

// --- Section: embedding ---
const EmbeddingConfigSchema = z.object({
  provider: z.enum(['local-xenova', 'openai-compatible', 'noop']).default('local-xenova'),
  model: z.string().default('Xenova/nomic-embed-text-v1'),
  dimensions: z.number().int().positive().default(768),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  /** Max texts to embed per background-worker batch. */
  batchSize: z.number().int().positive().default(16)
});

// --- Section: llm ---
const LlmConfigSchema = z.object({
  /**
   * Provider kind. `ollama` is the zero-config local fallback — it targets a
   * local Ollama server (OpenAI-compatible protocol) and needs no apiKey.
   * `openai-compatible` points at any OpenAI-compatible endpoint (requires
   * apiKey). `noop` disables all LLM features (consolidation degrades to
   * rule-based; no compression/edge-extraction).
   */
  provider: z.enum(['ollama', 'openai-compatible', 'noop']).default('ollama'),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string().default('qwen2.5:3b'),
  temperature: z.number().min(0).max(2).default(0.2),
  maxTokens: z.number().int().positive().default(2048),
  /** Ollama-specific settings (used when provider is 'ollama'). */
  ollama: OllamaConfigSchema.optional()
});

// --- Section: consolidation ---
const ConsolidationConfigSchema = z.object({
  enabled: z.boolean().default(true),
  intervalHours: z.number().positive().default(6),
  accessLogRetentionDays: z.number().int().positive().default(90)
});

// --- Section: injection ---
const InjectionConfigSchema = z.object({
  sessionStartBudget: z.number().int().positive().default(1200),
  promptDeltaBudget: z.number().int().positive().default(800),
  filePackBudget: z.number().int().positive().default(1000),
  failureDeltaBudget: z.number().int().positive().default(1500)
});

// --- Section: search (RRF + layers) ---
const SearchConfigSchema = z.object({
  rrfK: z.number().positive().default(60),
  /** Per-layer recall limits before fusion. */
  bm25Limit: z.number().int().positive().default(50),
  vectorLimit: z.number().int().positive().default(50),
  graphLimit: z.number().int().positive().default(30),
  causalLimit: z.number().int().positive().default(30),
  /** Minimum cosine similarity for vector results. */
  vectorMinSimilarity: z.number().min(-1).max(1).default(0.55),
  /** When true, vector/graph/causal layers are skipped (BM25-only). */
  bm25Only: z.boolean().default(false)
});

// Note: we keep the top-level schema's sub-schemas marked `.optional()` because
// Zod v4 in this project does not auto-fill sub-object defaults when the parent
// receives `undefined`. We compensate in `loadConfig` by always parsing each
// sub-section with `obj.section ?? {}`. The exported `MemWeaveConfig` type is
// the *fully populated* shape (all sections always present).
const ConfigSchema = z.object({
  server: ServerConfigSchema.optional(),
  storage: StorageConfigSchema.optional(),
  auth: AuthConfigSchema.optional(),
  embedding: EmbeddingConfigSchema.optional(),
  llm: LlmConfigSchema.optional(),
  consolidation: ConsolidationConfigSchema.optional(),
  injection: InjectionConfigSchema.optional(),
  search: SearchConfigSchema.optional()
});

export type MemWeaveConfig = {
  server: ServerConfig;
  storage: StorageConfig;
  auth: AuthConfig;
  embedding: EmbeddingConfig;
  llm: LlmConfig;
  consolidation: ConsolidationConfig;
  injection: InjectionConfig;
  search: SearchConfig;
};
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type StorageConfig = z.infer<typeof StorageConfigSchema>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;
export type LlmConfig = z.infer<typeof LlmConfigSchema>;
export type OllamaConfig = z.infer<typeof OllamaConfigSchema>;
export type ConsolidationConfig = z.infer<typeof ConsolidationConfigSchema>;
export type InjectionConfig = z.infer<typeof InjectionConfigSchema>;
export type SearchConfig = z.infer<typeof SearchConfigSchema>;

export function expandPath(value: string): string {
  if (value.startsWith('~/')) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

export function expandEnv(value: string): string {
  if (!value.startsWith('env://')) return value;
  const name = value.slice('env://'.length);
  const resolved = process.env[name];
  if (!resolved) throw new Error(`Missing environment variable ${name}`);
  return resolved;
}

/**
 * Resolve any `env://NAME` placeholders in string fields. Returns a new object.
 * Leaves non-string values untouched.
 */
export function resolveEnvPlaceholders<T>(cfg: T): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return expandEnv(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(cfg) as T;
}

/** Default config (no file given). */
export function defaultConfig(): MemWeaveConfig {
  return resolveEnvPlaceholders({
    server: ServerConfigSchema.parse({}),
    storage: StorageConfigSchema.parse({}),
    auth: AuthConfigSchema.parse({}),
    embedding: EmbeddingConfigSchema.parse({}),
    llm: LlmConfigSchema.parse({}),
    consolidation: ConsolidationConfigSchema.parse({}),
    injection: InjectionConfigSchema.parse({}),
    search: SearchConfigSchema.parse({})
  });
}

export function loadConfig(path?: string): MemWeaveConfig {
  let parsed: unknown = {};
  if (path) {
    const raw = readFileSync(path, 'utf8');
    const errors: ParseError[] = [];
    parsed = parse(raw, errors);
    if (errors.length > 0) {
      const details = errors
        .map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`)
        .join('; ');
      throw new Error(`Invalid config file "${path}": ${details}`);
    }
  }
  // Merge parsed file with defaults, section by section.
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const cfg: MemWeaveConfig = {
    server: ServerConfigSchema.parse(obj.server ?? {}),
    storage: StorageConfigSchema.parse(obj.storage ?? {}),
    auth: AuthConfigSchema.parse(obj.auth ?? {}),
    embedding: EmbeddingConfigSchema.parse(obj.embedding ?? {}),
    llm: LlmConfigSchema.parse(obj.llm ?? {}),
    consolidation: ConsolidationConfigSchema.parse(obj.consolidation ?? {}),
    injection: InjectionConfigSchema.parse(obj.injection ?? {}),
    search: SearchConfigSchema.parse(obj.search ?? {})
  };
  return resolveEnvPlaceholders(cfg);
}
