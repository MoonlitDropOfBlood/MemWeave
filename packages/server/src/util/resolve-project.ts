/**
 * v0.7.0: Resolve a project name from a working directory.
 *
 * Cascade (per design spec D1):
 *   1. git remote "origin" URL → last path segment (e.g. `git@github.com:foo/memweave.git` → `memweave`)
 *   2. cwd basename
 *   3. cwd absolute path
 *
 * Contract: the three plugins (opencode / mavis / codex) implement the
 * same cascade. The behaviour is bound together by the shared test
 * matrix (5 cases) in `tests/util/resolve-project.test.ts`.
 *
 * Pure FS, no `git` subprocess spawn (per spec D6).
 */
import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export interface FsAdapter {
  readFile: (p: string) => string;
  stat: (p: string) => { isFile(): boolean; isDirectory(): boolean };
}

const defaultFs: FsAdapter = {
  readFile: (p) => readFileSync(p, 'utf8'),
  stat: (p) => statSync(p)
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
      configPath = join(dirname(m[1]!.trim()), 'config');
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
  return m ? m[1]!.trim() : null;
}

function lastSegment(url: string): string {
  const cleaned = url.replace(/\.git$/, '');
  // Split on both / and : (the `:` appears in scp-style URLs like git@github.com:user/repo)
  const parts = cleaned.split(/[/:]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : '';
}
