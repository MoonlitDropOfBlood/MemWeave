/**
 * v0.7.0: Contract test for backfillSessionProjects().
 *
 * Backfill scope: only sessions that have at least one observation with
 * `{ key: 'project', value: <cwd> }` in scopes_json. Sessions whose
 * observations are all pre-v0.5.4 (scopes_json='[]') are left untouched.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/database.js';
import { openDatabase } from '../../src/db/database.js';
import { backfillSessionProjects } from '../../src/db/backfill-project.js';
import { SessionRepo } from '../../src/db/repositories/session-repo.js';

let db: Db;
let sessionRepo: SessionRepo;

function makeSessionAndObs(
  scopesJson: string
): { sessionId: string; obsId: string } {
  const s = sessionRepo.create({
    tenantId: 'tenant_default',
    deviceId: null,
    source: 'opencode',
    title: 's',
    project: null
  });
  const obsId = `obs-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO observations (id, session_id, tenant_id, hook_type, tool_name, tool_input, tool_output, timestamp, memory_id, processed, scopes_json)
    VALUES (?, ?, 'tenant_default', 'post_tool_use', 'Bash', NULL, NULL, ?, NULL, 0, ?)
  `).run(obsId, s.id, Date.now(), scopesJson);
  return { sessionId: s.id, obsId };
}

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-backfill-'));
  db = openDatabase(join(dir, 'test.db'));
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  sessionRepo = new SessionRepo(db);
});

afterEach(() => db.close());

describe('backfillSessionProjects', () => {
  it('成功回填: session 有 project scope 观测 → session.project 被填上', () => {
    // 模拟一个真实仓库场景: cwd 是个 git repo with origin url
    // 简化: 直接用没有 .git 的 path 触发 basename fallback
    const { sessionId } = makeSessionAndObs(
      JSON.stringify([{ key: 'project', value: '/home/user/projects/my-app' }])
    );
    // Pre-condition
    expect(
      (db.prepare('SELECT project FROM sessions WHERE id = ?').get(sessionId) as { project: string | null }).project
    ).toBeNull();

    backfillSessionProjects(db);

    const row = db.prepare('SELECT project FROM sessions WHERE id = ?').get(sessionId) as { project: string | null };
    expect(row.project).toBe('my-app');
  });

  it('跳过无 scope 的 session: 全部观测 scopes_json="[]" → project 仍为 NULL', () => {
    const { sessionId } = makeSessionAndObs('[]');
    backfillSessionProjects(db);
    const row = db.prepare('SELECT project FROM sessions WHERE id = ?').get(sessionId) as { project: string | null };
    expect(row.project).toBeNull();
  });

  it('幂等: 第二次跑不动任何 UPDATE (因为 WHERE project IS NULL 守卫)', () => {
    const { sessionId } = makeSessionAndObs(
      JSON.stringify([{ key: 'project', value: '/home/user/projects/idem' }])
    );
    backfillSessionProjects(db);
    const first = (db.prepare('SELECT project FROM sessions WHERE id = ?').get(sessionId) as { project: string }).project;
    expect(first).toBe('idem');

    // Run again — no session has project IS NULL anymore
    backfillSessionProjects(db);
    const second = (db.prepare('SELECT project FROM sessions WHERE id = ?').get(sessionId) as { project: string }).project;
    expect(second).toBe('idem');
  });

  it('容错: scopes_json 损坏 (非 JSON) → 跳过该 session, 不抛错', () => {
    const { sessionId } = makeSessionAndObs('not-json{[}');
    // Should not throw
    expect(() => backfillSessionProjects(db)).not.toThrow();
    const row = db.prepare('SELECT project FROM sessions WHERE id = ?').get(sessionId) as { project: string | null };
    expect(row.project).toBeNull();
  });

  it('backfill 解析非 git cwd: 走 basename fallback 拿到目录名', () => {
    // The worktree-specific .git-file branch in resolveProject is covered
    // by the dedicated tests/util/resolve-project.test.ts contract suite.
    // Here we just verify backfill passes the cwd through resolveProject
    // and writes the resolved name to sessions.project — picking a non-git
    // path exercises the basename fallback.
    const { sessionId } = makeSessionAndObs(
      JSON.stringify([{ key: 'project', value: '/repos/awesome-tool' }])
    );
    backfillSessionProjects(db);
    const row = db.prepare('SELECT project FROM sessions WHERE id = ?').get(sessionId) as { project: string | null };
    expect(row.project).toBe('awesome-tool');
  });

  it('回填只跑一次: candidates.length = 0 时直接 return', () => {
    // No observations at all — no candidates
    sessionRepo.create({
      tenantId: 'tenant_default',
      deviceId: null,
      source: 'opencode',
      title: 'lonely',
      project: null
    });
    // Should not throw, should not log anything
    expect(() => backfillSessionProjects(db)).not.toThrow();
  });
});
