# MemWeave

> 给 AI 智能体（Agent）用的本地优先、可记忆、可推理的记忆与上下文基础设施。
>
> **English version:** [README.en.md](./README.en.md)

---

## 它是什么

MemWeave 是一个让 AI Agent **记住你、记住项目、记住历史** 的本地服务。它提供：

- **结构化记忆**：把事实、决策、偏好、事件、经验教训等工作记忆，存进本地 SQLite 数据库。
- **四层检索**：关键词（BM25）+ 向量语义 + 图谱关系 + 因果链，按需融合。
- **上下文注入**：把相关的记忆按智能体友好的 XML 格式打包，喂给 LLM。
- **记忆整理（Consolidation）**：模拟"睡眠"，定期把短期记忆升格为长期、淘汰冷门、发现因果。
- **Web UI**（Calm Memory Atlas）：在浏览器里浏览、搜索、调试、运维整套记忆系统。
- **MCP 集成**：通过 Model Context Protocol 直接接入 Claude / Cursor / OpenCode 等 IDE（10 个工具）。
- **OpenCode 插件**：零调用成本——在每次对话/读文件时自动把相关记忆追加到 system prompt。
- **REST API**：完整的 HTTP 接口，便于脚本和第三方工具调用。

所有数据存储在本地 SQLite 文件中，**无强制外部依赖**（除两个可选组件：向量搜索扩展 `sqlite-vec`，以及本地 Embedding 的 `@xenova/transformers`）。不装任何可选依赖也能完整运行。

---

## 5 分钟上手

### 方式一：通过 npx 运行（推荐）

```bash
npx @mem-weave/server init     # 生成 memweave.config.jsonc + 数据目录
npx @mem-weave/server start    # 启动服务（前台，默认 http://127.0.0.1:3131）
```

