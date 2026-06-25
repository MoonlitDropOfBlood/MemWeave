/**
 * v0.7.0: Contract test for deriveProject().
 *
 * Cascade (mirrors server-side resolveProject):
 *   1. git remote "origin" URL → last path segment
 *   2. cwd basename
 *   3. cwd absolute path
 *
 * The same matrix is exercised by:
 *   - packages/server/tests/util/resolve-project.test.ts (server)
 *   - packages/opencode-plugin/src/derive-project.test.ts (this file)
 *   - packages/mavis-plugin tests (mavis)
 *   - packages/codex-plugin tests (codex)
 *
 * Behaviour must match across all 4 implementations. We use real
 * FS via `mkdtempSync` (no `memfs` dep — the plugin keeps zero
 * runtime deps, and the test runner is the same as the rest of the
 * repo).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveProject } from './derive-project.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'memweave-derive-project-'));
});

afterEach(() => {
  // Best-effort cleanup; test runs in a tmp dir so failures are harmless.
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* noop */ }
});

function writeGitConfig(repoPath: string, configBody: string): void {
  mkdirSync(join(repoPath, '.git'), { recursive: true });
  writeFileSync(join(repoPath, '.git', 'config'), configBody);
}

describe('deriveProject', () => {
  it('普通 repo（带 remote）: 返回 remote origin URL 的最后一段', () => {
    const repo = join(tmpRoot, 'memweave');
    mkdirSync(repo, { recursive: true });
    writeGitConfig(repo, [
      '[core]',
      '	repositoryformatversion = 0',
      '[remote "origin"]',
      '	url = https://github.com/foo/memweave.git',
      '	fetch = +refs/heads/*:refs/remotes/origin/*'
    ].join('\n'));
    expect(deriveProject(repo)).toBe('memweave');
  });

  it('worktree (realistic): walks up to main repo .git/config to find origin', () => {
    // Real worktree scenario: the worktree's <wt-name>/config only
    // has branch info, NOT [remote "origin"]. The origin URL lives
    // in the SHARED main repo .git/config. deriveProject must walk
    // up via the /worktrees/ suffix to find it.
    const mainRepo = join(tmpRoot, 'main', 'memweave');
    mkdirSync(mainRepo, { recursive: true });
    writeGitConfig(mainRepo, [
      '[core]',
      '	repositoryformatversion = 0',
      '[remote "origin"]',
      '	url = git@github.com:foo/memweave.git',
      '	fetch = +refs/heads/*:refs/remotes/origin/*'
    ].join('\n'));

    // Worktree basename differs from main repo name (realistic)
    const wt = join(tmpRoot, 'worktree', 'wt-feature-xyz');
    mkdirSync(wt, { recursive: true });
    const gitdirPath = join(mainRepo, '.git', 'worktrees', 'wt-feature-xyz');
    mkdirSync(gitdirPath, { recursive: true });
    // Worktree's local config — NO origin (realistic)
    writeFileSync(join(gitdirPath, 'config'), [
      '[core]',
      '	repositoryformatversion = 0',
      '[branch "main"]',
      '	remote = origin',
      '	merge = refs/heads/main'
    ].join('\n'));
    // .git file in worktree
    writeFileSync(join(wt, '.git'), `gitdir: ${gitdirPath}\n`);

    expect(deriveProject(wt)).toBe('memweave');
  });

  it('worktree (commondir file): follows commondir to shared gitdir', () => {
    // The canonical git way to find the shared gitdir is via a
    // `commondir` file inside the worktree's gitdir. The content is
    // either `.` (worktree IS the main, rare) or a path to the
    // shared gitdir (absolute or relative to the worktree's gitdir).
    const mainRepo = join(tmpRoot, 'main', 'memweave');
    mkdirSync(mainRepo, { recursive: true });
    writeGitConfig(mainRepo, '[remote "origin"]\n	url = https://github.com/foo/memweave.git\n');

    const wt = join(tmpRoot, 'wt', 'memweave');
    mkdirSync(wt, { recursive: true });
    const gitdirPath = join(mainRepo, '.git', 'worktrees', 'wt-y');
    mkdirSync(gitdirPath, { recursive: true });
    // commondir file with absolute path to shared main gitdir
    writeFileSync(join(gitdirPath, 'commondir'), join(mainRepo, '.git') + '\n');
    writeFileSync(join(wt, '.git'), `gitdir: ${gitdirPath}\n`);

    expect(deriveProject(wt)).toBe('memweave');
  });

  it('本地新建 repo: .git/config 没有 [remote "origin"] 块 → 回落到 basename', () => {
    const repo = join(tmpRoot, 'local-only');
    mkdirSync(repo, { recursive: true });
    writeGitConfig(repo, '[core]\n	repositoryformatversion = 0\n');
    expect(deriveProject(repo)).toBe('local-only');
  });

  it('非 git 目录: 没有 .git → 直接返回 basename', () => {
    const scratch = join(tmpRoot, 'playground');
    mkdirSync(scratch, { recursive: true });
    // No .git entry
    expect(deriveProject(scratch)).toBe('playground');
  });

  it('path 在 FS 上不存在: stat throws → fallback to basename if non-empty', () => {
    // No directory created — path doesn't exist on FS
    const ghost = join(tmpRoot, 'project');
    // The ghost path itself is not basename-resolvable to 'project' on
    // all platforms (basename of absolute paths works), but since
    // <tmpRoot>/project does not exist, statSync will throw and the
    // function should fall back to basename(<tmpRoot>/project) which
    // is 'project'.
    expect(deriveProject(ghost)).toBe('project');
  });

  it('空字符串 cwd 返回空字符串', () => {
    expect(deriveProject('')).toBe('');
  });

  it('origin url 是 https 形式, .git 后缀正确去除', () => {
    const repo = join(tmpRoot, 'memweave');
    mkdirSync(repo, { recursive: true });
    writeGitConfig(repo, '[remote "origin"]\n	url = https://github.com/foo/memweave.git\n');
    expect(deriveProject(repo)).toBe('memweave');
  });

  it('origin url 是 scp 形式 (git@host:user/repo.git) 也能正确取最后一段', () => {
    const repo = join(tmpRoot, 'memweave');
    mkdirSync(repo, { recursive: true });
    writeGitConfig(repo, '[remote "origin"]\n	url = git@github.com:foo/memweave.git\n');
    expect(deriveProject(repo)).toBe('memweave');
  });
});
