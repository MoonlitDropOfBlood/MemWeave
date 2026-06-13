# src/plugin/

**OpenCode 插件。自动注入摘要式记忆到 system prompt，并通过 `config` 钩子把 MemWeave 自带 MCP server 注册进 OpenCode，从而闭环渐进披露。**

## OVERVIEW

`MemweaveInjectPlugin` 在 `~/.config/opencode/opencode.json` 注册后跑在 OpenCode 进程里。它做三件事：

1. **`config` 钩子** —— 把 MemWeave 自己的 MCP server（`src/mcp/index.ts`，10 个工具）注册成 OpenCode 的本地 MCP，LLM 立刻能调 `memory_expand` / `memory_smart_search` / `memory_graph_query` 等。
2. **`experimental.chat.system.transform` 钩子** —— 把服务端返回的 `<memory-context>` XML 追加到 system prompt。XML 只含 `<title>` + `<summary>`（**渐进披露**）。
3. **`tool.execute.before` 钩子** —— 文件读写类工具调用前，请求 file_pack 阶段的注入 XML，缓存到 pending 队列，下次 system.transform 一并追加。

**为什么这能闭环渐进披露**：

```
[config 钩子] MemWeave MCP server 注册
              ↓
[LLM 启动] 自动看到 10 个 memory_* 工具
              ↓
[system.transform] 注入 12 条 memory 的 summary（不含 content）
              ↓
[LLM 觉得 "m_abc 这条相关"] → 调 memory_expand({memoryId: "m_abc"})
              ↓
[MCP server] 返回完整 record（含 content）
              ↓
[LLM 拿到全文] → 真正"读了"那条记忆
```

**关键设计点**：**不**在 plugin 里写自定义 `tool()` 定义 —— MCP server 已经有 10 个工具，`config` 钩子直接复用，零重复。

## STRUCTURE

```
src/plugin/
├── index.ts          # MemweaveInjectPlugin 主文件（config + 两个 hook）
└── client.ts         # MemweaveInjectClient —— POST /api/v1/inject
```

## WHERE TO LOOK

| Symbol | File | 作用 |
|---|---|---|
| `MemweaveInjectPlugin` | `index.ts` | 插件默认导出；返回 `{ config, 'experimental.chat.system.transform', 'tool.execute.before' }` |
| `resolveMcpServerCommand(pluginDir)` | `index.ts` | 把 `<repo>/src/mcp/index.ts` 解析成 `npx tsx` 命令 |
| `MEMWEAVE_URL` | 环境变量 | 服务端 base URL（默认 `http://127.0.0.1:3131`） |
| `MEMWEAVE_PLUGIN_TIMEOUT` | 硬编码 | 10s per inject request |
| `MemweaveInjectClient` | `client.ts` | HTTP 客户端，POST `/api/v1/inject` 拿 contextXml |

## CONVENTIONS

- **Fail-silent**: 所有网络调用都包在 try/catch，MemWeave 不可用绝不打断 OpenCode。
- **`config` 钩子只动 `config.mcp`**，不碰 `config.agent` / `config.command` / `config.provider`。
- **MCP 启动走 `npx --yes tsx <entry>`** —— 不引入新的 bin 依赖；`tsx` 已在 devDependencies。
- **`file_pack` 不污染 `INJECTED_CACHE`**: XML 还没真追加到 system prompt 前，不能把 memoryIds 加进 `sessionInjected`，否则下次的 prompt_delta 会跳过它们。
- **三类注入阶段**:
  1. `session_start` —— `experimental.chat.system.transform` 第一次触发；服务端返回稳定 long-term pack。
  2. `prompt_delta` —— 同上但已注入过；只追加增量。
  3. `file_pack` —— `tool.execute.before` 触发；XML 缓存到 pending 队列，下一次 system.transform 追加。

## ANTI-PATTERNS

- **NEVER** 引入 `import from './tools.js'` 之类的自定义 tool 实现 —— 用 `config` 钩子把 MCP server 注册进去。重复实现是技术债。
- **NEVER** import from `src/server/`, `src/db/`, `src/retrieval/`. 插件是独立进程。
- **NEVER** rethrow 网络错误。`config` 钩子失败 → OpenCode 启动失败；MCP 启动失败 → LLM 没工具，但 server-side injection 仍能跑。
- **NEVER** 在 `tool.execute.before` 里就把 `response.memoryIds` 加进 `INJECTED_CACHE` —— XML 还没到 system prompt。

## 适配范围

本插件只适配 **OpenCode 最新版**（`@opencode-ai/plugin` ≥ 1.17.x）。`experimental.chat.system.transform` / `tool.execute.before` / `config` 钩子均按当前类型契约使用，行为在最新 OpenCode 上验证。