打开浏览器访问 [`http://127.0.0.1:3131/ui/`](http://127.0.0.1:3131/ui/) 即可看到 **Calm Memory Atlas** Web UI。

OpenCode 用户额外安装插件：

```bash
npm install -g @mem-weave/opencode-plugin
```

然后在 `~/.config/opencode/opencode.json` 的 `plugin` 数组里加 `"@mem-weave/opencode-plugin"`，之后每次对话会自动注入相关记忆。

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

MemWeave 提供 10 个 `memory_*` MCP 工具，通过 `npx -y @mem-weave/mcp` 启动（stdio）。配置示例（Claude Desktop）：

```json
{
  "mcpServers": {
    "memweave": {
      "command": "npx",
      "args": ["-y", "@mem-weave/mcp"],
      "env": { "MEMWEAVE_URL": "http://127.0.0.1:3131" }
    }
  }
}
```

| 工具 | 用途 |
|---|---|
| `memory_save` / `memory_recall` / `memory_smart_search` | 写/搜/融合搜索 |
| `memory_expand` / `memory_graph_query` / `memory_file_history` | 展开/图查询/文件关联 |
| `memory_sessions` / `memory_patterns` | 会话列表 / 模式发现 |
| `memory_consolidate` / `memory_forget` | 触发整理 / 软删除 |

> OpenCode 用户无需手动配置 MCP——插件会自动注册。

---

## OpenCode 插件（自动注入安装）

插件 `@mem-weave/opencode-plugin` 安装后会自动做两件事：

1. **注入记忆** — 每次对话/读文件时，把相关记忆的摘要追加到 system prompt，无需 LLM 主动调工具
2. **注册 MCP** — 自动把 `npx @mem-weave/mcp` 注册进 OpenCode，LLM 通过 `memory_expand` 等工具拉取完整记忆

**启用方式：**

```bash
npm install -g @mem-weave/opencode-plugin
```

`~/.config/opencode/opencode.json`：

```json
{
  "plugins": ["@mem-weave/opencode-plugin"]
}
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
| `MEMWEAVE_URL` | `http://127.0.0.1:3131` | 服务端地址 |
| `MEMWEAVE_PLUGIN_TIMEOUT` | `10000`（ms） | 单次注入超时 |

> 插件对所有网络错误**静默容错**，服务端不可用时不会打断 Agent。

---

## 渐进披露（Progressive Disclosure）

MemWeave 的检索结果包含**完整的记忆正文**（`content` 字段），但**默认注入给 LLM 的只包含摘要**（`title` + `summary`）。这是设计文档 §5.5 明确要求的"渐进披露"原则 —— 在 LLM 上下文窗口有限的前提下，先给最关键的"线索"，让 Agent 主动调用 `memory_expand(memoryId)` 拉取完整细节。

### 三层消费粒度

| 粒度 | 包含 | 何时返回 | Token 开销 |
|---|---|---|---|
| **Compact（默认）** | `id` / `type` / `tier` / `title` / `summary` | `POST /api/v1/inject`（所有 4 个阶段）、`POST /api/v1/memories/search`（`mode: "compact"`） | 低 |
| **Full record** | 上述 + `content` / `concepts` / `files` / `importance` / `confidence` / `strength` / `scopes` 等 | `GET /api/v1/memories/:id` / `MCP memory_expand` | 中-高 |
| **Plus neighbors** | 上述 + 关联边、相邻会话、因果链 | `MCP memory_expand`（默认带相关边） / `MCP memory_graph_query` | 高 |

### 注入的 XML 长这样

服务端（`packages/server/src/injection/formatter.ts`）渲染的 `<memory>` 块**只**包含 `<title>` + `<summary>`，永远不包含 `<content>`：

```xml
<memory-context phase="session_start" count="12">
  <memory id="m_abc" type="fact" tier="long" strength="0.92" importance="8">
    <title>User prefers strict TypeScript</title>
    <summary>Always use noImplicitAny, exactOptionalPropertyTypes.</summary>
  </memory>
  ...
</memory-context>
```

LLM 看到这个 block 后，如果需要更多细节（例如「这条偏好具体怎么落地？」），它会**主动**调用 `memory_expand({ memoryId: "m_abc" })` 拿到完整 `content` 字段和相关边。

### 搜索也支持 compact / full

`POST /api/v1/memories/search` 多了一个 `mode` 参数（`"compact"` | `"full"`）。默认 `compact`：

- `mode: "compact"`（默认，MCP `memory_smart_search` 使用）— 返回 `id` / `type` / `tier` / `title` / `summary` / `finalScore` / `sources`
- `mode: "full"` — 还包含 `content` / `concepts` / `files` / `importance` / `confidence` / `strength` / `scopes` 等

服务端**默认**走 `compact`，确保列表渲染、批量预览等场景不会因为 `content` 字段过大而撑爆响应体。

### 排序与 token 预算

compact 模式下，注入的排序规则：**tier**（`long` > `medium` > `short`）→ **`strength × importance`**。服务端按 `phase` 设定的 token 预算裁剪（`session_start: 1200` / 其他阶段: 800），保证 LLM 永远只看到预算内最相关的那一批。

> **设计要点**：渐进披露不是"分阶段给不同详略程度"，而是"**始终摘要、主动拉取才给全文**"。所有注入阶段（`session_start` / `prompt_delta` / `file_pack` / `failure_delta`）渲染的 XML 是**同一种**摘要粒度；区别只在于"哪一批记忆"和"多少条"。LLM 想要细节，就调 `memory_expand`。

### 闭环机制

插件在注入摘要的**同时**自动注册了 MCP 工具。LLM 看到摘要中的某条记忆后，直接调 `memory_expand({ memoryId: "m_abc" })` 就能拿到完整 `content`——无需额外配置。OpenCode 之外的客户端手动配置 `npx @mem-weave/mcp` 效果相同。

### 写侧去重（服务端自动，零 token 开销）

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
│       └── types/       # ambient .d.ts
├── mcp/                 # @mem-weave/mcp              —— MCP server
│   └── src/
│       ├── index.ts, client.ts, registry.ts
│       └── tools/       # 10 个 memory_* 工具
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
| `npm run build` | 构建前端 + 服务端三个包（tsc） |
| `npm run dev` | 构建前端 + 启动服务端（前台） |
| `npm run web:dev` | 前端 Vite 开发服务器（HMR，端口 5173） |
| `npm run web:build` | 构建前端到 `dist/web/` |

**单包（发布前用）**：

```bash
cd packages/server && npm run build       # 仅 server
cd packages/mcp && npm run build          # 仅 mcp
cd packages/opencode-plugin && npm run build   # 仅 opencode-plugin
```

**发布到 npm**（需要 `$NPM_TOKEN`）：

```bash
node scripts/publish.mjs --dry-run    # 检查 tarball 内容
node scripts/publish.mjs --publish    # 实际发布（按 server -> mcp -> opencode-plugin 顺序）
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
