# OpenCode MCP Type Schema — The Definitive Guide

> Investigation: 2026-06-15/16. Author: explore subagent (ses_133310858ffe6HjKRzOufUUZti).

## TL;DR

OpenCode uses **two completely separate type vocabularies** for MCP entries:

| System | Accepts | Where |
|---|---|---|
| **OpenCode runtime** (opencode binary) | `"local"` or `"remote"` only | `~/.config/opencode/opencode.json` mcp entries |
| **oh-my-openagent** (.mcp.json reader, Claude Code format) | `"http"`, `"sse"`, or `"stdio"` (default) | Plugin `.mcp.json` files |

There is **no overlap** between the two. The word `"remote"` does not exist in the Claude Code `.mcp.json` vocabulary. The word `"http"` does not exist in the OpenCode runtime vocabulary.

## Why this matters

Each system **silently drops** what it doesn't recognize:

- **OpenCode runtime**: `A.type === "remote" ? connectRemote : connectLocal` — anything other than `"remote"` goes to `connectLocal` (stdio spawn), which fails with "server unavailable key=X type=local" when there's no command.
- **oh-my-openagent transformMcpServer**: Only matches `"http"` or `"sse"`. Anything else (including `"remote"` or `"stdio"`) falls through to the stdio branch and throws `MCP server "${name}" requires command for stdio type` if there's no command.

## The correct values

| Context | File | Type value | Why |
|---|---|---|---|
| OpenCode runtime mcp config | `~/.config/opencode/opencode.json` | `"remote"` | Only value OpenCode accepts for HTTP-based MCP |
| Plugin MCP shipped via oh-my-openagent | `<plugin>/.mcp.json` | `"http"` | Claude Code convention; oh-my-openagent transforms to `"remote"` |

## How oh-my-openagent transforms plugin .mcp.json

```javascript
function transformMcpServer(name, server) {
  const serverType = server.type ?? "stdio";
  if (serverType === "http" || serverType === "sse") {
    return { type: "remote", url: server.url, enabled: true, ... };
  }
  if (!server.command) {
    throw new Error(`MCP server "${name}" requires command for stdio type`);
  }
  return { type: "local", command: [server.command, ...(server.args ?? [])], enabled: true, ... };
}
```

Key behaviors:
1. `.mcp.json` with `type: "http"` → outputs `{ type: "remote", url, enabled }` (correct)
2. `.mcp.json` with `type: "sse"` → same as above
3. `.mcp.json` with `type: "remote"` → falls through to stdio branch → throws if no `command`
4. `.mcp.json` with no `type` → defaults to `"stdio"` → falls through to stdio branch
5. `.mcp.json` with `type: "stdio"` + `command` → outputs `{ type: "local", command }`

## How OpenCode runtime selects the MCP connection

From the opencode binary (compiled JavaScript):
```javascript
// MCP.create function
let { client: U, status: M } = A.type === "remote" ? yield*J(P, A) : yield*B(P, A);
if (!U) {
  if (M.status !== "connected" && M.status !== "disabled")
    yield*$.logWarning("server unavailable", { key: P, type: A.type, status: M.status });
  return { status: M };
}
```

- `J(P, A)` = connectRemote (tries StreamableHTTP first, then SSE fallback — see `packages/opencode/src/mcp/index.ts`)
- `B(P, A)` = connectLocal (spawns a subprocess)

## Merge order in oh-my-openagent's applyMcpConfig

```javascript
const merged = {
  ...createBuiltinMcps(...),            // websearch, context7, grep_app
  ...mcpResult.servers,                 // Claude Code .mcp.json (user-level)
  ...userMcp ?? {},                     // opencode.json user config
  ...params.pluginComponents.mcpServers // plugin .mcp.json (namespaced)
};
```

Plugin `.mcp.json` entries are **namespaced** as `${pluginName}:${serverName}` — e.g., `@mem-weave/opencode-plugin:memweave`. They do NOT collide with a user's `memweave` key in `opencode.json`. Both can coexist.

## Common errors

| opencode.json mcp.memweave.type | Result |
|---|---|
| `"remote"` (correct) | OpenCode accepts, connects via StreamableHTTP/SSE to the URL |
| `"http"` | OpenCode Zod fails (discriminated union doesn't match), falls to `{enabled: Boolean}` fallback, strips type/url, runtime tries connectLocal, fails with "server unavailable key=memweave type=local" |
| `"local"` | OpenCode tries to spawn a subprocess, fails because no command |
| omitted | Same as `"local"` |

| Plugin .mcp.json type | Result (with oh-my-openagent) |
|---|---|
| `"http"` (correct Claude Code format) | Transformed to `{ type: "remote", url, enabled }`, registered as `<pluginName>:memweave` |
| `"sse"` | Same as `"http"` |
| `"remote"` (wrong) | Falls through to stdio branch, throws `MCP server "memweave" requires command for stdio type`. Silently caught. Plugin MCP NOT registered. |
| omitted | Defaults to `"stdio"`, falls through to stdio branch |
| `"stdio"` + `command` | Registered as `{ type: "local", command, enabled }` |

## The fix for MemWeave v0.4.2

The plugin 0.4.2 ships `.mcp.json` with `type: "remote"`. This is **wrong** for oh-my-openagent's transformer — it only matches `"http"` or `"sse"`. The transformer throws silently, and the plugin MCP server is never registered.

**However**, this doesn't actually break anything for most users because:
1. oh-my-openagent depends on `~/.claude/plugins/installed_plugins.json` (Claude Code's plugin DB) which most users don't have
2. So the `.mcp.json` is only read by users who also have Claude Code installed

For those users, the fix is to change `.mcp.json` to `type: "http"`. For everyone else, the reliable path is to hand-add `mcp.memweave` with `type: "remote"` to `opencode.json`.

## Investigation sources

- OpenCode binary: `C:\Users\wwhby\AppData\Roaming\npm\node_modules\opencode-ai\bin\opencode.exe`
- SDK types: `C:\Users\wwhby\AppData\Roaming\npm\node_modules\oh-my-openagent\dist\index.js` (oh-my-openagent bundles its own copy of @opencode-ai/sdk)
- oh-my-openagent transformMcpServer: `dist/index.js` line ~63296
- Plugin .mcp.json path: `<plugin installPath>/.mcp.json`
