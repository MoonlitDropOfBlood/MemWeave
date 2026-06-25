/**
 * v0.7.0: Contract test for resolveProject().
 *
 * Cascade:
 *   1. git remote "origin" URL → last path segment
 *   2. cwd basename
 *   3. cwd absolute path
 *
 * The same matrix is exercised by the 3 plugin implementations
 * (opencode / mavis / codex). Behaviour must match across all 4.
 */
import { describe, expect, it } from 'vitest';
import { resolveProject, type FsAdapter } from '../../src/util/resolve-project.js';

interface FsEntry {
  type: 'file' | 'dir';
  content?: string;
}

class MockFs {
  private map = new Map<string, FsEntry>();
  set(p: string, e: FsEntry): void {
    this.map.set(p.replace(/\\/g, '/'), e);
  }
  readFile = (p: string): string => {
    const e = this.map.get(p.replace(/\\/g, '/'));
    if (!e || e.type !== 'file') throw new Error(`ENOENT: ${p}`);
    return e.content ?? '';
  };
  stat = (p: string): { isFile(): boolean; isDirectory(): boolean } => {
    const e = this.map.get(p.replace(/\\/g, '/'));
    if (!e) throw new Error(`ENOENT: ${p}`);
    return {
      isFile: () => e.type === 'file',
      isDirectory: () => e.type === 'dir'
    };
  };
  asAdapter(): FsAdapter {
    return { readFile: this.readFile, stat: this.stat };
  }
}

describe('resolveProject', () => {
  it('普通 repo（带 remote）: returns last segment of remote origin URL', () => {
    const fs = new MockFs();
    fs.set('/home/user/projects/memweave/.git', { type: 'dir' });
    fs.set('/home/user/projects/memweave/.git/config', {
      type: 'file',
      content: [
        '[core]',
        '	repositoryformatversion = 0',
        '[remote "origin"]',
        '	url = https://github.com/foo/memweave.git',
        '	fetch = +refs/heads/*:refs/remotes/origin/*'
      ].join('\n')
    });
    expect(resolveProject('/home/user/projects/memweave', fs.asAdapter())).toBe('memweave');
  });

  it('worktree: .git 是 file 时跳转到主 repo 的 config 读取', () => {
    const fs = new MockFs();
    // .git is a FILE in a worktree, pointing to a gitdir under the main repo
    fs.set('/worktree/memweave/.git', {
      type: 'file',
      content: 'gitdir: /home/user/projects/memweave/.git/worktrees/wt-abc\n'
    });
    fs.set('/home/user/projects/memweave/.git/worktrees/wt-abc/config', {
      type: 'file',
      content: [
        '[core]',
        '	repositoryformatversion = 0',
        '[remote "origin"]',
        '	url = git@github.com:foo/memweave.git'
      ].join('\n')
    });
    expect(resolveProject('/worktree/memweave', fs.asAdapter())).toBe('memweave');
  });

  it('本地新建 repo: .git/config 没有 [remote "origin"] 块 → 回落到 basename', () => {
    const fs = new MockFs();
    fs.set('/home/user/projects/local-only/.git', { type: 'dir' });
    fs.set('/home/user/projects/local-only/.git/config', {
      type: 'file',
      content: '[core]\n	repositoryformatversion = 0\n'
    });
    expect(resolveProject('/home/user/projects/local-only', fs.asAdapter())).toBe('local-only');
  });

  it('非 git 目录: 没有 .git → 直接返回 basename', () => {
    const fs = new MockFs();
    // No .git entry → stat throws
    expect(resolveProject('/home/user/scratch/playground', fs.asAdapter())).toBe('playground');
  });

  it('path 在 FS 上不存在: stat throws → fallback to basename if non-empty', () => {
    const fs = new MockFs();
    // Nothing registered — all stat/readFile calls throw
    expect(resolveProject('/already/deleted/project', fs.asAdapter())).toBe('project');
  });

  it('空字符串 cwd 返回空字符串', () => {
    expect(resolveProject('')).toBe('');
  });

  it('origin url 是 https 形式, .git 后缀正确去除', () => {
    const fs = new MockFs();
    fs.set('/x/memweave/.git', { type: 'dir' });
    fs.set('/x/memweave/.git/config', {
      type: 'file',
      content: '[remote "origin"]\n	url = https://github.com/foo/memweave.git\n'
    });
    expect(resolveProject('/x/memweave', fs.asAdapter())).toBe('memweave');
  });
});
