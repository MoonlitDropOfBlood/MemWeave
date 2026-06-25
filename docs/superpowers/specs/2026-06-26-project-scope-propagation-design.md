# Project scope 全链路修复 (2026-06-26)

## 问题

MemWeave 的数据模型**早就**支持 project scope（`ScopeKey='project'`、`ScopeLevel='project'`、`memory_scopes` 表、`observations.scopes_json`），但**整条链路没有客户端在喂**：

| 层 | 现状 |
|---|---|
| `sessions` 表 | **没** `project` 列 —— 847 行全部 NULL |
| `POST /api/v1/sessions` schema | 没 `project` 字段 |
| `POST /api/v1/observations` schema | 已接受 `scopes` ✅ |
| OpenCode / Mavis / Codex 插件 | 已发 `[{key:'project', value:cwd 绝对路径}]`（v0.5.4 起），**不是解析后的名字** |
| `memory_save` MCP tool | 把 `sourceClient`/`sourceDeviceId`/`sourceSessionId` 三个字段**丢弃**了（`mcp/service.ts:65-81` 的 `enriched` 不带它们） |
| Web UI 项目筛选 | 没数据，dashboard 看不到任何 project 标签 |

实际效果：1634 条 observation 全部 `scopes_json='[]'`（v0.5.4 之前写的），v0.5.4 之后的 observation 写了 cwd 但**不是**解析后的项目名，session 行永远是 NULL。

## 目标

修齐三层：

1. **`sessions.project`** 存解析后的项目名（`memweave`），不是 cwd 路径
2. **`observations.scopes[].value`** 也用解析后的项目名（跟 session.project 对齐，consolidation 继承到 memory 后 dashboard 筛选才能一致）
3. **历史 847 条 session 自动回填**（从旧 observation scopes 拿旧 cwd，解析后回写）

## 决定（设计选择记录）

| # | 决策 | 选项 |
|---|---|---|
| D1 | **解析优先级** | (a) git remote URL 最后一段 → (b) cwd 的 basename → (c) cwd 绝对路径 |
| D2 | **observation scope 值** | **统一用解析后的项目名**（不再传 cwd 绝对路径） |
| D3 | **session.project 写入策略** | **冻结在首次写入** —— `findOrCreate` 保持现有逻辑，不加 PATCH 路径 |
| D4 | **回填触发点** | **schema migration 后自动跑**（`openDatabase()` 里 `addColumnIfMissing` 之后串行），不暴露 CLI flag |
| D5 | **helper 实现位置** | **4 份 copy-paste**（server + 3 个 plugin），不抽 shared package；契约靠注释 + 单测绑定 |
| D6 | **回填函数 FS 读取** | **纯 FS**（`node:fs` 读 `.git/config`），不 spawn `git` 子进程 |
| D7 | **回填范围** | 只回填 `sessions.project`；不动 `memory_scopes` 历史数据 |

## 设计

### 1. 数据模型 — `sessions` 表加列

**`packages/server/src/db/schema.ts`** —— `CREATE TABLE sessions` 块加一列：

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  device_id TEXT,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  project TEXT,                  -- ← 新增
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  observation_count INTEGER NOT NULL DEFAULT 0,
  ...
);
```

**`packages/server/src/db/database.ts`** —— `openDatabase()` 现有 `addColumnIfMissing` 模式追加一行：

```ts
addColumnIfMissing(db, 'observations', 'scopes_json', "TEXT NOT NULL DEFAULT '[]'");  // v0.5.4 已存在
addColumnIfMissing(db, 'sessions', 'project', "TEXT");                              // ← v0.7.0 新增
backfillSessionProjects(db);                                                         // ← v0.7.0 新增
```

不建索引：sessions 量级小，全表扫够。

### 2. `resolveProject(cwd)` 工具函数

新文件 **`packages/server/src/util/resolve-project.ts`**（TS）：

```ts
export interface FsAdapter {
  readFile: (p: string) => string;
  stat: (p: string) => { isFile(): boolean; isDirectory(): boolean };
}

const defaultFs: FsAdapter = {
  readFile: (p) => readFileSync(p, 'utf8'),
  stat: (p) => statSync(p),
};

export function resolveProject(cwd: string, fs: FsAdapter = defaultFs): string {
  if (!cwd) return '';
  const config = readGitConfig(cwd, fs);
  if (config) {
    const url = extractOriginUrl(config);
    if (url) {
      const last = lastSegment(url);
      if (last) return last;
    }
  }
  const base = basename(cwd);
  return base || cwd;
}

