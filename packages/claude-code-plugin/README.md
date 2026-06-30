# @mem-weave/claude-code-plugin

Claude Code / zcode 插件,给 agent 接入 [MemWeave](https://github.com/MoonlitDropOfBlood/MemWeave) 记忆系统的**完整闭环**。

**兼容两个平台**:zcode 和 Claude Code 都用 `.claude-plugin` 格式 + Claude-Code 风格 hooks(stdin JSON 事件 + command 脚本),所以这一份插件两个平台都能装。

## 它做什么(三个能力)

| 能力 | 事件 | 说明 |
|---|---|---|
| **自动注入记忆** | `SessionStart` | 会话开始时,从 server 拉取 `<about-user>`(用户画像)+ `<memory-context>`(相关记忆摘要)注入到 agent 上下文。agent 一开口就知道用户是谁、之前聊过什么。 |
| **自动写入对话** | `Stop` | 对话回合结束时,从 transcript 提取最后一条 assistant 消息,POST 到 server。后台 consolidation 会把高价值对话晋升为长期记忆。 |
| **暴露 MCP 工具** | `.mcp.json` | 暴露 13 个 `memory_*` 工具(recall/save/smart_search/expand/graph_query/create_edge/profile_get/profile_update 等),agent 可主动召回/保存/建边。 |

**写入是幂等的**:同一会话同一消息重复触发 Stop 不会产生重复记录(基于 `(sessionId, messageId)` 哈希)。

**全部 fail-silent**:MemWeave server 不可用时,agent 正常工作,不会被阻塞。

## 前置要求

1. **MemWeave server 已安装并运行**:
   ```bash
   npm install -g @mem-weave/server
   memweave init
   memweave start          # 后台启动,默认 http://127.0.0.1:3131
   ```

2. **Node.js >= 20**(hook 脚本是纯 Node,无原生依赖)

## 安装

插件是**目录型插件**(不是 npm 包),用 `.claude-plugin` 格式。zcode 和 Claude Code 都支持从本地路径或 GitHub 安装。

### zcode

zcode 内置了 Claude Code 插件兼容(认 `.claude-plugin` 目录)。在 zcode 的插件市场/设置里添加本地插件,指向 `packages/claude-code-plugin` 目录,然后启用 `memweave` 插件。

或通过 GitHub 安装:
- 仓库:`https://github.com/MoonlitDropOfBlood/MemWeave.git`
- 子目录:`packages/claude-code-plugin`
- 分支:`master`

### Claude Code

```bash
# Claude Code 的插件安装(从本地路径)
claude plugin install /path/to/memweave/packages/claude-code-plugin
```

或手动放到 `~/.claude/plugins/` 并在 `installed_plugins.json` 注册。

> **MCP 工具注意**:zcode 的 `.mcp.json` 用 `type: "url"`。如果 Claude Code 不支持此 type,需在 Claude Code settings 里手动加 MCP server(url: `http://127.0.0.1:3131/mcp`)。hooks(注入+写入)两个平台都兼容。

## 工作机制(完整闭环)

```
[会话开始] SessionStart 事件
   ↓
[Plugin] hooks/session-start.mjs
   └─ POST /api/v1/inject → 拿 <about-user> + <memory-context>
   └─ stdout 注入 additionalContext → agent 看到用户画像 + 记忆摘要
   ↓
[对话进行] agent 可调 MCP 工具
   ├─ memory_recall("查询")      → 主动召回相关记忆
   ├─ memory_save({...})         → 主动保存重要信息
   ├─ memory_create_edge({...})  → 主动建立记忆关联
   └─ memory_profile_update({...}) → 更新用户画像
   ↓
[对话回合结束] Stop 事件
   ↓
[Plugin] hooks/stop.mjs
   ├─ 从 transcript JSONL 提取最后一条 assistant 消息
   ├─ POST /api/v1/sessions    → 幂等建 session
   └─ POST /api/v1/observations → 幂等写 assistant 消息
   ↓
[Server] consolidation worker
   ├─ value-gate 判断记忆价值
   ├─ LLM 富化(title/summary/concepts)
   └─ 晋升为长期记忆 → 下次 SessionStart 注入
```
   ├─ POST /api/v1/sessions    → 幂等建 session (source: "zcode")
   └─ POST /api/v1/observations → 幂等写 assistant 消息 (hookType: "chat.assistant")
   ↓
[MemWeave server] consolidation worker 周期跑
   ├─ value-gate 判断是否有记忆价值
   ├─ LLM 富化(生成 title/summary/concepts)
   └─ 晋升为长期记忆
```

## 环境变量

| 变量 | 默认值 | 含义 |
|---|---|---|
| `MEMWEAVE_SERVER_URL` | `http://127.0.0.1:3131` | MemWeave server 地址 |
| `MEMWEAVE_TENANT` | `tenant_default` | 租户 ID |

## 文件结构

```
claude-code-plugin/
├── .claude-plugin/
│   └── plugin.json          # Claude Code / zcode 插件 manifest(两平台通用)
├── .mcp.json                # 暴露 13 个 memory_* MCP 工具(type: "url" → /mcp)
├── hooks/
│   ├── hooks.json           # SessionStart + Stop 事件绑定
│   ├── _lib.mjs             # 共享 HTTP 库(stdin/POST/注入,fail-silent)
│   ├── session-start.mjs    # SessionStart:拉取记忆+画像 → 注入 additionalContext
│   └── stop.mjs             # Stop:transcript → POST session + observation
├── fixtures/
│   └── stop.json            # 测试 fixture
└── package.json             # 元数据(private,不发布)
```

## 本地测试

```bash
# 确保 memweave server 在跑
memweave start

# 跑 Stop hook(用 fixture 模拟事件)
node hooks/stop.mjs < fixtures/stop-with-transcript.json
# 输出: {"continue":true}

# 验证写入
curl http://127.0.0.1:3131/api/v1/sessions | grep zcode
```

## 与其他插件的关系

- **OpenCode 插件** (`@mem-weave/opencode-plugin`):写入 user + assistant 消息 + 注入记忆摘要(读侧闭环)
- **Codex 插件** (`packages/codex-plugin/`):写入 assistant 消息 + 暴露 MCP 工具
- **zcode 插件**(本插件):写入 assistant 消息(从 transcript 提取)

三者都走相同的 MemWeave server REST API(`/sessions` + `/observations`),source 字段区分来源(`opencode`/`codex`/`zcode`)。
