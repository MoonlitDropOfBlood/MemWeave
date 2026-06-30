# @mem-weave/claude-code-plugin

Claude Code / zcode 插件,把对话自动写入 [MemWeave](https://github.com/Duke_Bit/mem-weave) 记忆系统。

**兼容两个平台**:zcode 和 Claude Code 都用 `.claude-plugin` 格式 + Claude-Code 风格 hooks(stdin JSON 事件 + command 脚本),所以这一份插件两个平台都能装。

## 它做什么

监听 **Stop 事件**(对话回合结束),把会话 + 最后一条 assistant 消息 POST 到本地 MemWeave server。后台 consolidation worker 会判断哪些对话有记忆价值,晋升为长期记忆(LLM 富化生成 title/summary/concepts)。

**写入是幂等的**:同一会话同一消息重复触发 Stop 不会产生重复记录(基于 `(sessionId, messageId)` 哈希)。

**写入是 fail-silent 的**:MemWeave server 不可用时,agent 正常工作,不会被阻塞。

## 前置要求

1. **MemWeave server 已安装并运行**:
   ```bash
   npm install -g @mem-weave/server
   memweave init
   memweave start          # 后台启动,默认 http://127.0.0.1:3131
   ```

2. **Node.js >= 20**(hook 脚本是纯 Node,无原生依赖)

## 安装

插件是**目录型插件**(不是 npm 包),用 `.claude-plugin` 格式。zcode 和 Claude Code 都支持从本地路径安装。

### zcode

zcode 内置了 Claude Code 插件兼容(认 `.claude-plugin` 目录)。在 zcode 的插件市场/设置里添加本地插件,指向 `packages/claude-code-plugin` 目录,然后启用 `memweave` 插件。

### Claude Code

```bash
# Claude Code 的插件安装(从本地路径)
claude plugin install /path/to/memweave/packages/claude-code-plugin
```

或手动放到 `~/.claude/plugins/` 并在 `installed_plugins.json` 注册。

## 工作机制

```
[zcode] 对话回合结束 → Stop 事件 (JSON on stdin)
   ↓
[Plugin] hooks/stop.mjs
   ├─ 读 stdin JSON (session_id, cwd, transcript_path)
   ├─ 从 transcript JSONL 提取最后一条 assistant 消息
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
├── hooks/
│   ├── hooks.json           # Stop 事件绑定
│   ├── _lib.mjs             # 共享 HTTP 写入库(fail-silent)
│   └── stop.mjs             # Stop 事件处理:transcript → POST
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
