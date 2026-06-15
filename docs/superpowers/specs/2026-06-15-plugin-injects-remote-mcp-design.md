# OpenCode 插件注入 remote MCP 段 (2026-06-15)

## 问题（写侧）
plugin 当前**只读** server —— 注入摘要拿摘要、调 LLM 不留痕。系统**没有写侧闭环**：
- LLM 和用户在 OpenCode 里产生的高质量对话（user 问的、assistant 答的、tool 跑的）从来不进
  MemWeave 的 `observations` 表
- consolidation worker 只能从既有 memory 提纯，没有新 observation 触发它
- 用户**必须**主动调 `memory_save` 才能写东西 —— 但**没人**会主动调

plugin 既然在 OpenCode 进程里，**就应当**把"message 完成"这个事件上报 server。

## 决定
plugin 用 **`event` hook** 监听 OpenCode 事件总线：
- `message.updated` —— 拿完整的 `Message`（UserMessage / AssistantMessage）
- 异步 POST 到 server 的 `POST /api/v1/sessions` (新建) + `POST /api/v1/observations` (写一条)

数据流：OpenCode 写完消息 → plugin 拿到 → POST server → server 落 `sessions` + `observations` 表
→ consolidation worker 在下次 tick 把"高质量"observation 升级成 memory。

服务端不立即做 LLM 总结（避免 LLM token 成本）—— consolidation worker 周期跑时按 rule-based
判定 "高 importance" 才升级。

## 设计

### 1. plugin: 新增 `event` hook

`packages/opencode-plugin/src/index.ts` 加一个 `event` 钩子：

```ts
event: async ({ event }) => {
  if (event.type !== 'message.updated') return;
  const msg = event.properties.info;
  // 跳过 synthetic（system 自动生成）、跳过 tool message（v1 不收）
  if (msg.role === 'tool') return;
  // 拿到 messageId + sessionID + 内容
  // POST 到 server /api/v1/sessions/{id}/observations
}
```

**完整 message 内容怎么拿？** `Message` 不带 `text`，**只有** `info`。要拿正文得：
- **方案 A**：`EventMessagePartUpdated` 流式累积 —— 频繁，性能差
- **方案 B**：plugin 启动时用 OpenCode SDK `client.session.messages({ id })` 反查完整内容
- **方案 C**：直接用 `message.updated` 里的 `parts` 字段（如果有）

实际 OpenCode plugin 的 `EventMessagePartUpdated` 拿到的 `Part` 含 `text`（`TextPart`），可以用
**最后一次** part updated 拿到完整文本。**最简**是：每次 `message.updated` 触发时，**同步**调
`client.session.messages` 拿全文（OpenCode SDK 是 Bun-side HTTP client，会很轻量）。

**决定**：用 `EventMessagePartUpdated` 触发，只取**最后一条** `TextPart.text`，**debounce 200ms**
合并同 messageId 的多次 part 更新。完成后 POST server。

### 2. server: 新增 `POST /api/v1/sessions` + `POST /api/v1/observations`

`packages/server/src/rest/routes/sessions.ts` + `observations.ts` 加：

```ts
// POST /api/v1/sessions
{ sessionId: string, source: 'opencode' | 'cli' | 'mcp' | ...,
  title?: string, deviceId?: string }
→ { session: SessionRecord }

// POST /api/v1/observations
{ sessionId: string,
  hookType: 'chat.user' | 'chat.assistant' | 'chat.tool',
  toolName?: string,
  toolInput?: string,
  toolOutput?: string,
  messageId: string,
  text?: string }   // user/assistant message body
→ { observation: ObservationRecord }
```

**幂等性**：plugin 可能重复上报（OpenCode 重启、message 重发），`POST /sessions` 用
`sessionId` 做幂等 —— 已存在就返回 200 + 已有的 record（不抛错）。`POST /observations`
以 `(sessionId, messageId)` 唯一键 upsert（加 UNIQUE INDEX 的话）。

### 3. 闭环验证

| 阶段 | 检查 |
|---|---|
| OpenCode 跑一次对话 | `GET /api/v1/sessions?source=opencode&limit=10` 看到新 session |
| server DB | `SELECT * FROM sessions WHERE source='opencode'` 看到新行 |
| | `SELECT * FROM observations WHERE hook_type='chat.user'` 看到 user text |
| | `SELECT * FROM observations WHERE hook_type='chat.assistant'` 看到 assistant text |
| consolidation | `npm run cli -- consolidate` 触发；run 完成 logs 里"promoted X memories" |
| 重启 OpenCode 跑相似问题 | system prompt 注入能看到刚才被 promote 的 memory 摘要 |

## 不动的东西

- `experimental.chat.system.transform` 钩子（注入）：不变
- `tool.execute.before` 钩子（file_pack）：不变
- `client.ts`：加 `reportObservation()` 方法，**不**改 `requestInjection()`
- `memweave` 全局 CLI / web UI / REST 既有 endpoints：不变
- 旧 plugin 0.3.0 用户：升级后**马上**有写侧闭环

## 实施步骤（增量）

1. server: 给 `observations` 加 `(session_id, message_id)` UNIQUE INDEX + 幂等 `createOrGet`
2. server: `POST /api/v1/sessions` (idempotent)
3. server: `POST /api/v1/observations` (idempotent on messageId)
4. plugin: 加 `reportObservation()` to client.ts（POST /observations）
5. plugin: 加 `event` hook 监听 `message.updated` → 调 `client.session.messages()` 拿
   完整文本 → debounce 200ms → POST
