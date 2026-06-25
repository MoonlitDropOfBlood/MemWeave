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
    const e = this.map.get(p.replace(/\\/g, '/'));    if (!e || e.type !== 'file') throw new Error(`ENOENT: ${p}`);    return e.content ?? '';
  };
  stat = (p: string): { isFile(): boolean; isDirectory(): boolean } => {
    const e = this.map.get(p.replace(/\\/g, '/'));    if (!e) throw new Error(`ENOENT: ${p}`);    return {
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

  it('worktree (realistic): walks up to main repo .git/config to find origin', () => {
    // Real worktrees: the worktree's own <wt-name>/config has only
    // branch info, NOT [remote "origin"]. The origin URL lives in
    // the SHARED main repo .git/config. The implementation must walk
    // up via the /worktrees/ suffix to find it.
    const fs = new MockFs();
    // Worktree: .git is a FILE with `gitdir:` pointer
    fs.set('/worktree/wt-feature-xyz/.git', {
      type: 'file',
      content: 'gitdir: /home/user/projects/memweave/.git/worktrees/wt-feature-xyz\n'
    });
    // Worktree's local config — NO origin block (realistic)
    fs.set('/home/user/projects/memweave/.git/worktrees/wt-feature-xyz/config', {
      type: 'file',
      content: '[core]\n	repositoryformatversion = 0\n[branch "main"]\n	remote = origin\n	merge = refs/heads/main\n'
    });
    // Main repo's .git/config HAS the origin block
    fs.set('/home/user/projects/memweave/.git/config', {
      type: 'file',
      content: [
        '[core]',
        '	repositoryformatversion = 0',
        '[remote "origin"]',
        '	url = git@github.com:foo/memweave.git',
        '	fetch = +refs/heads/*:refs/remotes/origin/*'
      ].join('\n')
    });
    // basename of worktree is 'wt-feature-xyz' — if walk-up failed
    // we'd return that; we expect 'memweave' from the main config.
    expect(resolveProject('/worktree/wt-feature-xyz', fs.asAdapter())).toBe('memweave');
  });

  it('worktree (commondir file): follows commondir to shared gitdir', () => {
    // The canonical git way to find the shared gitdir is via a
    // `commondir` file inside the worktree's gitdir. Content is
    // either `.` (worktree IS main, rare) or a path (absolute or
    // relative to the worktree's gitdir).
    const fs = new MockFs();
    fs.set('/wt/memweave/.git', {
      type: 'file',
      content: 'gitdir: /home/user/projects/memweave/.git/worktrees/wt-y\n'
    });
    // commondir is an absolute path to the shared main gitdir
    fs.set('/home/user/projects/memweave/.git/worktrees/wt-y/commondir', {
      type: 'file',
      content: '/home/user/projects/memweave/.git/\n'
    });
    // No config at the worktree's own path
    // Main config has origin
    fs.set('/home/user/projects/memweave/.git/config', {
      type: 'file',
      content: '[remote "origin"]\n	url = https://github.com/foo/memweave.git\n'
    });
    expect(resolveProject('/wt/memweave', fs.asAdapter())).toBe('memweave');
  });

  it('本地新建 repo: .git/config 没有 [remote "origin"] → 回落到 basename', () => {
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
    // Nothing registered → all stat/readFile calls throw
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
