// v0.7.0 contract test: verify that the cascade in deriveProjectFromCwd()
// matches the server's resolveProject() in packages/server/src/util/resolve-project.ts.
//
// Cascade per spec D1:
//   1. git remote "origin" URL → last path segment
//   2. cwd basename
//   3. cwd absolute path (always returns basename if cwd non-empty)
//
// 7-case test matrix (cases 1-5: basic cascade; cases 6-7: worktree
// walk-up). Real temp dirs via `mkdtempSync` — no network, no real
// repo, no spawned process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import { tmpdir } from 'node:os';

const REMOTE_CONFIG = [
  '[core]',
  '\trepositoryformatversion = 0',
  '[remote "origin"]',
  '\turl = https://github.com/foo/memweave.git',
  '\tfetch = +refs/heads/*:refs/remotes/origin/*',
].join('\n');

const NO_REMOTE_CONFIG = [
  '[core]',
  '\trepositoryformatversion = 0',
].join('\n');

const WORKTREE_LOCAL_CONFIG = [
  '[core]',
  '\trepositoryformatversion = 0',
  '[branch "main"]',
  '\tremote = origin',
  '\tmerge = refs/heads/main',
].join('\n');

function makeRepo(remote = null) {
  const dir = mkdtempSync(join(tmpdir(), 'codex-cascade-'));
  mkdirSync(join(dir, '.git'));
  writeFileSync(
    join(dir, '.git', 'config'),
    remote === null ? NO_REMOTE_CONFIG : REMOTE_CONFIG
  );
  return dir;
}

const { deriveProjectFromCwd } = await import('../hooks/_lib.mjs');

test('cascade case 1: 普通 repo 带 origin remote → last segment', () => {
  const dir = makeRepo('origin');
  try {
    assert.equal(deriveProjectFromCwd(dir), 'memweave');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cascade case 2: 本地新建 repo 没有 remote → fallback to basename', () => {
  const dir = makeRepo(null);
  try {
    assert.equal(deriveProjectFromCwd(dir), basename(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cascade case 3: 非 git 目录 (没有 .git) → fallback to basename', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-nogit-'));
  try {
    assert.equal(deriveProjectFromCwd(dir), basename(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cascade case 4: path 在 FS 上不存在 (stat throws) → fallback to basename', () => {
  assert.equal(deriveProjectFromCwd('/already/deleted/project'), 'project');
});

test('cascade case 5: 空字符串 cwd 返回空字符串', () => {
  assert.equal(deriveProjectFromCwd(''), '');
});

test('cascade case 6: worktree walks up to main repo .git/config (realistic)', () => {
  // Real worktree: the worktree's own <wt-name>/config has only
  // branch info, NOT [remote "origin"]. The origin URL lives in the
  // SHARED main repo .git/config. deriveProjectFromCwd must walk
  // up via the /worktrees/ suffix to find it.
  const tmpRoot = mkdtempSync(join(tmpdir(), 'codex-wt-'));
  try {
    const mainRepo = join(tmpRoot, 'main', 'memweave');
    mkdirSync(join(mainRepo, '.git'), { recursive: true });
    writeFileSync(join(mainRepo, '.git', 'config'), REMOTE_CONFIG);

    // Worktree basename differs from main repo name (realistic)
    const wt = join(tmpRoot, 'wt', 'wt-feature-xyz');
    mkdirSync(wt, { recursive: true });
    const gitdirPath = join(mainRepo, '.git', 'worktrees', 'wt-feature-xyz');
    mkdirSync(gitdirPath, { recursive: true });
    // Worktree's local config — NO origin (realistic)
    writeFileSync(join(gitdirPath, 'config'), WORKTREE_LOCAL_CONFIG);
    // .git is a file pointing to the worktree's gitdir
    writeFileSync(join(wt, '.git'), `gitdir: ${gitdirPath}\n`);

    assert.equal(deriveProjectFromCwd(wt), 'memweave');
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('cascade case 7: worktree follows commondir file to shared gitdir', () => {
  // The canonical git way: a `commondir` file inside the worktree's
  // gitdir contains either `.` (worktree IS main, rare) or a path
  // (absolute or relative to the worktree's gitdir) to the shared
  // gitdir. Content can be absolute OR relative.
  const tmpRoot = mkdtempSync(join(tmpdir(), 'codex-wt-common-'));
  try {
    const mainRepo = join(tmpRoot, 'main', 'memweave');
    mkdirSync(join(mainRepo, '.git'), { recursive: true });
    writeFileSync(join(mainRepo, '.git', 'config'), REMOTE_CONFIG);

    const wt = join(tmpRoot, 'wt', 'memweave');
    mkdirSync(wt, { recursive: true });
    const gitdirPath = join(mainRepo, '.git', 'worktrees', 'wt-y');
    mkdirSync(gitdirPath, { recursive: true });
    // commondir with an absolute path to the shared main gitdir
    writeFileSync(join(gitdirPath, 'commondir'), join(mainRepo, '.git') + sep + '\n');
    writeFileSync(join(wt, '.git'), `gitdir: ${gitdirPath}\n`);

    assert.equal(deriveProjectFromCwd(wt), 'memweave');
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});