6. plugin: 加 `config` 钩子**仍然**注入 mcp.memweave
7. 跑 `npm run typecheck && npm run build` 验证
8. 端到端测：启 server + 在 OpenCode 跑对话 → 查 DB
9. 发版：server 0.4.1 → 0.5.0；opencode-plugin 0.3.0 → 0.4.0
10. README 同步：写侧闭环流程图

## 测试

- [ ] `POST /api/v1/sessions` 第一次返 200 + 新 session；同样 sessionId 第二次返 200 + 同一
      record
- [ ] `POST /api/v1/observations` 第一次返 201 + 新 observation；同样 (sessionId, messageId)
      第二次返 200 + 同一 record
- [ ] plugin 启后跑对话：DB `sessions` + `observations` 表都有行
- [ ] server 关掉时 plugin 不报错（silent fail）
- [ ] consolidation 跑后新 memory 出现 type=`lesson` / `fact` / `decision` 之一

## 兼容性

- server 0.4.x 升级到 0.5.0：DB schema 加唯一索引 —— 用 `IF NOT EXISTS` 兼容旧 DB
- 旧 plugin 0.3.0 仍然能跑（继续只读），但没写侧
- 旧 client 调老的 GET 路由继续工作（不动）


## 设计

### Hook 实现

在 `packages/opencode-plugin/src/index.ts` 的 `MemweaveInjectPlugin` 返回值里加一个
`config` 钩子：

```ts
'config': async (config) => {
  // 强制注入 remote mcp 段，永远覆盖
  const baseUrl = process.env.MEMWEAVE_URL || 'http://127.0.0.1:3131';
  const mcpUrl = `${baseUrl.replace(/\/+$/, '')}/mcp`;
  if (!config.mcp) config.mcp = {};
  (config.mcp as Record<string, unknown>).memweave = {
    type: 'remote',
    url: mcpUrl,
    enabled: true,
  };
},
```

注意：
- 用 `Record<string, unknown>` cast 避开 `McpLocalConfig | McpRemoteConfig` 联合类型
  对 `type: "remote"` 推断的麻烦。运行时 OpenCode 接受。
- **不**改写 opencode.json 文件本身 —— `config` 钩子的副作用只对当前 OpenCode 进程
  的内存 config 生效。opencode.json 里用户手填的 mcp.memweave 段**保留**也无所谓（下次
  OpenCode 启动时会被 plugin 覆盖），但**不会**自动被清掉。
- **不**读 `config.mcp` 旧值 —— `mcp` 段里**其他**的 MCP server（用户自己加的）保留；
  只是 `memweave` 这一项总是被 plugin 重写。

### README 更新

`packages/opencode-plugin/README.md` 中：

1. **删掉**用户手填 `mcp` 段的那段示例（plugin 自动管）
2. **加**说明 "Plugin 自动把 memweave MCP 注册到 OpenCode 的 mcp.memweave 段"
3. **改** progressive-disclosure 流程图：把 "用户加 mcp 段" 这一步拿掉
4. README.md / README.en.md 5 分钟上手段同步更新：plugin 自动注入 mcp.memweave
   段，用户**只需** opencode.json 的 `plugin` 数组里有 `@mem-weave/opencode-plugin`

### 失败行为

- `config` 钩子抛错 → OpenCode 启动失败。这跟 plugin 是否注入 mcp 段**无关**——
  OpenCode 自己抛**没**接的 config 异常会 bail。我们的实现**不**抛错（永远 set
  一个 URL，不做健康检查）。server 端不可达时 OpenCode 会显示 "server unavailable"
  warning，但**不**影响 OpenCode 启动。
- 用户在 opencode.json 故意写了 `mcp.memweave: { type: "local", ... }` —— 也会被
  plugin 覆盖成 remote。这正是用户要的"永远注入"。

### 不动的东西

- `experimental.chat.system.transform` 钩子：不变
- `tool.execute.before` 钩子：不变
- `client.ts`：不变
- `packages/server` MCP 实现：不变
- `memweave` 全局 CLI / web UI / REST API：不变

## 实施步骤

1. 改 `packages/opencode-plugin/src/index.ts`：加 `config` 钩子
2. 改 `packages/opencode-plugin/README.md`：删 mcp 段手填示例 + 更新流程图
3. 改根 `README.md` / `README.en.md` Quick Start：opencode.json 只剩 `plugin` 段
4. 跑 `npm run typecheck` + `npm run build` 验证
5. 改 version：`@mem-weave/opencode-plugin` 0.3.0 → 0.4.0
6. 跑 `node scripts/publish.mjs --publish` 发布
7. 用户 `npm install -g @mem-weave/opencode-plugin@0.4.0` + 重启 OpenCode

## 测试

- [ ] 启 server + 装 plugin 0.4.0 + opencode.json 只含 `plugin: ["@mem-weave/opencode-plugin"]`
      → OpenCode 启动后，10 个 `memory_*` 工具在面板里
- [ ] 启 server + 装 plugin 0.4.0 + opencode.json 含 `mcp.memweave: { type: "local", ... }`
      → OpenCode 启动后，OpenCode 实际连的**是** remote (plugin 覆盖了)，
      LLM 能调 memory_save
- [ ] server 没启 + 装 plugin 0.4.0
      → OpenCode 启动不挂；mcp.memweave 段**有**但 status 显示 failed

## 兼容性

- `@opencode-ai/plugin` ≥ 1.17.x 才有 `config` 钩子（我们一直依赖最新）
- 不影响 `@mem-weave/server` 的 npm 包
- 旧 plugin 用户升级：他们手填的 mcp.memweave 段会**继续存在**（plugin 不会清 opencode.json
  文件），但被 plugin 运行时覆盖；可以**手动**从 opencode.json 删
