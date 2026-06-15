# src/

**OpenCode plugin for `@mem-weave/opencode-plugin`. Closes the read loop (auto-injection of summary-only XML) and the write loop (auto-upsert of every chat message back to the MemWeave server).**

## OVERVIEW

`MemweaveInjectPlugin` runs inside the OpenCode process. On every OpenCode boot
it does three things, in order:

1. **Boot-time warning** — emits a `client.app.log({ level: "warn" })` if the
   `mcp.memweave` block is missing from OpenCode's config, telling the user
   exactly how to add it. This is informational only — the plugin cannot
   register it itself (see "MCP registration" below).
2. **`event` hook** — listens to OpenCode's `message.updated` event bus. For
   every completed user/assistant message, reverse-queries the OpenCode SDK
   (`input.client.session.messages`) for the full `Part[]` text, then POSTs
   both `/api/v1/sessions` and `/api/v1/observations` to the server.
   Idempotent on `(sessionId, messageId)` — message replay on OpenCode
   restart does not duplicate.
3. **`experimental.chat.system.transform` hook** — calls the server's
   `/api/v1/inject` endpoint to fetch a token-budgeted XML pack of
   relevant memories, appends it to the system prompt. The XML only
   contains `<title>` + `<summary>` (progressive disclosure).
4. **`tool.execute.before` hook** — when the LLM calls a file-touching
   tool (`Read` / `Edit` / `Write` / `Glob` / `Grep`), requests a
   `file_pack` of file-related memories and queues the XML for the
   next `system.transform` to flush.

## MCP REGISTRATION

**The plugin does NOT register `mcp.memweave` for the user.** OpenCode's
documented plugin hooks ([opencode.ai/docs/plugins/](https://opencode.ai/docs/plugins/))
are: `event`, `tool.execute.before`, `tool.execute.after`, `command.executed`,
`shell.env`, `tool` (custom tool), `experimental.session.compacting`. There
is **no** `config` hook in the runtime — even though `@opencode-ai/plugin`'s
`Hooks` type has one, OpenCode never invokes it.

So the user MUST hand-edit `~/.config/opencode/opencode.json` once:

```jsonc
{
  "plugin": ["@mem-weave/opencode-plugin"],
  "mcp": {
    "memweave": {
      "type": "remote",
      "url": "http://127.0.0.1:3131/mcp",
      "enabled": true
    }
  }
}
```

If the user forgets, OpenCode tries to spawn `@mem-weave/opencode-plugin` as
a stdio MCP server (because no `mcp.memweave` entry exists), the package has
no `bin` field, the spawn fails, and the LLM sees
`MCP error -32000: Connection closed` when calling any `memory_*` tool.
The plugin's boot-time warning is the only way to surface this issue before
the user hits it.

This is the **write-side closure**: without the `event` hook the
system would be read-only from the agent's perspective — high-signal
LLM turns would never become long-term memories.

## STRUCTURE

```
src/
├── index.ts          # MemweaveInjectPlugin main file (4 hooks)
└── client.ts         # MemweaveInjectClient — POST /api/v1/{inject,sessions,observations}
```

## WHERE TO LOOK

| Symbol | File | Role |
|---|---|---|
| `MemweaveInjectPlugin` | `index.ts` | Plugin default export; returns `{ event, 'experimental.chat.system.transform', 'tool.execute.before' }` |
| `API` / `TIMEOUT` | `index.ts` (top-level constants) | `MEMWEAVE_URL` (default `http://127.0.0.1:3131`) + `MEMWEAVE_PLUGIN_TIMEOUT` (default 10s) |
| `INJECTED_CACHE` / `PENDING_FILE_PACKS` | `index.ts` (module scope) | Per-session caches; swept every hour to prevent leaks |
| `FILE_TOOLS` | `index.ts` | `{Read, Edit, Write, Glob, Grep}` — tools that trigger file_pack injection |
| `MemweaveInjectClient` | `client.ts` | HTTP client with `requestInjection()` + `reportSession()` + `reportObservation()` |

## CONVENTIONS

- **Fail-silent**: every network call is wrapped in `try/catch`. A
  MemWeave outage must never break the OpenCode agent.
- **`event` hook reverse-queries the OpenCode SDK** via the host-provided
  `input.client`. We don't keep a separate connection — the plugin
  uses whatever OpenCode gave it.
- **`file_pack` does NOT pollute `INJECTED_CACHE`**: the XML hasn't
  been pushed to the system prompt yet when `tool.execute.before`
  runs, so the memory ids go into `PENDING_FILE_PACKS` and only get
  added to `INJECTED_CACHE` after `system.transform` actually flushes
  them. Otherwise the next `prompt_delta` would skip them even though
  the LLM never saw them.
- **Idempotent session/observation upsert**: the server returns
  `200 + { created: false }` on duplicates. The plugin does not
  need to maintain its own dedup state.

## ANTI-PATTERNS

- **NEVER** register an MCP server from a plugin. OpenCode does not
  call a plugin `config` hook, so any attempt to mutate `config.mcp`
  silently fails. Tell the user to hand-add the `mcp` block; the
  plugin's boot-time warning is the only signal they will get.
- **NEVER** spawn child processes from the plugin. The plugin is
  in-process — all communication goes through HTTP to the server.
- **NEVER** import from `packages/server/src/`. The plugin is its own
  package; the only server contract is the HTTP API.
- **NEVER** add a rethrow path. `event` hook failure means one
  observation is lost — not fatal, must be swallowed.
- **NEVER** cache the message text in `INJECTED_CACHE` before the
  matching `system.transform` has flushed the XML. The plugin must
  wait for the next prompt to actually push the file_pack XML before
  it considers those memories "seen".
- **NEVER** import `Message | AssistantMessage` directly — use the
  OpenCode SDK types from `@opencode-ai/plugin`. The host OpenCode
  process defines what shape the messages take.

## COMPATIBILITY

- Targets `@opencode-ai/plugin` ≥ 1.17.x.
- `EventMessageUpdated` and `MessagePartUpdated` are stable since
  OpenCode 1.17. We use `message.updated` (not `message.part.updated`)
  to avoid high-frequency stream events.
- The `chat.message` hook is **not** used (it only sees UserMessage,
  not AssistantMessage). The plugin therefore uses `event` hook for
  symmetric handling of both user + assistant messages.
- The `config` hook is **not used**. It exists in the type contract
  but OpenCode does not invoke it. Do not rely on it for MCP
  registration or any side effect.
