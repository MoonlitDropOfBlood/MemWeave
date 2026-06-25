/**
 * v0.7.0: Resolve a project name from a working directory.
 *
 * Cascade (per design spec D1 — same as server-side `resolveProject`):
 *   1. git remote "origin" URL → last path segment (e.g.
 *      `git@github.com:foo/memweave.git` → `memweave`,
 *      `https://github.com/foo/memweave.git` → `memweave`)
 *   2. cwd basename
 *   3. cwd absolute path
 *
 * This function is the opencode-plugin-side twin of
 * `packages/server/src/util/resolve-project.ts`. Behaviour is bound
 * together by the shared contract test matrix. Differences:
 *
 *   - **No FsAdapter injection**: the plugin runs in the user's
 *     process, so we read the real FS. Tests use a temporary
 *     directory created via `mkdtempSync` to stay hermetic.
 *   - **Pure fs, no `git` subprocess spawn** (per spec D6): we read
 *     `.git/config` directly. For worktrees, we follow the `gitdir`
 *     pointer and walk up to the main repo's `.git/config` (or read
 *     the `commondir` file git itself uses) so the `[remote "origin"]`
 *     block — which lives in the SHARED config, not the worktree's
 *     own config — is found correctly.
 *
 * Returns an empty string when `cwd` is empty (so callers can
 * branch on `deriveProject(cwd) ? ... : ...`).
 */
import { readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';

export function deriveProject(cwd: string): string {
  if (!cwd) return '';
  const config = readGitConfig(cwd);
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

function readGitConfig(cwd: string): string | null {
  const gitPath = join(cwd, '.git');
  let stat;
  try {
    stat = statSync(gitPath);
  } catch {
    return null;
  }

  let configPath: string;
  if (stat.isFile()) {
    // worktree: `.git` is a file pointing to a gitdir under the main repo
    let content: string;
    try {
      content = readFileSync(gitPath, 'utf8');
    } catch {
      return null;
    }
    const m = content.match(/gitdir:\s*(.+)/);
    if (!m) return null;
    configPath = resolveConfigPathFromGitdir(m[1]!.trim());
  } else if (stat.isDirectory()) {
    configPath = join(gitPath, 'config');
  } else {
    return null;
  }

  try {
    return readFileSync(configPath, 'utf8');
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
 *   3. Otherwise, fall back to `<gitdir>/config` (best-effort).
 */
function resolveConfigPathFromGitdir(gitdir: string): string {
  // 1. Try the commondir file (canonical git way to find shared gitdir).
  try {
    const raw = readFileSync(join(gitdir, 'commondir'), 'utf8');
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
  // Split on both / and : (the `:` appears in scp-style URLs like git@github.com:user/repo)
  const parts = cleaned.split(/[/:]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : '';
}
