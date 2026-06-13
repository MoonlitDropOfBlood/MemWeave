# src/providers/

**Embedding + LLM adapters. The "no external LLM required" boundary.**

## OVERVIEW

Puggable providers. The default install ships `noop` adapters so the server boots without any API keys. Real adapters (`openai-compatible`, `local-xenova`, `openai`) are wired in via `memweave.config.jsonc`.

## STRUCTURE

```
src/providers/
├── embedding/
│   ├── index.ts                  # createEmbeddingProvider(options) factory
│   ├── noop.ts                   # Deterministic SHA-256-derived vectors
│   ├── openai-compatible.ts      # /v1/embeddings against any OpenAI-compatible API
│   └── local-xenova.ts           # @xenova/transformers (optional dep, lazy-loaded)
└── llm/
    ├── index.ts                  # createLlmProvider(options) factory
    ├── noop.ts                   # Returns ''; pure rule-based consolidation
    └── openai.ts                 # Chat Completions client
```

## WHERE TO LOOK

| Symbol | File | Role |
|---|---|---|
| `createEmbeddingProvider(options)` | `embedding/index.ts` | `options.kind` selects provider; returns `{ embed, embedBatch, dimensions, model }` |
| `createLlmProvider(options)` | `llm/index.ts` | `options.kind` selects provider; returns `{ call(systemPrompt, userPrompt): Promise<string> }` |

## CONVENTIONS

- Each provider exports a class implementing the `EmbeddingProvider` / `LlmProvider` interface.
- `noop` is the **default** for both. If a user ships `embedding.dimensions: 0`, the server skips the vector layer entirely (BM25 + graph + causal only).
- Provider modules never read `process.env` directly; they accept config from `loadConfig()`.
- `local-xenova` is **optional**: the `@xenova/transformers` package is dynamically imported on first use. If absent, the provider falls back to a deterministic hash-based vector and logs a one-time `console.warn`.

## ANTI-PATTERNS

- **NEVER** add a hard dependency on a paid API. Adapters are opt-in; the noop path must always work.
- **NEVER** catch and swallow provider errors. Bubble them up — `retrieval/` and `workers/` decide how to fall back.
- **NEVER** call a provider from inside a DB transaction. Network calls don't belong in transactions.