function readGitConfig(cwd: string, fs: FsAdapter): string | null {
  const gitPath = join(cwd, '.git');
  try {
    const stat = fs.stat(gitPath);
    let configPath: string;
    if (stat.isFile()) {
      // worktree: .git is a file pointing to gitdir
      const content = fs.readFile(gitPath);
      const m = content.match(/gitdir:\s*(.+)/);
      if (!m) return null;
      configPath = join(dirname(m[1].trim()), 'config');
    } else if (stat.isDirectory()) {
      configPath = join(gitPath, 'config');
    } else {
      return null;
    }
    return fs.readFile(configPath);
  } catch {
    return null;
  }
}

function extractOriginUrl(gitConfig: string): string | null {
  const re = /\[remote\s+"origin"\][^\[]*?url\s*=\s*([^\s\n]+)/;
  const m = gitConfig.match(re);
  return m ? m[1].trim() : null;
}

function lastSegment(url: string): string {
  const cleaned = url.replace(/\.git$/, '');
  const parts = cleaned.split(/[\/:]/).filter(Boolean);   // split on / and : (for git@github.com:user/repo)
  return parts.length > 0 ? parts[parts.length - 1]! : '';
}
```

测试时通过 `resolveProject(cwd, mockFsAdapter)` 注入 mock FS，避免污染真实仓库。`FsAdapter` 接口只需 `readFile` + `stat` 两个方法，memfs / 自写 stub 都可。

### 3. Backfill 函数

**回填范围限定**：只回填"至少有 v0.5.4+ observation（带 project scope 数据）"的 session。如果某旧 session 的所有 observations 都是 v0.5.4 之前写入的（`scopes_json='[]'`），回填**无数据可读**，session.project 保留 NULL，UI 显示 "(no project)"。这是已知边界——v0.5.4 之前的 observation 丢了 cwd 信息，找不回来。

新文件 **`packages/server/src/db/backfill-project.ts`**：

```ts
export function backfillSessionProjects(db: Db): void {
  const candidates = db.prepare(`
    SELECT DISTINCT s.id AS session_id
    FROM sessions s
    INNER JOIN observations o ON o.session_id = s.id
    WHERE s.project IS NULL
      AND o.scopes_json != '[]'
      AND o.scopes_json LIKE '%"key":"project"%'
  `).all() as Array<{ session_id: string }>;

  if (candidates.length === 0) return;

  let resolved = 0, errored = 0;
  const oldCwdStmt = db.prepare(`
    SELECT scopes_json FROM observations
    WHERE session_id = ? AND scopes_json LIKE '%"key":"project"%'
    ORDER BY timestamp ASC LIMIT 1
  `);
  const updateStmt = db.prepare(
    `UPDATE sessions SET project = ? WHERE id = ? AND project IS NULL`
  );

  const tx = db.transaction(() => {
    for (const row of candidates) {
      try {
        const obs = oldCwdStmt.get(row.session_id) as { scopes_json: string } | undefined;
        if (!obs) continue;
        const scopes = JSON.parse(obs.scopes_json) as Array<{ key: string; value: string }>;
        const projScope = scopes.find((s) => s.key === 'project');
        if (!projScope?.value) continue;
        const project = resolveProject(projScope.value);
        if (!project) continue;
        const r = updateStmt.run(project, row.session_id);
        if (r.changes > 0) resolved++;
      } catch (err) {
        errored++;
        logger.warn({ sessionId: row.session_id, err: (err as Error).message }, 'backfill: failed to resolve');
      }
    }
  });

  tx();
  logger.info(
    { candidates: candidates.length, resolved, errored },
    'backfill: session.project populated from historical observations'
  );
}
```

### 4. SessionRepo + REST route 改动

**`packages/server/src/db/repositories/session-repo.ts`** —— `CreateSessionInput` / `SessionRecord` / 两个 INSERT 都加 `project` 字段：

```ts
export interface CreateSessionInput {
  tenantId: string;
  deviceId: string | null;
  source: SourceClient;
  title: string;
  project: string | null;        // ← 新增
}

export interface SessionRecord {
  // ... 现有字段
  project: string | null;         // ← 新增
}

// create() 和 findOrCreate() 的 INSERT 都加 project 列；
// findOrCreate() 维持"已存在不更新"语义（与 D3 一致）
```

**`packages/server/src/rest/routes/sessions.ts`** —— `CreateSessionSchema` 加可选字段：

```ts
const CreateSessionSchema = z.object({
  sessionId: z.string().min(1).max(200),
  source: z.enum(['opencode', 'cursor', 'claude_code', 'codex', 'mavis', 'rest_api']),
  title: z.string().min(1).max(500),
  deviceId: z.string().min(1).max(200).optional(),
  project: z.string().min(1).max(500).optional()   // ← 新增
});
```

handler：`sessionRepo.findOrCreate({ ..., project: body.project ?? null })`

### 5. `memory_save` MCP tool 修 bug

**`packages/server/src/mcp/service.ts:65-81`** —— 把丢弃的三个字段补回 `enriched`：

```ts
const enriched = {
  tenantId: this.tenantId,
  type: input['type'] ?? 'fact',
  title, content, summary, concepts, files, importance,
  confidence: 0.8,
  source: 'user_explicit' as const,
  scopeLevel, scopes,
  // ← 新增（缺省 null）
  sourceClient: typeof input['sourceClient'] === 'string' ? input['sourceClient'] : null,
  sourceDeviceId: typeof input['sourceDeviceId'] === 'string' ? input['sourceDeviceId'] : null,
  sourceSessionId: typeof input['sourceSessionId'] === 'string' ? input['sourceSessionId'] : null,
};
```

### 6. 三个插件 — `deriveProject()` + `reportSession`/`reportObservation` 调用

#### opencode-plugin（TS）

**`packages/opencode-plugin/src/derive-project.ts`**（新文件）：与 server 端 `resolve-project.ts` 同**契约**——同样的 cascade（git remote last segment → basename → absolute path）。**不强制同样签名**：plugin 不需要 `FsAdapter` 注入，直接 `node:fs` 实读，测试通过 hook fixture 集成验证（`packages/opencode-plugin/src/derive-project.test.ts` 用 vitest + memfs）。契约测试矩阵（见 §验证 B）保证 4 份实现行为一致。

**`packages/opencode-plugin/src/client.ts`**：

```ts
export interface ReportSessionRequest {
  sessionId: string;
  source: 'opencode' | 'cli' | 'mcp' | 'web' | 'sdk';
  title: string;
  deviceId?: string;
  project?: string;            // ← 新增
}
```

**`packages/opencode-plugin/src/index.ts`**（event hook 内）：

```ts
import { deriveProject } from './derive-project.js';
// ...
const cwd = (() => { try { return process.cwd(); } catch { return ''; } })();
const project = deriveProject(cwd);
const scopes = project ? [{ key: 'project' as const, value: project }] : [];

await client.reportSession({ sessionId: sessionID, source: 'opencode', title, project });
await client.reportObservation({ sessionId: sessionID, messageId: messageID, hookType, text, scopes });
```

#### mavis-plugin（MJS）

**`hooks/_lib.mjs`**：
- 新增 `deriveProjectFromCwd(cwd)` 实现（同 cascade，签名简单 `function(cwd: string): string`）
- 改 `deriveProjectScope(event)`：`return deriveProjectFromCwd(deriveCwd(event))`
- 改 `reportSession({ sessionId, source, title, project, deviceId })`：增加 `project` 参数透传

**`hooks/writeback.mjs`** / **`hooks/prompt-inject.mjs`**：

```js
const project = deriveProjectScope(event);
const scopes = project ? [{ key: 'project', value: project }] : [];
await reportSession({ sessionId, source: 'mavis', title, project });
await reportObservation({ sessionId, messageId, hookType, text, scopes });
```

**`hooks/file-pack.mjs`**：不动（只调 `requestInjection`）。

#### codex-plugin（MJS）

跟 mavis-plugin 完全平行，只差 `source: 'codex'` 和 makeMessageId 前缀。

### 7. 不动的东西

- `memory_scopes` 表 / `consolidator.ts` 继承逻辑
- `observations.scopes_json` schema / `ScopeTagInputSchema`
- `injection/bundler.ts` 的 `MemoryLite` 类型（scope-aware 过滤是另一 ticket）
- mavis/codex 的 `deriveSessionId()`（仍基于 cwd hash 而非 project name）
- `GET /api/v1/sessions/:id` 响应——加 `project` 字段即可，handler 自动透传

## 验证

### A. 静态

```bash
cd packages/server && npm run typecheck
cd packages/opencode-plugin && npm run typecheck

node --check packages/mavis-plugin/hooks/_lib.mjs
node --check packages/mavis-plugin/hooks/writeback.mjs
node --check packages/mavis-plugin/hooks/prompt-inject.mjs
node --check packages/codex-plugin/hooks/_lib.mjs
node --check packages/codex-plugin/hooks/stop.mjs
node --check packages/codex-plugin/hooks/prompt-inject.mjs
```

### B. 单元测试

```bash
# Server
cd packages/server && npm test -- --run backfill-project
cd packages/server && npm test -- --run resolve-project
cd packages/server && npm test

# 三个 plugin hook 测试（断言新 reportSession payload 含 project）
cd packages/opencode-plugin && npm test
cd packages/mavis-plugin && npm run test:all
cd packages/codex-plugin && npm run test:all
```

测试矩阵（resolveProject / deriveProject 契约测试，每个实现一份）：

| case | 输入 | 期望 |
|---|---|---|
| 普通 repo（带 remote） | cwd 有 `.git/config`，`[remote "origin"] url=https://github.com/foo/memweave.git` | `'memweave'` |
| worktree | cwd 下 `.git` 是 file，指向 `/main/.git/worktrees/wt-970e42f5` | `'memweave'`（回到主 repo 的 config） |
| 本地新建 repo | cwd 有 `.git/config`，无 `[remote "origin"]` 块 | basename(cwd) |
| 非 git 目录 | cwd 无 `.git` | basename(cwd) |
| path 不存在 | cwd 在 FS 上已被删 | basename(cwd)（如果 path 还有效）或 cwd 本身 |

### C. 端到端 smoke

```bash
# 1. 重启 server（schema migration + backfill 自动跑）
memweave stop && memweave start
# 日志应包含："backfill: session.project populated ... candidates=847 resolved=N errored=M"

# 2. SQL 三件套
sqlite3 ~/.memweave/data/db.sqlite <<'SQL'
SELECT project, COUNT(*) FROM sessions WHERE project IS NOT NULL
  GROUP BY project ORDER BY 2 DESC LIMIT 10;
SELECT value, COUNT(*) FROM memory_scopes WHERE key='project'
  GROUP BY value ORDER BY 2 DESC;
SELECT scopes_json, COUNT(*) FROM observations
  WHERE scopes_json LIKE '%"key":"project"%'
  GROUP BY scopes_json ORDER BY 2 DESC LIMIT 10;
SQL
# 期望：sessions 出现 memweave / harness 等项目名；新 observation 的 scopes_json value 是解析名不是 cwd 路径
```

## 发布

```
v0.7.0 batch（hard order）:

1. @mem-weave/server@0.7.0          ← 先发（schema bump，3 个 plugin 都依赖）
2. @mem-weave/opencode-plugin@0.7.0
3. packages/mavis-plugin@0.7.0      (directory)
4. packages/codex-plugin@0.7.0      (directory)

发布命令：
node scripts/publish.mjs --publish server
# 等用户 npm install -g @mem-weave/server@0.7.0 完成后，再依次发布 plugin
```

## 兼容性

| Plugin 版本 | Server 版本 | 行为 |
|---|---|---|
| v0.6.x | v0.7.0 | ✅ session.project=NULL（缺省）→ backfill 兜底回填 |
| v0.7.x | v0.6.x | ❌ 服务端 Zod reject 400（plugin 发 project 字段）—— **CHANGELOG 红字警告"先升 server"** |
| v0.7.x | v0.7.x | ✅ 正常 |

回滚路径：`npm install -g @mem-weave/server@0.6.x` —— `sessions.project` 是 nullable，旧 schema 不读就能跑。

## 不做（明确划线）

- ❌ History backfill of `memory_scopes`（28 条历史 project-scope memory 不重写）
- ❌ Injection bundler 加 scope-aware 过滤（另一 ticket）
- ❌ Spawn `git` 子进程（统一只读 `.git/config`）
- ❌ Shared `@mem-weave/plugin-shared` package（plugin 保持独立、零依赖）
- ❌ Backfill CLI flag（`--no-backfill` / `--dry-run`）
- ❌ `PATCH /api/v1/sessions/:id` 路径（session.project 冻结在 INSERT，不需要更新端点）
- ❌ Web UI 项目筛选 UI（v0.7.0 不做，留下一 ticket）
- ❌ `idx_sessions_project` 索引（session 量级小）