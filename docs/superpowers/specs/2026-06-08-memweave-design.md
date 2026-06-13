# MemWeave — 设计文档

> 日期: 2026-06-08
> 状态: 设计阶段（所有核心章节已填充并完成首轮确认；待最终审查后进入 implementation plan）

---

## 目录

1. [系统架构总览](#1-系统架构总览)
2. [记忆生命周期与衰减机制](#2-记忆生命周期与衰减机制)
3. [数据模型](#3-数据模型)
4. [3 层关联模型](#4-3-层关联模型)
5. [自动注入策略](#5-自动注入策略)
6. [采集与压缩策略](#6-采集与压缩策略)
7. [处理流水线](#7-处理流水线)
8. [接口设计](#8-接口设计)
9. [技术栈](#9-技术栈)
10. [Web UI / 审计界面](#10-web-ui--审计界面)

---

## 1. 系统架构总览

### 1.1 定位

持久化跨设备记忆引擎，为 AI 编码 Agent 提供带关系图谱的记忆服务。

**核心差异化**（vs agentmemory）:

| 维度 | agentmemory | 本系统 |
|------|-------------|--------|
| 关联模型 | 图谱是辅助索引 | 图谱是一等公民 |
| 因果时序 | 无 | 显式 causal chain |
| 记忆分组 | project 级别 | 灵活 scope 标签 |
| 采集策略 | 全量捕获 | 分类化捕获 + 过滤 |
| 生命周期 | 简单 TTL | 3-tier + Ebbinghaus 衰减 |

### 1.2 进程拓扑

```
┌────────────────────────────────────────────────────────┐
│  memweave-server (单 Node.js 进程)                        │
├────────────────────────────────────────────────────────┤
│  ┌────────────┐  ┌────────────┐                         │
│  │ HTTP/REST  │  │ MCP Server │   对外接口              │
│  │ (Fastify)  │  │ (stdio/HTTP)│                        │
│  └─────┬──────┘  └──────┬─────┘                         │
│        │                │                                │
│  ┌─────▼────────────────▼─────┐                          │
│  │   Service Layer (业务层)    │                          │
│  │  Ingest | Associate         │                          │
│  │  Retrieve | Inject          │                          │
│  └─────────────┬──────────────┘                          │
│                │                                          │
│  ┌─────────────▼──────────────┐                          │
│  │   Background Workers       │                          │
│  │  Compressor / Embedder     │                          │
│  │  Graph Maintainer          │                          │
│  │  Consolidator              │                          │
│  └─────────────┬──────────────┘                          │
│                │                                          │
│  ┌─────────────▼──────────────┐                          │
│  │  SQLite + sqlite-vec       │                          │
│  │  + FTS5 (BM25)             │                          │
│  └────────────────────────────┘                          │
└────────────────────────────────────────────────────────┘
```

### 1.3 四大业务模块

| 模块 | 职责 | 输入 | 输出 |
|------|------|------|------|
| **Ingest** | 接收原始事件，决定是否保留 | observation / hook event | Memory (raw) |
| **Associate** | 抽取实体、关系、因果链、分类 | Memory (raw) | Memory (enriched) + Edges |
| **Retrieve** | 混合检索：向量 + 图谱 + 标签 | query + scope | 排序后的 Memory 列表 |
| **Inject** | 在合适时机把记忆送进 AI 上下文 | 当前 session context | system prompt 片段 |

### 1.4 核心设计原则

1. **关联是一等公民** — 显式 typed edges，不是"图谱作为补充索引"
2. **分类化捕获** — 9 种记忆类型，每类独立衰减策略
3. **scope 灵活标签** — 多维度查询过滤
4. **记忆会自然遗忘** — 短期 → 中期 → 长期，模拟人脑巩固机制

### 1.5 部署形态

- 默认 `127.0.0.1:PORT` 单进程
- 配置文件可改 bind 到 `0.0.0.0`，给局域网/其他设备用
- 预留 systemd / PM2 部署（v1 不实现）

---

## 2. 记忆生命周期与衰减机制

### 2.1 三个记忆层级

| 层级 | 保留时长 | 容量预期 | 粒度 | 典型例子 |
|------|----------|----------|------|----------|
| **短期 (Short)** | ~7 天 | 100s/天 | 高，详细，含原始 tool I/O | "今天修改了 `UserService.ts` 的 `validateEmail` 函数" |
| **中期 (Medium)** | 30-90 天 | 10s/天 | 中，叙事化 + 关键事实 | "上周调试了 N+1 查询问题" |
| **长期 (Long)** | 永久 | 1-10s/天 | 低，高度抽象 | "项目用 Eloquent ORM，N+1 性能问题通常用 eager loading 解决" |

### 2.2 衰减函数（Ebbinghaus 变体）

v1 采用 **stored strength + periodic decay** 策略：

- `importance` 永远存 1-10 的整数，表示 LLM 初始重要性
- `baseImportance = importance / 10`，仅用于初始化 `strength`
- `strength` 是数据库中的动态字段，范围 0-1
- reinforcement 事件直接提高 `strength`
- consolidation 周期性对 `strength` 应用时间衰减

初始化：

```typescript
memory.strength = importance / 10;
```

周期性衰减：

```typescript
elapsedDays = (now - lastDecayAt) / DAY;
decayFactor = Math.exp(-elapsedDays / tau);
memory.strength = Math.max(0, memory.strength * decayFactor);
memory.lastDecayAt = now;
```

访问强化：

```typescript
memory.strength = Math.min(1, memory.strength + boost);
```

- `τ`（时间常数）: 由 tier + importance 共同决定
- `boost`: 由 AccessLog 的 source / usedInContext 决定

**初始 τ 表**（单位：天）：

| 重要性 \ 层级 | 短期 | 中期 | 长期 |
|:---:|:---:|:---:|:---:|
| 1-3（routine） | 1.0 | 5 | 60 |
| 4-6（edit/cmd） | 2.0 | 14 | 180 |
| 7-9（decision） | 7.0 | 30 | 永久 |
| 10（breaking） | 30.0 | 60 | 永久 |

### 2.3 晋升/淘汰规则

**晋升条件**（任一满足）：

| 从 → 到 | 触发条件 |
|---------|----------|
| 短期 → 中期 | 7 天内被访问 ≥3 次 **OR** importance ≥7 |
| 中期 → 长期 | 30 天内被访问 ≥5 次 **OR** 处于 ≥3 条因果链中 **OR** importance=10 |
| 长期 | 不可降级，但可被新记忆 supersede |

**淘汰条件**（AND）：

- 短期：strength < 0.1 **且** age > 7 天 **且** 0 次访问
- 中期：strength < 0.1 **且** age > 90 天 **且** accessCount < 2

淘汰采用**软删除** — 保留 30 天可恢复期。

### 2.4 巩固机制（Consolidation Worker）

每 6 小时跑一次，模拟"睡眠巩固"：

1. **相似合并** — 短期记忆里 embedding 相似度 > 0.85 的聚类，LLM 生成 cluster 摘要，原始条目淘汰，摘要晋升中期
2. **因果链检测** — 时间近的"事件 → 反应 → 结果"序列，提取为显式 edge chain
3. **矛盾检测** — 找到相互矛盾的长期记忆，标记为 "uncertain"，新版本 supersede 老版本
4. **晋升扫描** — 符合条件的短期/中期自动晋升
5. **淘汰扫描** — 符合条件的执行软删除

### 2.5 Reinforcement 信号汇总

| 信号 | Strength Boost | 备注 |
|------|----------------|------|
| 检索召回 | +0.10 | 每次被 AI 主动 recall |
| 被新记忆引用 | +0.15 | 通过 LLM 抽取的 explicit reference |
| 因果链成员 | +0.20/周 | 链越活跃 boost 越大 |
| 用户显式 save | +0.30 | importance 设为 8 |
| 多次匹配当前 query | +0.05/次 | 有冷却防刷 |
| Graph 高中心度 | +0.10 | PageRank-like 每周算一次 |

---

## 3. 数据模型

### 3.1 实体关系图

```
Tenant ─┬─ Device (多终端身份)
        └─ Session ── Observation (原始事件)
                 └─ Memory ── Edge (关系)
                      │
                      └── AccessLog (强化信号)
```

### 3.2 Memory（核心实体）

```typescript
interface Memory {
  id: string;                    // UUID
  tenantId: string;              // 多租户隔离
  tier: 'short' | 'medium' | 'long';  // 三级记忆
  type: MemoryType;              // 9 种类型
  title: string;                 // 短标题 (<100 字符)
  content: string;               // 详细内容 (Markdown)
  summary: string;               // 单行摘要
  concepts: string[];            // 概念标签 (用于 BM25/recall)
  files: string[];               // 关联文件路径
  importance: number;            // 1-10, LLM 初始打分
  confidence: number;            // 0-1, LLM 自信度
  strength: number;              // 0-1, 动态衰减强度
  source: 'user_explicit' | 'agent_capture' | 'system_inferred';
  scopeLevel: 'global' | 'project'; // 全局记忆 or 项目记忆
  sourceClient: 'opencode' | 'cursor' | 'claude_code' | 'rest_api' | null;
  sourceDeviceId: string | null;
  sourceSessionId: string | null;
  tau: number;                   // 衰减常数 (天)
  accessCount: number;           // 访问次数
  lastAccessedAt: number | null; // 最近访问时间
  lastReinforcedAt: number | null; // 最近强化时间
  lastDecayAt: number | null;    // 最近衰减计算时间
  reinforcementScore: number;    // 0-1，累计强化得分
  promotedAt: number | null;     // 晋升时间
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;      // 软删除时间
  evictionReason: string | null;
}

type MemoryType =
  | 'fact'              // 事实：客观、可验证的信息
  | 'decision'          // 决策：选择了什么以及为什么
  | 'preference'        // 偏好：用户长期习惯、风格、偏好
  | 'event'             // 事件：某次具体发生过的事情
  | 'project_context'   // 项目上下文：稳定的项目画像
  | 'lesson'            // 教训：以后该怎么做/避免什么
  | 'code_pattern'      // 代码模式：代码应该怎么写
  | 'bug'               // Bug：症状、根因、修复、验证
  | 'workflow';         // 工作流：做某类任务的步骤
```

### 3.3 Edge（关系，关联模型核心）

```typescript
interface Edge {
  id: string;
  tenantId: string;
  fromMemoryId: string;
  toMemoryId: string;
  type: EdgeType;
  strength: number;      // 0-1, 边权
  reason: string;        // LLM 生成的"为什么有这个关系"
  createdAt: number;
}

type EdgeType =
  | 'causes'            // 因果：A 导致 B
  | 'enables'           // 支撑/使能：A 让 B 成为可能
  | 'contradicts'       // 矛盾：A 与 B 不能同时为真
  | 'supersedes'        // 取代：A 取代旧记忆 B
  | 'references'        // 引用：A 明确引用 B
  | 'related_to'        // 弱语义相关：无更明确关系时使用
  | 'before'            // 时间先于：A 发生在 B 之前
  | 'after'             // 时间晚于：A 发生在 B 之后
  | 'duplicates'        // 重复：A 与 B 本质上是同一记忆
  | 'refines';          // 细化：A 是 B 的进一步展开
```

### 3.4 Session（会话上下文）

```typescript
interface Session {
  id: string;
  tenantId: string;
  deviceId: string;      // 哪个终端
  source: 'opencode' | 'cursor' | 'claude_code' | 'rest_api';
  title: string;
  summary: string | null;
  startedAt: number;
  endedAt: number | null;
  observationCount: number;
}
```

### 3.5 Observation（原始事件，未压缩）

```typescript
interface Observation {
  id: string;
  sessionId: string;
  tenantId: string;
  hookType: string;
  toolName: string;
  toolInput: string;     // truncated to 4KB
  toolOutput: string;    // truncated to 8KB
  timestamp: number;
  memoryId: string | null;  // 压缩后的 Memory 引用
  processed: boolean;        // 压缩完成标记
}
```

### 3.6 Tenant + Device

```typescript
interface Tenant {
  id: string;
  name: string;
  apiKeyHash: string;     // bcrypt
  createdAt: number;
  settings: Record<string, unknown>;
}

interface Device {
  id: string;            // UUID
  tenantId: string;
  name: string;          // "OpenCode on Laptop-A"
  type: 'opencode' | 'cursor' | 'claude_code' | 'rest';
  apiKeyHash: string;    // 每个设备独立 key
  lastSeenAt: number;
  registeredAt: number;
}
```

### 3.7 AccessLog（强化信号）

采用轻量 AccessLog + 90 天保留窗口：

- AccessLog 独立成表
- 原始日志只保留最近 90 天
- 超过 90 天的日志聚合进 Memory 的累计字段
- 记忆强化主要依据 `usedInContext=true`，不是所有搜索命中

```typescript
interface AccessLog {
  id: string;
  tenantId: string;
  memoryId: string;

  // 访问上下文
  sessionId: string | null;
  deviceId: string | null;

  // 来源
  source:
    | 'recall'
    | 'smart_search'
    | 'context_inject'
    | 'file_history'
    | 'graph_query'
    | 'manual_view';

  // 检索上下文
  query: string | null;
  rank: number | null;
  score: number | null;

  // 是否真正进入 AI 上下文
  usedInContext: boolean;

  accessedAt: number;
}
```

强化规则：

| 情况 | reinforcement |
|------|---------------|
| 搜索命中但未进入上下文 | +0.02 |
| 进入上下文 | +0.10 |
| 被新记忆明确引用 | +0.15 |
| 用户手动确认/收藏 | +0.30 |

索引：

```sql
CREATE INDEX idx_access_logs_memory_time
ON access_logs(memory_id, accessed_at DESC);

CREATE INDEX idx_access_logs_tenant_time
ON access_logs(tenant_id, accessed_at DESC);
```

清理策略：每天 consolidation 时删除 90 天前原始日志，并将统计汇总进 Memory。

### 3.8 MemoryScope（作用域标签）

scope 采用方案 B：独立 `memory_scopes` 表。

v1 不把 `agent` / `source` / `visibility=private` 放进 scope：

- `agent` 是来源元数据，放在 `sourceClient` / `sourceDeviceId`
- `source` 已由 Memory.source 表达
- 当前模型是 `1 tenant = 1 person`，不需要 private visibility

全局记忆通过 `Memory.scopeLevel = 'global'` 表达；项目记忆通过 `Memory.scopeLevel = 'project'` + `memory_scopes` 标签表达。

v1 scope key 仅保留：

```typescript
type ScopeKey = 'project' | 'domain' | 'topic';
```

```sql
CREATE TABLE memory_scopes (
  memory_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,      -- project / domain / topic
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(memory_id, key, value)
);

CREATE INDEX idx_memory_scopes_tenant_key_value
ON memory_scopes(tenant_id, key, value);

CREATE INDEX idx_memory_scopes_memory_id
ON memory_scopes(memory_id);
```

示例：

```json
{
  "type": "decision",
  "scopeLevel": "project",
  "scopes": [
    { "key": "project", "value": "memory" },
    { "key": "domain", "value": "memweave" },
    { "key": "topic", "value": "architecture" }
  ]
}
```

### 3.9 索引策略

| 表 | 索引 | 原因 |
|----|------|------|
| Memory | (tenantId, tier, strength DESC) | 检索时按 tier 分层召回 |
| MemoryScope | (tenantId, key, value) | scope 过滤 |
| Memory | (tenantId, type, createdAt DESC) | 按类型和时间浏览 |
| Edge | (fromMemoryId), (toMemoryId) | 图遍历 |
| Edge | (tenantId, type) | 关系类型统计 |
| Observation | (sessionId, timestamp) | 会话回放 |
| Session | (tenantId, startedAt DESC) | 会话列表 |
| **Vector** | sqlite-vec over `embedding` | ANN 检索 |
| **FTS** | FTS5 over content + concepts | BM25 全文搜索 |

---

## 4. 3 层关联模型

目标：用户查询时，系统不只找"文本相似"的记忆，而是同时考虑：

1. **语义相似** — 这条记忆内容是否相关？
2. **图谱关系** — 这条记忆和已命中的记忆有什么关系？
3. **因果时序** — 这条记忆是否是某个事件链的一部分？

### 4.1 总体检索流程

```text
Query
  │
  ▼
1. Query Analyzer
  - 提取 query intent
  - 推断 scope
  - 判断是否需要 graph / causal expansion
  │
  ▼
2. Candidate Retrieval
  ├─ Vector Recall       → top 50
  ├─ BM25 Recall         → top 50
  ├─ Graph Expansion     → top 30
  └─ Causal Chain Recall → top 30
  │
  ▼
3. Scope Filter
  - tenantId 必须匹配
  - scopeLevel/global 规则
  - project/domain/topic 过滤
  │
  ▼
4. Score Fusion
  - RRF 融合
  - tier 权重
  - strength 权重
  - recency 权重
  │
  ▼
5. Rerank
  - v1 可先不用 LLM rerank
  - 后续可加 cross-encoder / LLM rerank
  │
  ▼
6. Return Top K
  - 同时返回 whyMatched / edgePath / causalChain
```

### 4.2 Query Analyzer

Query Analyzer 做轻量归类，决定检索路径。

```typescript
interface QueryAnalysis {
  intent:
    | 'semantic_search'
    | 'why'
    | 'history'
    | 'file_history'
    | 'decision_trace'
    | 'bug_trace'
    | 'preference_lookup';

  scopeHints: {
    project?: string;
    domain?: string;
    topic?: string;
  };

  needsGraph: boolean;
  needsCausal: boolean;
}
```

示例：

| Query | intent | needsGraph | needsCausal |
|---|---|---:|---:|
| "MCP + REST 的设计是什么？" | semantic_search | false | false |
| "为什么不用 WebSocket？" | why / decision_trace | true | true |
| "这个 bug 之前怎么修的？" | bug_trace | true | true |
| "用户偏好是什么？" | preference_lookup | false | false |
| "这个文件历史上改过什么？" | file_history | true | true |

v1 可先用规则 + LLM 小 prompt 实现 Query Analyzer，后续缓存分析结果。

### 4.3 Layer 1: Vector + BM25 Recall

**Vector Recall** 用于语义相关：

```typescript
vectorCandidates = sqliteVec.search(queryEmbedding, {
  tenantId,
  limit: 50,
  minSimilarity: 0.55
});
```

适合模糊表达和同义查询，例如：

```text
query: "自动找相关记忆"
hit: "prompt-aware recall"
```

**BM25 Recall** 用于关键词精确匹配：

```typescript
bm25Candidates = fts.search(queryText, {
  tenantId,
  limit: 50
});
```

适合文件名、技术名、工具名、明确术语，例如 `sqlite-vec`。

| 方式 | 强项 | 弱项 |
|---|---|---|
| Vector | 语义模糊相关 | 对专有名词不稳定 |
| BM25 | 精确关键词 | 不懂同义词 |
| 两者结合 | 最稳 | 需要融合排序 |

### 4.4 Layer 2: Graph Expansion

Graph Expansion 的输入是第一阶段命中的 Memory，而不是原始 query。

```text
Vector/BM25 命中 Memory A
  │
  ▼
查 Edge 表：
  A causes ?
  A supersedes ?
  A refines ?
  A references ?
  A contradicts ?
  │
  ▼
扩展出相关 Memory B/C/D
```

v1 默认：

```typescript
const graphExpansionOptions = {
  depth: 1,
  maxNodes: 30,
  edgeTypes: [
    'causes',
    'enables',
    'supersedes',
    'references',
    'refines',
    'contradicts'
  ]
};
```

不默认扩展：

- `related_to`：太宽，容易噪声
- `duplicates`：主要给 consolidation 用
- `before` / `after`：交给 causal layer

### 4.5 Graph Edge 权重

| EdgeType | 权重 |
|---|---:|
| `supersedes` | 1.00 |
| `causes` | 0.95 |
| `refines` | 0.90 |
| `enables` | 0.85 |
| `references` | 0.75 |
| `contradicts` | 0.70 |
| `related_to` | 0.40 |
| `duplicates` | 0.30 |

说明：

- `duplicates` 权重低不是因为不重要，而是正常查询不该返回重复项。
- `supersedes` 权重高，因为它影响"旧记忆是否可信"。

### 4.6 Layer 3: Causal Chain Recall

Causal Chain 关注：事情是怎么一步步发生的。

适合：

- bug 追踪
- 决策追踪
- 设计演化
- 调试过程复盘

基于这些 EdgeType：

```typescript
const causalEdgeTypes = [
  'causes',
  'before',
  'after',
  'refines',
  'supersedes'
];
```

示例链：

```text
event: 发现 agentmemory 不主动 recall
  causes →
bug: 用户每次都要提醒 AI 去 memory_smart_search
  causes →
decision: 新系统必须支持 prompt-aware recall
  refines →
project_context: v1 检索设计包含 Query Analyzer
```

当 `QueryAnalysis.needsCausal = true`：

```text
1. 找初始相关 Memory seeds
2. 从 seeds 出发沿 causal edges 前后各走 N 步
3. 生成 chain candidates
4. 按 chainScore 排序
```

```typescript
chainScore =
  average(memory.strength)
  * average(edge.strength)
  * chainCompleteness
  * recencyFactor;
```

其中：

- `memory.strength`: 记忆自身强度
- `edge.strength`: LLM 对边关系的置信度
- `chainCompleteness`: 链是否完整，有无 root cause / fix / decision
- `recencyFactor`: 最近链略微加分，但不压过长期强记忆

### 4.7 Score Fusion

候选来源：

```typescript
type CandidateSource = 'vector' | 'bm25' | 'graph' | 'causal';
```

先用 RRF 融合：

```typescript
rrfScore(memory) = Σ 1 / (k + rankInSource)
```

默认：

```typescript
k = 60
```

再乘 memory factor：

```typescript
finalScore =
  rrfScore
  * tierWeight
  * strengthWeight
  * scopeWeight
  * freshnessWeight;
```

### 4.8 权重设计

**tierWeight**：

| Tier | 权重 |
|---|---:|
| long | 1.15 |
| medium | 1.00 |
| short | 0.85 |

长期记忆经过巩固，更可信；短期记忆噪声更高，所以略降权。

**strengthWeight**：

```typescript
strengthWeight = 0.5 + memory.strength
```

| strength | weight |
|---:|---:|
| 0.1 | 0.6 |
| 0.5 | 1.0 |
| 0.9 | 1.4 |

**scopeWeight**：

| 匹配情况 | 权重 |
|---|---:|
| exact project match | 1.20 |
| domain match | 1.10 |
| topic match | 1.05 |
| global memory | 1.00 |
| no scope match | 0.75 |

**freshnessWeight**：

```typescript
freshnessWeight = 1 + min(0.15, recencyBoost)
```

近期记忆最多加 15%，避免新记忆压倒长期高价值记忆。

### 4.9 Supersede 处理

`supersedes` 是特殊关系。

如果：

```text
A supersedes B
```

则：

- 默认查询返回 A
- B 降权
- 如果 query intent 是 `history` / `decision_trace`，B 仍可返回

规则：

```typescript
if (memory.isSuperseded) {
  if (intent === 'history' || intent === 'decision_trace') {
    keepButMarkSuperseded();
  } else {
    finalScore *= 0.2;
  }
}
```

这样避免 AI 拿旧设计当当前事实。

### 4.10 Contradiction 处理

`contradicts` 不直接删除任何一方。

当 query 命中互相矛盾的记忆时，返回结果里必须带 warning：

```json
{
  "warnings": [
    {
      "type": "contradiction",
      "with": "memory_123",
      "reason": "v1 是否需要 WebSocket 的判断相反"
    }
  ]
}
```

如果其中一条也被 `supersedes`，则新记忆优先。

### 4.11 Reinforcement 更新

只有真正被使用的记忆才大幅强化。

| 状态 | AccessLog.usedInContext | 强化 |
|---|---:|---:|
| 被检索出但未进入上下文 | false | +0.02 |
| 进入 AI 上下文 | true | +0.10 |
| 被新 memory 引用 | true | +0.15 |
| 用户明确确认有用 | true | +0.30 |

更新逻辑：

```typescript
memory.reinforcementScore += boost;
memory.strength = Math.min(1, memory.strength + boost);
memory.accessCount += 1;
memory.lastAccessedAt = now;
if (boost >= 0.10) memory.lastReinforcedAt = now;
```

### 4.12 返回结果结构

`memory_smart_search` 不只返回 content，还要返回为什么命中。

```typescript
interface SearchResult {
  memory: Memory;
  finalScore: number;
  sources: Array<'vector' | 'bm25' | 'graph' | 'causal'>;
  whyMatched: string;
  matchedScopes: Array<{ key: string; value: string }>;
  graphPath?: Edge[];
  causalChain?: Memory[];
  warnings?: SearchWarning[];
}
```

示例：

```json
{
  "memory": {
    "type": "decision",
    "title": "v1 使用 MCP + REST，不上 WebSocket"
  },
  "sources": ["vector", "graph", "causal"],
  "whyMatched": "query 提到多终端接入，该记忆是接口设计的当前决策，并 supersedes 早期 WebSocket 方案",
  "graphPath": ["early_websocket_idea -> supersedes -> mcp_rest_decision"]
}
```

### 4.13 v1 检索算法结论

```text
Vector Recall + BM25 Recall
  → Scope Filter
  → Graph Expansion
  → Causal Chain Recall
  → RRF Fusion
  → tier / strength / scope / freshness 加权
  → supersede / contradiction 特殊处理
  → Top K + whyMatched
```

核心原则：

1. 语义召回负责找候选
2. 图谱负责找关系
3. 因果链负责解释演化
4. scope 负责防污染
5. strength 负责记忆生命力
6. supersedes 防止旧记忆误导
7. AccessLog 让强化过程可解释

---

## 5. 自动注入策略

自动注入的目标是解决 agentmemory 的核心痛点：记忆已经存在，但 Agent 不知道什么时候该取。

本系统采用 **Cache-aware + Delta-based + Progressive Disclosure** 的自动注入策略，同时满足：

1. **Agent 更聪明** — 关键时机自动拿到相关记忆
2. **Agent 更便宜** — 稳定内容吃 prompt cache，动态内容只注入最小 delta

### 5.1 Prompt Cache 设计原则

很多 Agent / 模型都有便宜的 cache read。若每轮都把不同 memory 动态塞进 system prompt 前部，会导致 cache miss，反而更贵。

因此 system prompt 分层：

```text
[Stable System Prompt]        // 几乎不变，可缓存
[Stable Tool Instructions]    // 几乎不变，可缓存
[Stable Memory Pack]          // session_start 注入，一次生成后尽量不变
[Dynamic Memory Delta]        // 每轮 prompt 小量变化
[User Prompt]                 // 当前输入
```

动态 memory 不能插到稳定 prompt 前面。

### 5.2 注入层级

#### Layer 1: Stable Memory Pack

触发：session start。

内容：

- global preference
- project_context
- long-term decision
- high-strength workflow
- high-strength lesson

特点：

- session 内保持 byte-for-byte 稳定
- 可被模型缓存
- 不包含 volatile 字段

禁止放入：

```text
strength
accessCount
lastAccessedAt
retrievedAt
score
rank
```

建议只放：

```text
id
type
title
summary
scope
status
```

#### Layer 2: Prompt Delta Pack

触发：用户每次 prompt submit。

流程：

```text
prompt_aware_search 得到 top memories
  ↓
过滤掉 session 已注入的 memoryId
  ↓
过滤掉 stable pack 已包含的 memoryId
  ↓
过滤掉同 cluster / 同 contentHash 的重复项
  ↓
只注入新增 delta
```

特点：

- 小而动态
- 只包含未注入过的 memory
- 默认 300-800 tokens

#### Layer 3: File Memory Pack

触发：Agent 准备 Read / Edit / Write / Grep / Glob 某个文件时。

内容：

- code_pattern
- bug
- decision
- workflow

同一个文件在同一 session 内只注入一次：

```typescript
fileInjectCache: Map<filePath, memoryBundleHash>
```

除非：

- 文件相关新 memory 产生
- 文件上下文变化
- query intent 明显不同

#### Layer 4: Failure Delta Pack

触发：工具调用失败、测试失败、编译失败、命令报错。

内容：

- error-specific bug
- lesson
- workflow

failure 本身不高频，价值高，因此预算可稍大。

### 5.3 重复注入控制

三层去重：

#### 1. memoryId 去重

```typescript
if (session.injectedMemoryIds.has(memory.id)) skip;
```

#### 2. clusterId 去重

同一 cluster / duplicates 关系中，只注入 strength 更高的一条。

```typescript
if (sameCluster(memoryA, memoryB)) keepHigherStrength();
```

#### 3. contentHash 去重

即使 memoryId 不同，只要最终渲染文本一致，也不重复注入。

```typescript
contentHash = sha256(renderedMemoryBlock)
```

### 5.4 InjectionBundle

每个注入包都有稳定 cache key。

```typescript
interface InjectionBundle {
  id: string;
  phase: 'session_start' | 'prompt_delta' | 'file_pack' | 'failure_delta';
  tenantId: string;
  sessionId: string;
  scopeHash: string;
  memoryIds: string[];
  memoryVersions: string[];
  contentHash: string;
  createdAt: number;
}
```

如果下一次注入的：

```text
memoryIds + memoryVersions + renderingTemplate
```

都没变，则直接复用旧 bundle，保证 byte-for-byte 一致。

### 5.5 Progressive Disclosure（渐进披露）

默认注入 compact memory，不注入完整原文。

```xml
<memory id="mem_123" type="decision">
  <title>v1 使用 MCP + REST</title>
  <summary>系统接口采用 MCP + REST，不上 WebSocket。</summary>
  <why>当前 prompt 讨论自动注入策略。</why>
</memory>
```

Agent 需要细节时再调用：

```typescript
memory_expand(memoryId)
```

返回完整内容、图路径、因果链。

### 5.6 注入预算

| Phase | Budget | TopK | 说明 |
|---|---:|---:|---|
| session_start stable pack | 1000-1500 | 5 | session 内固定 |
| prompt_delta | 300-800 | 3-5 | 只注入新增信息 |
| file_pack | 500-1000 | 3-6 | 同文件同 session 一次 |
| failure_delta | 800-1500 | 5-8 | 错误场景价值高 |

原则：

```text
不是每轮按上限塞，而是只塞本轮新增、确实有用、之前没出现过的 memory。
```

### 5.7 渲染稳定性

同一组 memory 渲染出的文本必须完全一致：

- 固定排序
- 不带当前时间
- 不带动态 score
- 不带 accessCount
- 不带 volatile 字段

否则同样内容每次不同，prompt cache 失效。

### 5.8 注入后的强化

每次注入后写 AccessLog：

```typescript
AccessLog {
  source: 'context_inject',
  usedInContext: true,
  query,
  rank,
  score,
  accessedAt
}
```

然后：

```typescript
memory.strength += 0.10;
memory.accessCount += 1;
memory.lastAccessedAt = now;
memory.lastReinforcedAt = now;
```

冷却规则：

```text
同一 memory 同一 session 内最多强化 1 次。
```

### 5.9 v1 注入策略总结

| 注入点 | 必做 | 策略 |
|---|---:|---|
| session_start | 是 | Stable Memory Pack |
| prompt_submit | 是 | Prompt Delta Pack |
| file tool before | 是 | File Memory Pack |
| tool failure | 是 | Failure Delta Pack |

v1 不做：

- WebSocket 实时推送
- 每个 tool call 注入
- 完整 Memory 原文注入
- 跨终端主动打断

## 6. 采集与压缩策略

这一节解决：Agent 每天会产生大量原始事件，哪些该变成 Memory，如何分类成 9 种 MemoryType，如何避免垃圾记忆爆炸。

### 6.1 核心原则

#### Observation 不是 Memory

```text
Observation = 原始事件
Memory = 经过筛选、压缩、分类后值得保留的记忆
```

普通读取文件本身不一定成为 Memory；只有读取发现了重要架构事实、决策、bug、workflow 时才生成 Memory。

#### 默认不记，除非有价值

```text
普通读取 / 普通 grep / 无信息命令输出
  → 只保留 Observation，短期衰减
  → 不生成 Memory
```

#### Memory 必须结构化

每条 Memory 必须具备：

```text
type
title
summary
content
concepts
importance
confidence
scope
candidateEdges
```

否则不入库。

### 6.2 采集来源

| 来源 | 例子 | 默认处理 |
|---|---|---|
| `prompt_submit` | 用户发起任务/讨论 | 高价值，可能生成 preference / decision / project_context |
| `tool_success` | Read/Edit/Grep/Bash 成功 | 低到中价值，需筛选 |
| `tool_failure` | 编译失败/测试失败/命令错误 | 高价值，可能生成 bug / lesson |
| `manual_save` | 用户明确说"记住这个" | 强制生成 Memory |
| `session_summary` | session 结束总结 | 生成中期/长期 memory 候选 |

### 6.3 Observation Pipeline

```text
Raw Event
  │
  ▼
1. Normalize
  - 统一字段
  - 截断超长 input/output
  - 隐私过滤
  │
  ▼
2. Value Gate
  - 判断是否值得生成 Memory
  - 不值得 → 只保留短期 Observation
  │
  ▼
3. Compress
  - LLM 压缩为结构化候选 Memory
  │
  ▼
4. Classify
  - 分类成 9 种 MemoryType
  │
  ▼
5. Scope Detect
  - 推断 project/domain/topic
  │
  ▼
6. Edge Extract
  - 抽取 candidateEdges
  │
  ▼
7. Validate
  - schema 校验
  - 置信度校验
  │
  ▼
8. Store
  - Memory 入库
  - Embedding
  - Edge 入库
```

### 6.4 Value Gate

防止噪声爆炸的第一道门。

```typescript
interface ValueGateResult {
  shouldCreateMemory: boolean;
  reason: string;
  suggestedTypes: MemoryType[];
  priority: 'low' | 'medium' | 'high';
}
```

直接生成 Memory 的情况：

- 用户明确要求记住："记住这个"、"以后遇到这种情况..."
- 明确决策："我们就用 MCP + REST"、"不要 WebSocket"
- 明确错误 / failure：build failed、test failed、runtime crash、tool error
- 明确项目结构 / 架构发现：检索流程、scope 存储、关键设计确认

默认不生成 Memory 的情况：

- 普通 Read
- 普通 Glob
- 普通 Grep
- 重复 Bash 成功
- 没有新信息的工具输出

模糊情况默认只保留短期 Observation，交给 consolidation 后台判断。

原则：

```text
宁可短期 Observation 多一点，也不要长期 Memory 变垃圾场。
```

### 6.5 Compression Schema

LLM 压缩输出必须严格结构化。

```typescript
interface MemoryCandidate {
  shouldCreateMemory: boolean;
  type: MemoryType;
  title: string;
  summary: string;
  content: string;
  concepts: string[];
  files: string[];
  importance: number;       // 1-10
  confidence: number;       // 0-1
  scopeLevel: 'global' | 'project';
  scopes: Array<{
    key: 'project' | 'domain' | 'topic';
    value: string;
  }>;
  candidateEdges: Array<{
    targetHint: string;     // memory id / title / concept
    type: EdgeType;
    reason: string;
    confidence: number;
  }>;
}
```

### 6.6 MemoryType 分类规则

| MemoryType | 判定规则 |
|---|---|
| `fact` | 客观、可验证的单点事实 |
| `decision` | 明确选择了 A 而不是 B，必须有 rationale |
| `preference` | 用户长期偏好、风格、工作习惯 |
| `event` | 某次具体发生过的事，时间绑定强 |
| `project_context` | 项目的稳定背景/架构画像 |
| `lesson` | 从结果中总结出的以后该怎么做 |
| `code_pattern` | 代码应该怎么写、项目实现模式 |
| `bug` | 问题、根因、修复、验证 |
| `workflow` | 做某类任务的步骤流程 |

分类优先级：

```text
preference
> decision
> bug
> workflow
> lesson
> code_pattern
> project_context
> fact
> event
```

`event` 最泛，避免滥用；`preference` / `decision` / `bug` 是长期价值最高的类型。

### 6.7 Importance 初始评分

| 分数 | 含义 | 默认 tier |
|---:|---|---|
| 1-3 | routine，无长期价值 | short |
| 4-5 | 有局部价值 | short |
| 6 | 项目相关、有复用可能 | short / medium |
| 7-8 | 决策、bug、workflow、lesson | medium |
| 9 | 关键架构决策 / 用户偏好 | medium，快速晋升 |
| 10 | breaking change / 核心长期规则 | long 候选 |

### 6.8 Confidence 规则

| confidence | 行为 |
|---:|---|
| < 0.55 | 不生成 Memory，只保留 Observation |
| 0.55-0.75 | 生成 short-tier Memory，等待 consolidation |
| > 0.75 | 正常生成 Memory |
| > 0.9 + importance >= 8 | 可直接进入 medium |

### 6.9 Scope Detect

scope 推断只使用：

```typescript
project / domain / topic
```

规则：

- preference 默认 `scopeLevel='global'`
- project_context / code_pattern / bug 默认 `scopeLevel='project'`
- decision 根据内容判断：项目决策 → project，全局偏好式决策 → global

示例：

```json
[
  { "key": "project", "value": "memory" },
  { "key": "domain", "value": "memweave" },
  { "key": "topic", "value": "retrieval" }
]
```

### 6.10 Edge Extract

Compression 阶段输出 candidateEdges，但不立刻盲信。

```text
candidateEdges
  ↓
Resolve targetHint
  ↓
查现有 Memory
  ↓
相似度 / 标题 / concept 匹配
  ↓
置信度 > 阈值才创建 Edge
```

创建 Edge 条件：

```text
edge.confidence > 0.75
targetMemory found
```

否则保留为 unresolved edge candidate，等 consolidation 再处理。

### 6.11 去重策略

生成 Memory 前先查重复。

1. **exact content hash**

```typescript
sha256(normalizedTitle + normalizedSummary)
```

完全重复直接跳过。

2. **embedding similarity**

```text
similarity > 0.92
```

判断为 duplicates 候选。

3. **LLM duplicate judge**

如果 embedding 很高但不确定，让 LLM 判断：

```text
duplicates / refines / related_to / no_relation
```

对应创建 Edge 或合并。

### 6.12 隐私过滤

入库前必须过滤：

- API key
- token
- password
- private key
- bearer token
- cookies
- `.env` 内容
- 可能的个人敏感信息

三道防线：

```text
1. Regex 先过滤常见 secret
2. LLM compression prompt 强制禁止输出 secret
3. Store 前再跑 sanitizer
```

宁可丢信息，也不存 secret。

### 6.13 Session Summary

session 结束时生成：

```typescript
interface SessionSummary {
  title: string;
  narrative: string;
  keyDecisions: string[];
  bugs: string[];
  lessons: string[];
  filesTouched: string[];
  concepts: string[];
  candidateMemories: MemoryCandidate[];
}
```

作用：

- 把多个短期 Observation 压缩成中期 Memory
- 检测跨事件因果链
- 给下一次 session_start stable pack 提供输入

### 6.14 v1 采集策略结论

```text
1. 所有原始事件都进入 Observation（短期、可衰减）
2. Value Gate 判断是否立即生成 Memory
3. 高价值事件立即 LLM compression
4. 低价值事件仅保留 Observation，交给 consolidation
5. Compression 输出 MemoryCandidate
6. Validate + dedupe + edge resolve
7. Store Memory + embedding + FTS + Edge
```

核心原则：

```text
Observation 可以多，Memory 必须少而准。
```

## 7. 处理流水线

### 7.1 完整流程

```
Agent 事件
   │
   ▼
┌──────────────┐
│ 1. Ingest    │  接收 hook event → 创建 Observation
│              │  隐私过滤（strip secrets）
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 2. Compress  │  LLM 压缩 → 分类 (9 types)
│ (Background) │  提取 concepts, files, importance
│              │  生成 title, content, summary
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 3. Embed     │  生成 embedding → 存入 sqlite-vec
│ (Background) │  索引 FTS5
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 4. Associate │  LLM 抽取实体关系 → 创建 Edge
│ (Background) │  检测因果链 → 创建 chain
│              │  检测矛盾 → 标记
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 5. Retrieve  │  混合检索 (Vector + Graph + Causal)
│ (On-demand)  │  RRF 融合 → Rerank → Top K
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 6. Inject    │  格式化 → 注入 system prompt
│ (On-demand)  │  或在 query 时直接返回
└──────────────┘
```

### 7.2 Consolidation Worker（每 6 小时）

```
1. 相似合并    → 短期聚类 → LLM 摘要 → 晋升中期
2. 因果链检测  → 时序序列 → 创建 Edge chain
3. 矛盾检测    → 对比长期记忆 → 标记 / supersede
4. 晋升扫描    → 符合条件的短期/中期自动晋升
5. 淘汰扫描    → 符合条件的软删除
```

---

## 8. 接口设计

目标：MCP 给 Agent 用，REST 给 UI / 脚本 / 调试用。两者不需要 1:1 完全一致，但底层必须调用同一套 Service Layer。

```text
MCP Tool
   │
   ▼
Service Layer
   ▲
   │
REST Endpoint
```

### 8.1 接口分层原则

#### MCP：少而智能

MCP tools 面向 Agent 行为：保存、搜索、展开、查询图谱、查询文件历史、触发巩固。

不暴露太多内部管理接口，避免 Agent 乱改图谱结构。

#### REST：完整可控

REST API 面向 Web UI、调试、外部脚本、导入导出、管理任务，支持 CRUD、分页、过滤、审计。

### 8.2 MCP Tools（v1）

v1 暴露 10 个 MCP tools：

```typescript
type McpTool =
  | 'memory_save'
  | 'memory_recall'
  | 'memory_smart_search'
  | 'memory_expand'
  | 'memory_graph_query'
  | 'memory_file_history'
  | 'memory_sessions'
  | 'memory_patterns'
  | 'memory_consolidate'
  | 'memory_forget';
```

| Tool | 描述 | 主要参数 |
|------|------|----------|
| `memory_save` | 显式保存记忆 | content, type, title, concepts, files, scopeLevel, scopes, importance |
| `memory_recall` | 轻量关键词/语义召回 | query, limit, scope, types |
| `memory_smart_search` | 主力混合搜索 | query, limit, scope, types, includeGraph, includeCausal, mode |
| `memory_expand` | 渐进披露：展开完整记忆 | memoryId, includeGraph, includeCausal |
| `memory_graph_query` | 显式图谱查询 | memoryId, depth, edgeTypes, direction, limit |
| `memory_file_history` | 查询文件历史相关记忆 | filePath, limit, types, includeBugs, includePatterns |
| `memory_sessions` | 列出最近 session | limit, project, sourceClient |
| `memory_patterns` | 检测 recurring patterns | type, scope, sinceDays, limit |
| `memory_consolidate` | 手动触发 consolidation | tier, dryRun |
| `memory_forget` | 删除/遗忘记忆 | memoryIds, reason, hardDelete |

### 8.3 MCP 参数草案

#### `memory_save`

```typescript
interface MemorySaveArgs {
  content: string;
  type?: MemoryType;
  title?: string;
  concepts?: string[];
  files?: string[];
  scopeLevel?: 'global' | 'project';
  scopes?: Array<{ key: 'project' | 'domain' | 'topic'; value: string }>;
  importance?: number; // 1-10
}

interface MemorySaveResult {
  memoryId: string;
  type: MemoryType;
  tier: 'short' | 'medium' | 'long';
  title: string;
  summary: string;
  createdEdges: Array<{ edgeId: string; type: EdgeType; targetMemoryId: string }>;
}
```

#### `memory_recall`

```typescript
interface MemoryRecallArgs {
  query: string;
  limit?: number; // default 5
  scope?: ScopeFilter;
  types?: MemoryType[];
}

interface MemoryRecallResult {
  results: Array<{
    memoryId: string;
    type: MemoryType;
    title: string;
    summary: string;
    score: number;
  }>;
}
```

#### `memory_smart_search`

```typescript
interface MemorySmartSearchArgs {
  query: string;
  limit?: number; // default 8
  scope?: ScopeFilter;
  types?: MemoryType[];
  includeGraph?: boolean;  // default auto
  includeCausal?: boolean; // default auto
  mode?: 'compact' | 'full';
}

interface MemorySmartSearchResult {
  queryAnalysis: QueryAnalysis;
  results: SearchResult[];
}
```

#### `memory_expand`

```typescript
interface MemoryExpandArgs {
  memoryId: string;
  includeGraph?: boolean;
  includeCausal?: boolean;
}

interface MemoryExpandResult {
  memory: Memory;
  graphNeighbors?: Array<{
    edge: Edge;
    memory: Memory;
  }>;
  causalChain?: Memory[];
}
```

#### `memory_graph_query`

```typescript
interface MemoryGraphQueryArgs {
  memoryId: string;
  depth?: 1 | 2 | 3;
  edgeTypes?: EdgeType[];
  direction?: 'in' | 'out' | 'both';
  limit?: number;
}

interface MemoryGraphQueryResult {
  nodes: Memory[];
  edges: Edge[];
  paths: Array<{
    memoryIds: string[];
    edgeIds: string[];
    score: number;
  }>;
}
```

### 8.4 MCP 不暴露的管理工具

v1 不暴露：

```text
memory_update
memory_edge_create
memory_edge_delete
memory_import
memory_export
memory_tenant_manage
memory_device_manage
```

原因：这些更适合 REST 管理 API，不适合 Agent 自动调用。

### 8.5 REST API（v1）

#### Memories

```http
POST   /api/v1/memories
GET    /api/v1/memories
GET    /api/v1/memories/:id
PATCH  /api/v1/memories/:id
DELETE /api/v1/memories/:id
POST   /api/v1/memories/search
GET    /api/v1/memories/:id/graph
GET    /api/v1/memories/:id/access-logs
```

#### Observations

```http
POST   /api/v1/observations
GET    /api/v1/observations
GET    /api/v1/observations/:id
POST   /api/v1/observations/:id/compress
```

#### Sessions

```http
POST   /api/v1/sessions
GET    /api/v1/sessions
GET    /api/v1/sessions/:id
POST   /api/v1/sessions/:id/end
GET    /api/v1/sessions/:id/memories
```

#### Graph

```http
GET    /api/v1/graph/neighbors/:memoryId
POST   /api/v1/graph/query
POST   /api/v1/graph/edges
DELETE /api/v1/graph/edges/:id
```

#### Consolidation

```http
POST   /api/v1/consolidate
GET    /api/v1/consolidate/runs
GET    /api/v1/consolidate/runs/:id
```

#### Admin / Device

```http
GET    /api/v1/health
GET    /api/v1/stats
POST   /api/v1/devices
GET    /api/v1/devices
DELETE /api/v1/devices/:id
```

### 8.6 REST 和 MCP 的区别

| 能力 | MCP | REST |
|---|---:|---:|
| Agent 搜索记忆 | ✅ | ✅ |
| Agent 保存记忆 | ✅ | ✅ |
| 展开 memory | ✅ | ✅ |
| 图谱查询 | ✅ | ✅ |
| 手动创建 Edge | ❌ | ✅ |
| 修改 Memory | ❌ | ✅ |
| 导入导出 | ❌ | ✅ |
| 设备管理 | ❌ | ✅ |
| UI 浏览 | ❌ | ✅ |
| AccessLog 查看 | ❌ | ✅ |

### 8.7 统一错误格式

REST：

```typescript
interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
```

示例：

```json
{
  "error": {
    "code": "MEMORY_NOT_FOUND",
    "message": "Memory mem_123 not found"
  }
}
```

MCP：

```typescript
interface ToolError {
  ok: false;
  code: string;
  message: string;
}
```

### 8.8 认证设计

v1 简化：

```http
Authorization: Bearer <device-api-key>
```

认证后解析出：

```typescript
{
  tenantId,
  deviceId,
  sourceClient
}
```

每个 Device 有独立 key，方便吊销。

v1 不做：

- OAuth
- 多用户登录
- 团队权限
- role-based access control

因为当前模型是：

```text
1 tenant = 1 person
```

---

## 9. 技术栈与部署细节

产品名确认：**MemWeave**。

命名体系：

| 项 | 名称 |
|---|---|
| 项目名 | MemWeave |
| CLI | `memweave` |
| 主服务 | `memweave-server` |
| MCP shim | `memweave-mcp` |
| 配置目录 | `~/.memweave/` |
| 数据库 | `~/.memweave/data/memweave.db` |
| 配置文件 | `~/.memweave/config.jsonc` |

### 9.1 技术栈总览

| 层 | 选型 | 理由 |
|----|------|------|
| 运行时 | Node.js 20+ | 与 OpenCode / MCP 生态一致 |
| 语言 | TypeScript | 类型可复用到 MCP/REST/schema |
| HTTP 框架 | Fastify | 性能好，TS 支持好 |
| MCP SDK | `@modelcontextprotocol/sdk` | 官方标准 |
| 数据库 | SQLite | 本地优先，单文件，易备份 |
| SQLite Driver | `better-sqlite3` | 简单稳定，同步 API 便于事务 |
| 向量索引 | `sqlite-vec` | 无需额外 vector DB |
| 全文搜索 | SQLite FTS5 | BM25 检索，补足 vector 对专有名词不稳的问题 |
| Embedding | `@xenova/transformers`，可选 API | 默认本地免费，保护隐私 |
| LLM | OpenAI-compatible API | 兼容 Volcengine / DeepSeek / Ollama |
| Config | `~/.memweave/config.jsonc` | 支持注释，方便手工编辑 |
| Logging | pino | 高性能 JSON logger |
| Validation | zod | 参数/schema 统一校验 |
| Test | Vitest | TS 生态友好 |

### 9.2 Node.js + TypeScript

v1 推荐 `Node.js 20+ + TypeScript`。

原因：

1. 当前生态已围绕 OpenCode / MCP / agentmemory
2. MCP SDK 在 Node.js 生态成熟
3. Fastify + better-sqlite3 开发速度快
4. TypeScript schema 可在 MCP/REST/DB/service 层复用
5. 未来做前端管理页也方便复用类型

替代方案暂不采用：

| 方案 | 不作为 v1 的原因 |
|---|---|
| Python + FastAPI | AI 生态强，但 MCP/CLI 集成略弱 |
| Go | 单二进制好，但 LLM/MCP/sqlite-vec 生态工作量更大 |
| Rust | 性能强，但开发成本过高 |

### 9.3 SQLite + better-sqlite3

v1 使用 SQLite。

场景是：

```text
一个 memweave-server 进程
多个 Agent 客户端 / MCP shim / REST clients
所有写入经过主服务串行化
```

因此 SQLite 足够。

建议 PRAGMA：

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

未来若做多人/云端，可抽象 `StorageProvider`，迁移到 PostgreSQL + pgvector。

### 9.4 sqlite-vec + FTS5

向量检索：`sqlite-vec`。

全文检索：SQLite FTS5。

建议 sqlite-vec 表（默认 `Xenova/nomic-embed-text-v1`，维度 768）：

```sql
CREATE VIRTUAL TABLE memory_vectors USING vec0(
  memory_id TEXT PRIMARY KEY,
  tenant_id TEXT,
  embedding FLOAT[768]
);

CREATE INDEX idx_memory_vectors_tenant
ON memory_vectors(tenant_id);
```

建议 FTS：

```sql
CREATE VIRTUAL TABLE memory_fts USING fts5(
  title,
  summary,
  content,
  concepts_text,
  content='memories',
  content_rowid='rowid'
);
```

FTS 同步采用 SQLite triggers：

```sql
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memory_fts(rowid, title, summary, content, concepts_text)
  VALUES (new.rowid, new.title, new.summary, new.content, new.concepts_text);
END;

CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, title, summary, content, concepts_text)
  VALUES ('delete', old.rowid, old.title, old.summary, old.content, old.concepts_text);
END;

CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, title, summary, content, concepts_text)
  VALUES ('delete', old.rowid, old.title, old.summary, old.content, old.concepts_text);
  INSERT INTO memory_fts(rowid, title, summary, content, concepts_text)
  VALUES (new.rowid, new.title, new.summary, new.content, new.concepts_text);
END;
```

原因：

- Vector 适合语义模糊匹配
- BM25 适合文件名、API 名、工具名、错误码、专有术语
- 两者组合最稳

### 9.5 Embedding Provider

默认：本地 `@xenova/transformers`。

默认模型：

```text
Xenova/nomic-embed-text-v1
```

默认维度：

```text
768
```

如果配置 API embedding，`dimensions` 必须在 provider 初始化时明确返回，DB migration 需要按维度建对应 vector table。

抽象接口：

```typescript
interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  dimensions: number;
}
```

v1 实现：

- `local-xenova`
- `openai-compatible`

### 9.6 LLM Provider

推荐 OpenAI-compatible API。

配置示例：

```jsonc
{
  "llm": {
    "provider": "openai-compatible",
    "baseUrl": "env://MEMWEAVE_LLM_BASE_URL",
    "apiKey": "env://MEMWEAVE_LLM_API_KEY",
    "model": "env://MEMWEAVE_LLM_MODEL",
    "temperature": 0.2
  }
}
```

LLM 用于：

1. Value Gate
2. Compression
3. MemoryType 分类
4. Edge Extract
5. Duplicate Judge
6. Session Summary
7. Query Analyzer（可选）

v1 不默认使用本地 LLM，优先保证分类/压缩质量；但预留 Local Provider。

### 9.7 MCP Server 模式

采用 **HTTP server + stdio MCP shim**。

结构：

```text
OpenCode / Cursor
  ↓ stdio MCP shim
memweave-mcp
  ↓ HTTP
memweave-server:REST
```

原因：

- `memweave-server` 是唯一真实服务
- 多终端共享同一进程
- DB 只有一个 writer
- Agent 接入仍然是标准 MCP
- MCP shim 很薄，容易维护

不采用每个 MCP 子进程直接访问 DB，避免并发和状态不一致。

### 9.8 进程模型

```text
memweave-server
  - HTTP REST API
  - Background workers
  - SQLite DB writer
  - Local embedding worker

memweave-mcp
  - stdio MCP server
  - 不直接访问 DB
  - 只通过 HTTP 调 memweave-server
```

### 9.9 配置文件

默认路径：

```text
~/.memweave/config.jsonc
~/.memweave/data/memweave.db
~/.memweave/logs/
```

Windows：

```text
C:\Users\<user>\.memweave\config.jsonc
C:\Users\<user>\.memweave\data\memweave.db
```

示例配置：

```jsonc
{
  "server": {
    "host": "127.0.0.1",
    "port": 3131
  },

  "storage": {
    "path": "~/.memweave/data/memweave.db"
  },

  "embedding": {
    "provider": "local-xenova",
    "model": "Xenova/nomic-embed-text-v1"
  },

  "llm": {
    "provider": "openai-compatible",
    "baseUrl": "env://MEMWEAVE_LLM_BASE_URL",
    "apiKey": "env://MEMWEAVE_LLM_API_KEY",
    "model": "env://MEMWEAVE_LLM_MODEL",
    "temperature": 0.2
  },

  "auth": {
    "defaultTenantName": "default",
    "deviceApiKey": "env://MEMWEAVE_DEVICE_API_KEY"
  },

  "consolidation": {
    "enabled": true,
    "intervalHours": 6,
    "accessLogRetentionDays": 90
  },

  "injection": {
    "sessionStartBudget": 1200,
    "promptDeltaBudget": 800,
    "filePackBudget": 1000,
    "failureDeltaBudget": 1500
  }
}
```

### 9.10 目录结构

```text
src/
  server/
    http.ts
    mcp-shim.ts
    bootstrap.ts

  core/
    types.ts
    errors.ts
    config.ts

  db/
    schema.ts
    migrations/
    repositories/
      memory-repo.ts
      edge-repo.ts
      session-repo.ts
      observation-repo.ts
      access-log-repo.ts

  services/
    ingest-service.ts
    compression-service.ts
    association-service.ts
    retrieval-service.ts
    injection-service.ts
    consolidation-service.ts

  providers/
    llm/
      index.ts
      openai-compatible.ts
    embedding/
      index.ts
      local-xenova.ts
      openai-compatible.ts

  mcp/
    tools/
      memory-save.ts
      memory-recall.ts
      memory-smart-search.ts
      memory-expand.ts
      memory-graph-query.ts
      memory-file-history.ts
      memory-sessions.ts
      memory-patterns.ts
      memory-consolidate.ts
      memory-forget.ts

  rest/
    routes/
      memories.ts
      observations.ts
      sessions.ts
      graph.ts
      consolidation.ts
      devices.ts

  workers/
    compressor-worker.ts
    embedder-worker.ts
    graph-worker.ts
    consolidator-worker.ts

  prompts/
    compression-prompt.ts
    query-analysis-prompt.ts
    duplicate-judge-prompt.ts
    session-summary-prompt.ts
```

### 9.11 CLI 命令

```bash
memweave start
memweave stop
memweave status
memweave init
memweave doctor
memweave mcp
memweave migrate
memweave backup
```

| 命令 | 用途 |
|---|---|
| `start` | 启动 memweave-server |
| `stop` | 停止 server |
| `status` | 查看健康状态 |
| `init` | 初始化配置、DB、默认 tenant/device key |
| `doctor` | 检查依赖、端口、DB、embedding/LLM 配置 |
| `mcp` | 启动 stdio MCP shim |
| `migrate` | 执行 DB migration |
| `backup` | 备份 SQLite DB |

### 9.12 端口

推荐默认：

```text
3131: REST API
```

不需要额外 WebSocket。

如果以后做 UI：

```text
3132: Web UI
```

### 9.13 测试策略

单元测试：

- decay function
- RRF fusion
- scope filter
- edge traversal
- dedupe
- value gate

集成测试：

- save → recall
- observation → compression → memory
- memory_smart_search
- graph_query
- accessLog reinforcement
- consolidation promotion/eviction

Golden tests：

```text
input observation → expected MemoryCandidate JSON
```

重点覆盖：

- decision
- bug
- preference
- workflow
- duplicate detection
- edge extraction

### 9.14 技术栈结论

v1 最终建议：

```text
Node.js 20+ + TypeScript
Fastify REST API
stdio MCP shim → HTTP memweave-server
SQLite + better-sqlite3
sqlite-vec + FTS5
OpenAI-compatible LLM
local-xenova embedding by default
zod + pino + vitest
```

核心架构选择：

```text
一个 memweave-server 常驻进程
多个 memweave-mcp / REST clients 连接
DB 只由 memweave-server 写入
```

这满足：

- 独立进程
- 多终端同时接入
- 默认单租户
- 未来多租户可拓展
- 本地优先
- 成本可控

---

## 10. Web UI / 审计界面

MemWeave UI 不是普通管理后台，而是一个 **Memory Observatory / Memory Atlas**：让用户看见、审计、纠错、追踪 AI 记忆如何被生成、强化、注入和遗忘。

### 10.1 UI 核心定位

UI 要回答 8 个审计问题：

1. 这条记忆为什么存在？
2. 它从哪里来？
3. 它为什么被强化？
4. 它什么时候被注入？
5. 它和哪些记忆冲突？
6. 它是否已经被 supersede？
7. 它为什么被遗忘？
8. 它有没有污染当前项目上下文？

### 10.2 视觉风格：Calm Memory Atlas

风格方向：**Memory Atlas + Calm Research Lab**。

气质：

```text
Obsidian Graph
+ Arc Browser 的柔和空间感
+ Linear 的克制细节
+ 科研笔记 / knowledge atlas
```

关键词：

```text
warm paper
soft graph
reading-first
audit by exploration
low-friction inspection
sleep/consolidation metaphor
```

它不是安全审计平台，也不是普通 SaaS 后台，而是：

```text
一间安静的研究室里，你在看 AI 记忆如何被编织成地图。
```

### 10.3 色彩方向

#### Light Theme（默认）

```css
--bg: #F7F4EE;          /* warm paper */
--surface: #FFFFFF;
--surface-soft: #F0ECE3;
--border: #DDD5C7;
--text: #26231F;
--text-muted: #7A7266;

--accent: #3B7C6E;      /* muted teal */
--accent-soft: #DDEDE8;

--warning: #C98A2E;
--danger: #B85C5C;
--success: #5B8A5A;
--link: #466FA6;
```

#### Dark Theme

```css
--bg: #171A18;
--surface: #20241F;
--surface-soft: #2A3029;
--border: #3A4238;
--text: #ECE7DD;
--text-muted: #A8A095;

--accent: #6AB7A5;
--accent-soft: #183C35;

--warning: #D9A441;
--danger: #D27A7A;
--success: #8FBF87;
--link: #8CABD9;
```

### 10.4 字体方向

推荐：

```text
Display: Fraunces
Body: IBM Plex Sans
Mono: JetBrains Mono
```

理由：

- Fraunces 带研究笔记/书卷感
- IBM Plex Sans 可读性高，不像普通 SaaS
- JetBrains Mono 用于 ID、hash、日志、代码片段

### 10.5 一级页面

v1 页面：

```text
Atlas
Memories
Injection
Sleep
Settings
```

后置页面：

```text
Timeline
Access Logs 独立页
```

AccessLog v1 可先嵌入 Memory 详情和 Injection 详情。

### 10.6 页面设计

#### Atlas

总览 + 图谱入口。

展示：

- Memory Health
- Short / Medium / Long 分布
- 今日晋升 / 遗忘 / 合并
- 最近活跃 project/domain/topic
- 最近 Sleep Cycle 摘要
- 图谱入口

视觉重点：生命周期流动，而不是一堆 KPI 卡片。

#### Memories

记忆浏览器。

布局：

```text
左: Filter rail
中: Memory list
右: Reading panel
```

筛选：

- MemoryType
- tier
- project/domain/topic
- strength
- status: active / superseded / evicted

Memory card：

```text
[decision] [medium]  v1 使用 MCP + REST
系统接口采用 MCP + REST，不上 WebSocket。
scope: memory / architecture
strength: 0.84
```

详情面板：

- Title
- Summary
- Content
- Type / Tier
- Strength curve
- Importance / Confidence
- Scope tags
- Source session / device
- Related edges
- Access history
- Injection history

可操作：

```text
Edit
Forget
Promote
Demote
Merge
Mark duplicate
Mark superseded
Change scope
Expand graph
```

#### Graph / Atlas Detail

图谱作为空间导航，而不是炫技。

布局：

```text
左: filters
中: graph canvas
右: selected memory detail
```

节点像小纸片，不是纯圆点。

边颜色：

| EdgeType | 视觉 |
|---|---|
| causes | muted terracotta |
| enables | soft green |
| contradicts | amber warning |
| supersedes | blue gray |
| references | gray |
| related_to | muted gray |
| before/after | soft purple |
| duplicates | dashed |
| refines | teal/cyan |

#### Injection

自动注入审计页，重点解决重复注入和 prompt cache。

每条 InjectionBundle 展示：

```text
Session
Phase
Bundle ID
Content Hash
Memory IDs
Token Count
Cache Status
Injected At
```

详情：

```text
Stable Memory Pack
Prompt Delta Pack
Skipped Memories
Cache Key
Content Hash
Token Count
AccessLog entries
```

关键指标：

- cache reuse rate
- average prompt delta tokens
- duplicate injection avoided
- top injected memories

#### Sleep

Consolidation / 遗忘 / 晋升页。

使用"睡眠巩固"隐喻：

```text
Sleep Cycle #42
- 6 memories promoted
- 18 forgotten
- 4 clusters merged
- 2 contradictions found
```

详情：

```text
Promoted:
  mem_123 short → medium
  reason: accessed 3 times in 7 days

Evicted:
  mem_234 short → soft deleted
  reason: strength < 0.1, age > 7d, 0 access

Merged:
  mem_111 + mem_112 → mem_200
  reason: similarity 0.94
```

可操作：

```text
Restore evicted memory
Undo merge
Force promote
Force forget
```

#### Settings

配置项：

- server host / port
- DB path
- LLM provider / model / API key status
- embedding provider / dimensions
- consolidation interval / retention days
- injection budgets
- registered devices / revoke key

### 10.7 关键组件

#### MemoryCard

展示单条 memory：

```text
[type badge] [tier badge] title
summary
scope tags
strength bar
last accessed
status: active / superseded / evicted
```

#### StrengthCurve

展示记忆强度随时间衰减和 access boost。

#### GraphCanvas

- nodes = Memory
- edges = Edge
- zoom / pan
- hover edge 显示 reason
- click node 打开详情

#### InjectionBundleViewer

展示：

```text
Stable Pack
Prompt Delta
Skipped
Cache Key
Content Hash
Token Count
```

#### SleepCycleDiff

类似 git diff：

```text
+ promoted mem_123
- evicted mem_234
~ merged mem_345 + mem_346 → mem_500
→ edge created mem_1 causes mem_2
```

### 10.8 前端技术栈

推荐：

```text
React + Vite + TypeScript
```

| 用途 | 选择 |
|---|---|
| 构建 | Vite |
| 框架 | React |
| 样式 | CSS Modules 或 Tailwind |
| 图谱 | React Flow（v1） |
| 图表 | Recharts |
| 表格 | TanStack Table |
| 状态 | Zustand |
| API | typed fetch client |

图谱库：

- v1 用 React Flow
- 图谱变大后可换 Sigma.js

### 10.9 UI 路由

```text
/ui
  /atlas
  /memories
  /memories/:id
  /injection
  /sleep
  /settings
```

REST API 保持：

```text
/api/v1/...
```

前端由 `memweave-server` 直接 serve 静态资源：

```text
http://127.0.0.1:3131/ui
```

开发模式可用 Vite dev server。

### 10.10 动效原则

```text
Motion should clarify, not perform.
```

只做轻动效：

- Graph 节点轻微 fade/slide
- Memory detail 切换淡入
- Strength curve 绘制动画
- Sleep diff 展开折叠

不做大面积炫酷动画。

---

## 待确认项

以下核心设计项已在本轮设计中确认：

- [x] 系统架构与模块划分
- [x] 3-tier 记忆生命周期
- [x] Ebbinghaus 衰减函数
- [x] 晋升/淘汰规则
- [x] Reinforcement 信号
- [x] 9 种 MemoryType 已确认：fact / decision / preference / event / project_context / lesson / code_pattern / bug / workflow
- [x] 10 种 EdgeType 已确认：causes / enables / contradicts / supersedes / references / related_to / before / after / duplicates / refines
- [x] AccessLog 已确认：独立表 + 90 天保留窗口 + Memory 累计强化字段
- [x] scope 已确认：独立 memory_scopes 表，v1 keys 为 project / domain / topic，global 用 Memory.scopeLevel 表达
- [x] MCP 工具列表已确认：10 个 v1 tools，MCP 少而智能
- [x] REST API 端点已确认：完整 CRUD + 管理能力
- [x] 技术栈选型已确认：MemWeave 命名体系 + Node.js/TS + Fastify + SQLite/sqlite-vec/FTS5 + MCP shim

---

*本文档随设计讨论持续更新。*
