# src/providers/

**Embedding + LLM adapters. The "no external LLM required" boundary.**

## OVERVIEW

Puggable providers. The default install ships `noop` adapters so the server boots without any API keys. Real adapters (`openai-compatible`, `local-xenova`, `openai`) are wired in via `memweave.config.jsonc`.

## STRUCTURE

```
src/providers/
├── embedding/
│   ├── index.ts                  # resolveEmbeddingProvider(config) factory
│   ├── noop.ts                   # Returns []; triggers BM25-only retrieval
│   ├── openai-compatible.ts      # /v1/embeddings against any OpenAI-compatible API
│   └── local-xenova.ts           # @xenova/transformers in-process
└── llm/
    ├── index.ts                  # resolveLlmProvider(config) factory
    ├── noop.ts                   # Pure rule-based consolidation
    └── openai.ts                 # Chat Completions client
```

## WHERE TO LOOK

| Symbol | File | Role |
|---|---|---|
| `resolveEmbeddingProvider(config)` | `embedding/index.ts` | Reads `embedding.provider`; returns `{ embed(texts): Promise<number[][]>, dimensions: number }` |
| `resolveLlmProvider(config)` | `llm/index.ts` | Reads `llm.provider`; returns `{ chat(messages): Promise<string>, complete(prompt): Promise<string> }` |

## CONVENTIONS

- Each provider exports a single function returning an object with the contract methods — no classes.
- `noop` is the **default** for both. If a user ships `embedding.dimensions: 0`, the server skips the vector layer entirely (BM25 + graph + causal only).
- Provider modules never read `process.env` directly; they accept config from `loadConfig()`.

## ANTI-PATTERNS

- **NEVER** add a hard dependency on a paid API. Adapters are opt-in; the noop path must always work.
- **NEVER** catch and swallow provider errors. Bubble them up — `retrieval/` and `workers/` decide how to fall back.
- **NEVER** call a provider from inside a DB transaction. Network calls don't belong in transactions.
