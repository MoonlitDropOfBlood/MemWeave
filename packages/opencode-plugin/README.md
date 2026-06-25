# @mem-weave/opencode-plugin

**MemWeave OpenCode plugin** — registers the `@mem-weave/mcp` server as an MCP provider inside OpenCode, and auto-injects summary-only memory XML into the agent's system prompt at `session_start`, `prompt_delta`, and `file_pack` phases. **Closes the progressive disclosure loop**: the LLM sees summaries in the system prompt, then calls `memory_expand` to fetch full content.

This is the **OpenCode integration** half of the MemWeave stack. The complementary packages are:

- **[@mem-weave/server](https://www.npmjs.com/package/@mem-weave/server)** — the memory backend
- **[@mem-weave/mcp](https://www.npmjs.com/package/@mem-weave/mcp)** — the MCP server this plugin auto-registers

## Install

```bash
# 1. Install the server + mcp
npm install -g @mem-weave/server @mem-weave/mcp
# 2. Install this plugin as an OpenCode plugin
npm install -g @opencode-ai/plugin   # peer dep
npm install -g @mem-weave/opencode-plugin
```

Then add to `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@mem-weave/opencode-plugin"]
}
```

Restart OpenCode. The plugin loads on startup and:

1. **Registers `mcp["memweave"]`** — OpenCode auto-spawns `@mem-weave/mcp` and the 10 `memory_*` tools become available to the LLM.
2. **Hooks `experimental.chat.system.transform`** — appends `<memory-context>` XML (summary-only) to the system prompt at every turn.
3. **Hooks `tool.execute.before`** — when the LLM calls `Read`/`Edit`/`Write`/`Glob`/`Grep`, queues a `file_pack` XML for the next system turn.

## Progressive disclosure, end to end

```
plugin loads  →  config hook registers mcp["memweave"]
            ↓
OpenCode  →  10 memory_* tools in LLM's tool list
            ↓
LLM starts  →  system.transform injects summary-only XML
            ↓
LLM sees m_abc  →  calls memory_expand({memoryId: "m_abc"})
            ↓
MCP server  →  proxies to GET /api/v1/memories/m_abc
            ↓
LLM gets full content
```

The plugin itself is a thin coordinator — no business logic. All memory work happens in `@mem-weave/server`, surfaced via `@mem-weave/mcp`'s 10 tools.

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `MEMWEAVE_URL` | `http://127.0.0.1:3131` | MemWeave server base URL |
| `MEMWEAVE_PLUGIN_TIMEOUT` | `10000` (ms) | Per-inject-request timeout. Overridable. |

## Versioning

| Plugin version | Server version | Notes |
|---|---|---|
| 0.5.x | ≥ 0.5.4 | Sends `scopes: [{ key: 'project', value: cwd }]` on every observation. The server's consolidation worker inherits the scope onto the promoted memory. |
| 0.7.0 | ≥ 0.7.0 | Sends the **resolved project name** on every session POST (`project` field on `POST /api/v1/sessions`) and uses it as the `scopes: [{ key: 'project', value: <name> }]` value on every observation POST. The `deriveProject(cwd)` cascade (git remote last segment → basename → absolute path, with worktree walk-up to the main gitdir via the `commondir` file) lives in `src/derive-project.ts`. Run `npm test` (now includes `derive-project.test.ts`, 9 cascade cases including 2 real-FS worktree walk-up tests via `mkdtempSync`). |

## License

MIT
