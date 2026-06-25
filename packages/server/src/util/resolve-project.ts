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
 * matrix in `tests/util/resolve-project.test.ts`.
 *
 * Pure FS, no `git` subprocess spawn (per spec D6).
 *
 * v0.7.1: For worktree-style repos (`.git` is a FILE pointing to a
 * `gitdir: <path>` line), the previous implementation read
 * `dirname(<gitdir>)/config` which is wrong on real worktrees:
 *   - The gitdir is `<main>/.git/worktrees/<wt-name>/` and its
 *     `<wt-name>/config` only has worktree-specific settings (branch
 *     info) — it does NOT have `[remote "origin"]`.
 *   - The origin URL lives in the SHARED `<main>/.git/config`.
 * The fix walks up to the main gitdir (or follows the `commondir`
 * file git itself uses) before reading `config`. Falls back to the
 * worktree's local config if the walk-up fails (e.g. broken gitdir).
 */
import { readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';

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
      // worktree: .git is a file pointing to a gitdir under the main repo
      const content = fs.readFile(gitPath);
      const m = content.match(/gitdir:\s*(.+)/);
      if (!m) return null;
      configPath = resolveConfigPathFromGitdir(m[1]!.trim(), fs);
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

/**
 * Given a worktree's gitdir path (e.g. `.../main/.git/worktrees/wt-xxx`),
 * return the path to the config file that holds the shared `[remote
 * "origin"]` block.
 *
 * Strategy (matches git's own config resolution):
 *   1. Read `<gitdir>/commondir` (a file containing either `.` or a
 *      path to the shared gitdir). Resolve relative paths against the
 *      gitdir. Use `<resolved>/config`.
 *   2. Otherwise, if `gitdir` contains `/worktrees/`, strip the
 *      `/worktrees/<wt-name>` suffix to recover the main gitdir and
 *      use its `config`.
 *   3. Otherwise, fall back to `<gitdir>/config` (the worktree's own
 *      config, which usually only has branch info — best-effort).
 */
function resolveConfigPathFromGitdir(gitdir: string, fs: FsAdapter): string {
  // 1. Try the commondir file (canonical git way to find shared gitdir).
  try {
    const raw = fs.readFile(join(gitdir, 'commondir'));
    const trimmed = raw.trim();
    if (trimmed) {
      const resolved = isAbsolute(trimmed) ? trimmed : resolve(gitdir, trimmed);
      return join(resolved, 'config');
    }
  } catch {
    /* no commondir file — fall through */
  }

  // 2. Walk up: if gitdir path contains `/worktrees/`, strip the
  //    suffix to recover the main gitdir. Normalize separators first
  //    so the search is correct on Windows. Pass the forward-slash
  //    prefix to join() — Node's path.join normalizes on Windows.
  const normalized = gitdir.replace(/\\/g, '/').replace(/\/+$/, '');
  const wtIdx = normalized.lastIndexOf('/worktrees/');
  if (wtIdx !== -1) {
    return join(normalized.slice(0, wtIdx), 'config');
  }

  // 3. Best-effort: the worktree's own config.
  return join(gitdir, 'config');
}

function extractOriginUrl(gitConfig: string): string | null {
  const re = /\[remote\s+"origin"\][^\[]*?url\s*=\s*([^\s\n]+)/;
  const m = gitConfig.match(re);
  return m ? m[1]!.trim() : null;
}

function lastSegment(url: string): string {
  const cleaned = url.replace(/\.git$/, '');
  // Split on both / and : (the `:` appears in scp-style URLs like
  // git@github.com:user/repo)
  const parts = cleaned.split(/[/:]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : '';
}
