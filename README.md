# MemWeave

> 给 AI 智能体（Agent）用的本地优先、可记忆、可推理的记忆与上下文基础设施。
>
> **English version:** [README.en.md](./README.en.md)

---

## 它是什么

MemWeave 是一个让 AI Agent **记住上下文、且记住但不撑爆上下文** 的本地服务。

LLM 的上下文窗口有限，把整条记忆原文塞进 system prompt 是对 token 的浪费——Agent 可能只需要其中一两句。MemWeave 的解法是 **渐进披露（Progressive Disclosure）**：

> **只注入摘要，想要细节就主动拉取。**

```
system prompt  →  memory id + title + summary    ← 低 token 开销
Agent 主动调   →  memory_expand(id) → 完整正文   ← 拿到细节才花 token
```

围绕这个核心设计，MemWeave 提供一整套记忆基础设施：

- **结构化记忆**：事实、决策、偏好、事件、经验教训……按 `type` / `tier` 组织在本地 SQLite 中。
- **四层检索**：关键词（BM25）+ 向量语义 + 图谱关系 + 因果链，按需融合排序。
- **记忆整理（Consolidation）**：模拟"睡眠"，定期把短期记忆升格为长期、淘汰冷门、发现因果。
- **自动注入**（OpenCode 插件）：每次对话/读文件时自动把相关摘要追加到 system prompt，零调用成本。
- **MCP 工具集**（v0.4+）：10 个 `memory_*` 工具内嵌在 server 进程，通过 Streamable HTTP 暴露在 `/mcp` 端点，闭环渐进披露。
- **多客户端插件**（v0.4+）：OpenCode 插件（自动注入 + 写侧闭环）和 Codex 插件（10 个 `memory_*` 工具 + Stop 钩子），让任何 Agent 都能挂上 MemWeave。
- **Web UI**（Calm Memory Atlas）：浏览、搜索、调试、运维整套记忆系统。
- **REST API**：完整的 HTTP 接口，便于脚本和第三方工具调用。

所有数据存储在本地 SQLite，**无强制外部依赖**，不装任何可选依赖也能完整运行。

---

## 渐进披露——核心设计

MemWeave 的检索结果包含**完整的记忆正文**（`content`），但**默认注入给 LLM 的只含摘要**（`title` + `summary`）。这就是渐进披露：在 LLM 上下文窗口有限的前提下，先给最关键的"线索"，让 Agent 主动拉取完整细节。

### 三层消费粒度

| 粒度 | 包含 | 何时返回 | Token |
|---|---|---|---|
| **Compact（默认）** | `id` / `type` / `tier` / `title` / `summary` | 注入、搜索（默认 `mode: "compact"`） | 低 |
| **Full record** | 上述 + `content` / `concepts` / `importance` … | `GET /api/v1/memories/:id` / `MCP memory_expand` | 中-高 |
| **Plus neighbors** | 上述 + 关联边、相邻会话、因果链 | `MCP memory_expand`（默认带边） | 高 |

### 注入的 XML

```xml
<memory-context phase="session_start" count="12">
  <memory id="m_abc" type="fact" tier="long" strength="0.92" importance="8">
    <title>User prefers strict TypeScript</title>
    <summary>Always use noImplicitAny, exactOptionalPropertyTypes.</summary>
  </memory>
  ...
</memory-context>
```

LLM 看到摘要，需要细节就主动调 `memory_expand({ memoryId: "m_abc" })` 拿完整 `content`。

### 闭环

插件只负责把摘要注入 system prompt（步骤 1）；MCP 工具则由内嵌在 `@mem-weave/server` 里的 `/mcp` 端点提供（见上节），OpenCode 通过 `mcp: { memweave: { type: 'remote', url: 'http://127.0.0.1:3131/mcp' } }` 自动连上。其他客户端同理。

> **设计要点**：渐进披露不是"分阶段给不同详略"，而是"**始终摘要，主动拉取才给全文**"。所有注入阶段渲染的 XML 是同一粒度，区别只在"哪批记忆"和"多少条"。

---

## 5 分钟上手

### 方式一：全局安装（推荐，OpenCode / IDE 集成需要）

```bash
npm install -g --allow-scripts=better-sqlite3,sharp,protobufjs @mem-weave/server
npm install -g @mem-weave/opencode-plugin
memweave init     # 生成 memweave.config.jsonc + 数据目录
memweave start    # 启动服务（前台，默认 http://127.0.0.1:3131）
```

