// v0.7.0 contract test: verify that the cascade in deriveProjectFromCwd()
// matches the server's resolveProject() in packages/server/src/util/resolve-project.ts.
//
// Cascade per spec D1:
//   1. git remote "origin" URL → last path segment
//   2. cwd basename
//   3. cwd absolute path (always returns basename if cwd non-empty)
//
// This is a 5-case smoke test that creates real temp dirs with mock
// .git/config files and calls deriveProjectFromCwd() directly. No
// network, no real repo, no spawned process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
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

function makeRepo(remote = null) {
  const dir = mkdtempSync(join(tmpdir(), 'mw-cascade-'));
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
  const dir = mkdtempSync(join(tmpdir(), 'mw-nogit-'));
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