打开浏览器访问 [`http://127.0.0.1:3131/ui/`](http://127.0.0.1:3131/ui/) 即可看到 **Calm Memory Atlas** Web UI。

#### 后台启动（Windows / PowerShell）

```powershell
Start-Process -WindowStyle Hidden memweave start
memweave stop     # 停止（需要 server 进程是 CLI 启动的，留有 PID 文件）
```

OpenCode 客户端：编辑 `~/.config/opencode/opencode.json`：

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

> **必须**手填 `mcp` 段。OpenCode 不会调 plugin 的 `config` hook（见
> [OpenCode 插件文档](https://opencode.ai/docs/plugins/)，hooks 列表里**没有**
> `config`），所以 plugin 无法自己注入 mcp.memweave。**Plugin 也**带一个
> `.mcp.json` 供 [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)
> 自动加载，但 oh-my-openagent 实际**依赖** `~/.claude/plugins/installed_plugins.json`
> 这份 Claude Code plugin DB —— **多数用户** 没装 Claude Code，所以 plugin
> `.mcp.json` **不可靠**。**主路径是手填** mcp.memweave 段。

### 方式二：仅 npx 试用

```bash
npx @mem-weave/server init     # 生成 memweave.config.jsonc + 数据目录
npx @mem-weave/server start    # 启动服务（前台）
```

仅限**临时试用**。OpenCode / IDE 集成需要全局安装 server（方式一），否则 MCP 端点 `http://127.0.0.1:3131/mcp` 在 npx 进程退出后消失。

### 方式二：从源码运行（用于开发）

```bash
git clone <repo-url> memweave
cd memweave
npm install
npm run dev                   # 构建前端 + 启动服务端（前台）
```

### 健康检查

```bash
curl http://127.0.0.1:3131/api/v1/health
# → {"ok":true,"service":"memweave-server"}
```

---

## 架构一览

```
┌────────────────────────────────────────────────────────────┐
│                      Clients                                │
│   ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│   │  Web UI │  │   CLI    │  │ MCP/IDE  │  │ OpenCode   │  │
│   │         │  │          │  │          │  │  Plugin    │  │
│   └────┬────┘  └─────┬────┘  └─────┬────┘  └─────┬──────┘  │
└────────┼─────────────┼─────────────┼─────────────┼──────────┘
         │  HTTP        │  stdio     │  stdio      │  HTTP
         │              │            │             │  (POST /injection/preview)
         └──────────────┴─────┬──────┴─────────────┘
                              ▼
              ┌────────────────────────────┐
              │      memweave-server       │
              │   (Fastify + TypeScript)   │
              └────────────┬───────────────┘
                           ▼
        ┌──────────────────────────────────────┐
        │  Retrieval Engine (4-layer fusion)   │
        │  ┌────────┐ ┌────────┐ ┌──────┐ ┌──┐  │
        │  │  BM25  │ │ Vector │ │Graph │ │Caus│ │
        │  └────────┘ └────────┘ └──────┘ └──┘  │
        └────────────────┬─────────────────────┘
                         ▼
              ┌─────────────────────┐
              │  SQLite + sqlite-vec│
              │  (本地、嵌入式)     │
              └─────────────────────┘
                         ▲
                         │
              ┌─────────────────────┐
              │  Consolidation Worker│
              │  (定期"睡眠"整理)    │
              └─────────────────────┘
```

详细的设计文档请参考 [`docs/`](./docs/) 目录。

---

## 核心概念

| 概念 | 说明 |
|---|---|
| **Tenant** | 多租户隔离单位（默认 `tenant_default`），每个租户有独立 API key。 |
| **Memory** | 一条结构化记忆，包含 `type`（fact / decision / preference / event / project_context / lesson / code_pattern / bug / workflow）、`tier`（short / medium / long）、`summary`、`details`、`scopes` 等。 |
| **Session** | 一次 Agent 会话，关联到一串 Observation。 |
| **Observation** | 一次用户/工具交互（user / tool / assistant 任一角色）。 |
| **Edge** | 记忆之间的关系（causal / temporal / entity）。 |
| **Consolidation Run** | 一次"睡眠"整理的快照：升格、淘汰、发现的因果。 |

---

## CLI 速查

通过 `npx @mem-weave/server <command>` 或全局安装后直接 `memweave <command>`（源码开发用 `npm run cli -- <command>`）。

| 命令 | 说明 |
|---|---|
| `init` | 生成默认配置和数据目录 |
| `start` | 启动服务（前台） |
| `stop` | 停止后台服务 |
| `status` | 查看服务状态 |
| `migrate` | 运行数据库迁移 |
| `doctor` | 健康自检（数据库 / 配置 / 端口） |
| `backup` | 备份 SQLite 数据库 |
| `version` | 打印版本号 |
| `help` | 显示帮助 |

> 安装方式及包说明见上方 [5 分钟上手](#5-分钟上手)。

---

## REST API 概览

所有接口前缀 `/api/v1/`，完整 OpenAPI 风格的路由见 `packages/server/src/rest/routes/`。

| 端点 | 方法 | 用途 |
|---|---|---|
| `/health` | GET | 健康检查 |
| `/memories` | GET / POST | 搜索 + 写入记忆 |
| `/memories/:id` | GET / PATCH / DELETE | 记忆详情 / 编辑 / 删除 |
| `/memories/:id/edges` | GET | 记忆的关系图 |
| `/injection/preview` | POST | 生成注入 bundle（XML） |
| `/stats` | GET | 仪表盘统计（KPI、分布） |
| `/sessions` | GET | 会话列表 |
| `/sessions/:id/observations` | GET | 会话观察日志 |
| `/consolidation/runs` | GET | "睡眠"整理历史 |
| `/consolidation/runs/:id` | GET | 整理详情 |
| `/consolidation/runs/latest` | GET | 最近一次整理 |
| `/consolidation/run` | POST | 手动触发一次整理 |
| `/devices` | GET / POST / DELETE | 设备注册与管理 |
| `/settings` | GET | 查看服务端配置（密钥已脱敏） |

---

## MCP 工具集

从 v0.4 开始，10 个 `memory_*` MCP 工具**内置在 `@mem-weave/server` 进程里**，通过 **Streamable HTTP** 暴露在 `/mcp` 端点。**不再需要独立 MCP 包**（`@mem-weave/mcp` 已被移除）。

任何支持 Streamable HTTP 的 MCP 客户端都可以直接连接：

```json
{
  "mcpServers": {
    "memweave": {
      "url": "http://127.0.0.1:3131/mcp"
    }
  }
}
```

OpenCode 配置（`~/.config/opencode/opencode.json` 的 `mcp` 段）：

```json
{
  "mcp": {
    "memweave": {
      "type": "remote",
      "url": "http://127.0.0.1:3131/mcp",
      "enabled": true
    }
  }
}
```

> Streamable HTTP 是 MCP 2025-03-26 协议；旧 HTTP+SSE 客户端可能不兼容——请升级到最新客户端。

| 工具 | 用途 |
|---|---|
| `memory_save` / `memory_recall` / `memory_smart_search` | 写/搜/融合搜索 |
| `memory_expand` / `memory_graph_query` / `memory_file_history` | 展开/图查询/文件关联 |
| `memory_sessions` / `memory_patterns` | 会话列表 / 模式发现 |
| `memory_consolidate` / `memory_forget` | 触发整理 / 软删除 |

---

## OpenCode 插件（自动注入 + 自动写入 + 写侧闭环）

插件 `@mem-weave/opencode-plugin` 安装后做三件事（v0.4+）：

1. **注入记忆** — 每次对话/读文件时，把相关记忆的摘要追加到 system prompt，无需 LLM 主动调工具
2. **写侧闭环** — 监听 OpenCode 的 `message.updated` 事件，把每条完成的 user / assistant 消息自动上报到 `@mem-weave/server` 写进 `observations` 表（**幂等**：重复消息不会被重复写）
3. **MCP 端点** — MCP 工具（`memory_save` / `memory_recall` / `memory_expand` 等）由 `@mem-weave/server` 内置的 `/mcp` 端点提供，**OpenCode 通过手填的 `mcp.memweave` 段连接**（type **必须**是 `remote` —— OpenCode runtime 的 schema 只接受 `remote`）

**启用方式：**

```bash
npm install -g @mem-weave/opencode-plugin
```

`~/.config/opencode/opencode.json`：

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

> **必须**手填 `mcp` 段。`type` 必须是 `"remote"`（OpenCode runtime 的 Effect
> schema 只接受 `"remote"`，不接受 `"http"` / `"sse"` —— 写其他值会被静默丢弃）。
> Plugin 根目录**也**带一个 `.mcp.json` 作为 backup，**但** oh-my-openagent
> 实际依赖 `~/.claude/plugins/installed_plugins.json` 这份 Claude Code
> plugin DB，普通用户**没**装 Claude Code，**.mcp.json 路径不可靠**。**主路径
> 是手填 mcp.memweave 段**。

**写侧闭环数据流：**

```
[OpenCode] user 提完问 → message.updated 事件
   ↓
[Plugin] event hook 触发 → OpenCode SDK 反查 → 拿 messageId + text
   ↓
[Plugin] POST /api/v1/sessions    → server 幂等建 session
[Plugin] POST /api/v1/observations → server 幂等写 observation (tool_output=text, tool_input=JSON{messageId})
   ↓
[Server] consolidation worker 周期跑 → 按规则把高质量 observation 升级成 memory
   ↓
[Server] 下次 system.transform 注入 → LLM 看到摘要 → 主动调 memory_expand 拿全文
```

**注入的 XML 格式：**

```xml
<memory-context phase="session_start" count="12">
  <memory id="m_abc" type="fact" tier="long" strength="0.92" importance="8">
    <title>User prefers strict TypeScript</title>
    <summary>Always use noImplicitAny, exactOptionalPropertyTypes.</summary>
  </memory>
  ...
</memory-context>
```

| 环境变量 | 默认值 | 含义 |
|---|---|---|
| `MEMWEAVE_URL` | `http://127.0.0.1:3131` | 服务端地址（含注入 + 写入） |
| `MEMWEAVE_PLUGIN_TIMEOUT` | `10000`（ms） | 单次请求超时（注入 + 写入共用） |

> 插件对所有网络错误**静默容错**，服务端不可用时不会打断 Agent。

## Codex 插件（10 个 `memory_*` 工具 + Stop 钩子自动写回）

`packages/codex-plugin/` 是给 [OpenAI Codex](https://developers.openai.com/codex/plugins) 用的纯配置型插件（**无 SDK、无运行时**），做两件事：

1. **加载 10 个 `memory_*` 工具** — 通过 `.mcp.json` 把 Codex 的 MCP transport 指向已运行的 MemWeave server（`http://127.0.0.1:3131/mcp`），工具以 `mcp__memweave__memory_*` 前缀出现在 agent 工具列表
2. **Stop 钩子自动写回** — `hooks/stop.mjs`（跨平台 Node，`.sh` / `.cmd` 是薄壳）监听 Codex 的 `Stop` 事件，POST `/api/v1/sessions` 幂等建 session + POST `/api/v1/observations` 幂等写 assistant message。`messageId = sha256(sessionId + "turn-" + turnId + assistantContent)` → 同一 turn 多次 Stop 落同一行

**安装：**

```bash
# 1. 先把 MemWeave server 跑起来
npx @mem-weave/server start

# 2. 从本地装插件（Codex CLI）
codex plugin install /path/to/MemWeave/packages/codex-plugin
```

**Codex 配置**（`~/.codex/config.toml`）—— 默认装上即用：

```toml
[plugins."memweave@local".mcp_servers.memweave]
enabled = true
```

**写侧数据流：**

```
[Codex] turn 结束 → Stop 事件 (JSON on stdin, snake_case)
   ↓
[Plugin] hooks/stop.mjs → POST /api/v1/sessions    { source: "codex", title }
   ↓                     POST /api/v1/observations { hookType: "chat.assistant", text, messageId: sha256 }
   ↓
[Server] consolidation worker 周期跑 → 高质量 observation 升级成 memory
   ↓
[下个 Codex session] agent 主动调 mcp__memweave__memory_recall / memory_expand 拿
```

| 环境变量 | 默认值 | 含义 |
|---|---|---|
| `MEMWEAVE_SERVER_URL` | `http://127.0.0.1:3131` | MemWeave server 地址（写侧用） |
| `MEMWEAVE_TENANT` | `tenant_default` | 租户 ID（多租户隔离） |

> 钩子对所有网络错误**静默容错** —— server 不可用时 Codex 仍能正常完成 turn，不会被 MemWeave 拖死。

**已知限制**（与 OpenCode 插件的差距）：

- Codex 没有 SDK 反查历史消息（不像 OpenCode 有 `session.messages()`），Stop 事件**只**给 `last_assistant_message`，所以**用户消息**和**工具调用**目前**不**被回写。OpenCode 插件能捕获所有 message，Codex 插件只能捕获 assistant 的最后一条。
- session 的 `ended_at` **不**被设值（REST 还没暴露 `end` 端点，OpenCode 插件也**没**设这个值，所以行为一致）。

**Codex MCP transport 注意**：Codex 的 `.mcp.json` 用 `type: "http"`，**和 OpenCode 的 `type: "remote"` 不一样** —— 两个客户端的 schema 是**两套**词汇表，**不可互换**。详见 [docs/superpowers/specs/2026-06-16-codex-plugin-design.md](./docs/superpowers/specs/2026-06-16-codex-plugin-design.md) §1.1。

## 写侧去重（服务端自动，零 token 开销）

读侧闭环了，写侧呢？**`memory_save` 不会和当前 context 产生重复内容** —— 因为去重在服务端自动完成，**LLM 零感知、零 token 开销**。

**机制**：`MemoryRepo.create` 在 INSERT 之前先做一次查重：

1. 用新记忆的 `concepts` 字段在 FTS5 索引上做 BM25 查询（同租户、排除已删除）—— < 1ms，零 embedding 开销
2. 取 top-5 候选，对每条计算 **Jaccard 相似度**（concepts 集合的交集/并集）
3. 如果 best Jaccard **≥ 0.8** 且 `type` 相同 → 视为重复，**强化现有记忆**而不是创建新的

**强化的两种行为**：

| 场景 | 行为 |
|---|---|
| 新输入与现有 content 几乎一样（长度差 < 25%） | 只 `recordAccess`：bump `access_count` / `reinforcement_score` / `strength` / `last_reinforced_at` |
| 新输入明显更丰富（长度 > 1.25× 或 importance 更高） | **合并**：content 升级、concepts 取并集、files 取并集、importance 取 `max` |

**设计要点**：

- **零 LLM tokens**：纯服务端 BM25 + 集合相似度计算
- **零额外延迟**：FTS5 在 SQLite 上亚毫秒级
- **type 必须匹配**：`fact` 永远不是 `decision` 的重复
- **调用方零负担**：`create()` 仍返回 `MemoryRecord`；想要 dedup 信号用 `createDetailed()` 拿 `CreateResult { memory, deduped, reinforcedId }`
- **REST 路由保持不变**：`POST /api/v1/memories` 走 `create()`，行为对调用方完全透明

> **没有"prompt 检测 / LLM 查重"**：那种方案每次 save 多花 ~1000 tokens 防御性查重，对高频用户是真实成本。本方案**只在重复确实发生时**消耗 server CPU，**LLM 全程不知情**。

### 写侧配套：输入限额 + 限流 + 后台合并 + 日志

- **`CreateMemoryInputSchema` 硬性限额**（`packages/server/src/core/types.ts`）：`content` ≤ 100,000 字符、`concepts` ≤ 50、`files` ≤ 50。**Buggy / 恶意 LLM 也无法塞 10MB 正文或 10k 概念进 DB**。
- **写入限流**（`packages/server/src/server/rate-limiter.ts`）：每 API key 一个 token bucket，30 写入/分钟 突发，2/秒 稳态。`POST /api/v1/memories` 超过配额返 `429 Too Many Requests` + `Retry-After` header。
- **后台合并阶段**（`packages/server/src/workers/consolidator.ts`）：除了 evict + promote，加了 **Jaccard 合并阶段**—— 复用和实时去重**同一套** Jaccard 公式和阈值，扫所有同租户同类型记忆对，合并 near-duplicate。**实时去重** + **后台合并**形成两级防线。
- **进程级 consolidation mutex**：`runConsolidation` 内的 `consolidationInFlight` 布尔保证同一租户一次只能跑一次。后台 scheduler 和手动 `POST /api/v1/consolidate` 不会撞车。
- **pino 结构化日志**（`packages/server/src/server/logger.ts`）：替换全仓 14 处 `console.*` 错误日志。`LOG_LEVEL` 环境变量调级别，默认 `info`。输出 JSON，方便接入 Loki / ELK。
- **dedup 强化也写 audit log**（`packages/server/src/db/repositories/memory-repo.ts`）：`reinforceExisting` 触发时往 `access_logs` 插一条 `source: 'dedup_reinforce'` 记录，让"被强化过"在审计追踪里可见。

---

## 本地 Embedding（可选）

MemWeave 的向量层是**完全可选**的。三种 embedding provider 选其一：

| Provider | 配置键 | 外部依赖 | 何时用 |
|---|---|---|---|
| **`noop`**（默认） | `embedding.provider: "noop"` | 无 | 想零配置启动 / 不要向量层 |
| **`local-xenova`** | `embedding.provider: "local-xenova"` | `@xenova/transformers`（可选安装） | 想用真实语义向量、又不想付 API 钱 |
| **`openai-compatible`** | `embedding.provider: "openai-compatible"` | 任何 OpenAI 兼容 `/v1/embeddings` 端点 | 已有 OpenAI / Voyage / 自托管端点 |

**`local-xenova` 启用步骤：**

```bash
npm install @xenova/transformers
```

`memweave.config.jsonc`：

```jsonc
{
  "embedding": {
    "provider": "local-xenova",
    "model": "Xenova/nomic-embed-text-v1",
    "dimensions": 768
  }
}
```

**关键行为：**

- 首次 `embed()` 调用会动态加载模型并从 Hugging Face Hub 拉取权重（~30MB），之后缓存在 `node_modules/@xenova/transformers/.cache/`。
- 后续调用**复用**已加载的 pipeline（并发请求共享同一次加载）。
- **自动降级**：如果 `@xenova/transformers` 未装、模型加载失败或推理超时（默认 60s），自动回退到 SHA-256 哈希向量并打印一次 `console.warn`，保证整个系统不中断。
- 可通过 `fallbackOnError: false` 关闭降级（让错误冒泡，便于排查）。
- 输出维度与配置不匹配时，**截断或补零**到目标维度（与 `vector-search.ts` 的优雅降级一致）。

更多细节见 [`packages/server/src/providers/embedding/local-xenova.ts`](./packages/server/src/providers/embedding/local-xenova.ts) 和 [`packages/server/src/types/xenova.d.ts`](./packages/server/src/types/xenova.d.ts)。

---

## Web UI 页面导览

访问 `/ui/`，共 5 个一级页面 + 记忆详情 + 图谱：

| 路由 | 名称 | 作用 |
|---|---|---|
| `/ui/` | **Atlas** | 仪表盘：KPI 卡片、tier/type 分布、活跃项目、最近整理 |
| `/ui/memories` | **Memories** | 三栏：过滤栏 + 列表 + 详情（搜索、类型筛选、强度排序） |
| `/ui/injection` | **Injection** | 表单预览注入包（按 token 预算裁剪） |
| `/ui/sleep` | **Sleep** | 整理运行历史 + 升格/淘汰的 git-diff 视图 |
| `/ui/settings` | **Settings** | 服务端配置查看、设备列表、API key 显隐 |
| `/ui/memories/:id` | **Memory Detail** | 记忆详情（正文 / 关系图 / 访问日志） |
| `/ui/graph/:id` | **Graph** | 关系图谱（径向布局） |

主题支持浅色 / 深色切换（右上角）。

---

## 开发

### 目录结构

v0.2 起改为 monorepo 布局（每个子目录都是独立 npm 包）：

```
packages/
├── server/              # @mem-weave/server           —— Fastify + SQLite + CLI
│   └── src/
│       ├── cli.ts, cli-entry.ts
│       ├── commands/    # 9 个 memweave 子命令
│       ├── core/        # 配置、Zod 枚举、衰减模型
│       ├── db/          # SQLite schema + 9 个仓储
│       ├── injection/   # 注入打包
│       ├── prompts/     # 提示词模板
│       ├── providers/   # Embedding (noop/openai/xenova) / LLM (noop/openai)
│       ├── rest/        # HTTP API（8 个路由文件）
│       ├── retrieval/   # 4 层检索引擎 + RRF
│       ├── server/      # HTTP 启动 + 调度器
│       ├── workers/     # Consolidation 后台任务
│       ├── types/       # ambient .d.ts
│       └── mcp/         # 内嵌 MCP server（Streamable HTTP，/mcp 端点）
│           ├── index.ts, service.ts, registry.ts
│           └── tools/   # 10 个 memory_* 工具
└── opencode-plugin/     # @mem-weave/opencode-plugin  —— OpenCode 插件
    └── src/
        ├── index.ts, client.ts

web/                     # React 18 + Vite 前端（独立子项目，不在 packages/ 内）
├── src/
│   ├── pages/           # 7 个页面
│   ├── components/      # AppShell + 通用组件
│   ├── api/             # 类型化 fetch 封装
│   ├── lib/             # 格式化 / 工具
│   └── theme/           # CSS 变量（设计令牌）
├── tests/               # vitest + happy-dom
└── vite.config.ts

tests/                   # 整个 monorepo 的 vitest 集成 + 单元测试
docs/                    # 设计文档
scripts/publish.mjs      # 一键构建 + 发布三个 npm 包
```

### 常用脚本

**单仓内（开发）**：

| 命令 | 说明 |
|---|---|
| `npm test` | 运行全部 Vitest 测试（服务端集成 + 单元） |
| `npm run typecheck` | TypeScript 类型检查（monorepo 全部） |
| `npm run build` | 构建前端 + 服务端两个包（tsc） |
| `npm run dev` | 构建前端 + 启动服务端（前台） |
| `npm run web:dev` | 前端 Vite 开发服务器（HMR，端口 5173） |
| `npm run web:build` | 构建前端到 `dist/web/` |

**单包（发布前用）**：

```bash
cd packages/server && npm run build                # 仅 server（含内置 mcp）
cd packages/opencode-plugin && npm run build       # 仅 opencode-plugin
```

**发布到 npm**（需要 `$NPM_TOKEN`）：

```bash
node scripts/publish.mjs --dry-run    # 检查 tarball 内容
node scripts/publish.mjs --publish    # 实际发布（按 server -> opencode-plugin 顺序）
```

> 前端单元测试在 `web/` 目录下：`cd web && npm test`。

### 质量门槛

修改后请确认：

```bash
npm test           # 全部通过
npm run typecheck  # 0 错误
npm run build      # 成功
```

---

## 常见问题

**Q: 数据存在哪？**
A: SQLite 文件，路径见 `memweave.config.jsonc` 的 `storage.path`，默认 `<dataDir>/memweave.db`。

**Q: 没有外部 LLM / Embedding 服务可以吗？**
A: 可以。三种降级路径，按成本从低到高：

1. **完全本地 + 哈希向量**：`embedding.provider: "noop"`（默认）。不开任何外部服务；`embedding.dimensions: 0` 时服务端直接跳过向量层，检索回落到 BM25 + 图 + 因果。
2. **完全本地 + 真实 Embedding**：`embedding.provider: "local-xenova"` + `npm install @xenova/transformers`。首次调用会从 Hugging Face Hub 拉取模型权重（~30MB），之后缓存在 `node_modules/@xenova/transformers/.cache/`。如果包未装或模型加载失败，**自动降级**到哈希向量，并打印一次 `console.warn`。
3. **外部 API**：`embedding.provider: "openai-compatible"`，对接任何 OpenAI 兼容的 `/v1/embeddings` 端点。

**Q: 端口被占用？**
A: 修改 `memweave.config.jsonc` 中的 `server.port` 字段。

**Q: 怎么清理全部数据？**
A: 停止服务 → 删除 `dataDir` 指向的目录 → 重新 `init`。

**Q: Web UI 访问 503？**
A: 服务端没找到 `dist/web/`，运行 `npm run web:build` 即可。

---

## 路线图

- [x] **本地 ONNX Embedding** —— 已实现 `LocalXenovaEmbeddingProvider`（基于 `@xenova/transformers`，动态导入 + 自动降级到 noop）
- [ ] 多 Embedding provider 适配（OpenAI / Voyage / 更多本地模型）
- [ ] 联邦/同步协议（device-to-device 端到端加密同步）
- [ ] 知识图谱自动抽取
- [ ] 记忆"遗忘权"（GDPR 合规）

---

## 许可证

本仓库暂未声明开源许可证，使用前请联系作者。

---

## 致谢

- [Fastify](https://fastify.io/) — 高性能 HTTP 服务
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — 同步 SQLite 客户端
- [sqlite-vec](https://github.com/asg017/sqlite-vec) — 嵌入式向量搜索
- [Model Context Protocol](https://modelcontextprotocol.io/) — Agent 工具调用标准
- [Vite](https://vitejs.dev/) + [React](https://react.dev/) — 前端
