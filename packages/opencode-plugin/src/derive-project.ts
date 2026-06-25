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
 * together by the shared contract test matrix (5 cases). Differences:
 *
 *   - **No FsAdapter injection**: the plugin runs in the user's
 *     process, so we can read the real FS. Tests use a temporary
 *     directory created via `mkdtempSync` to stay hermetic.
 *   - **Pure fs, no `git` subprocess spawn** (per spec D6): we read
 *     `.git/config` (or worktree `.git` gitdir pointer → main
 *     repo's `.git/worktrees/<wt>/config`) directly.
 *
 * Returns an empty string when `cwd` is empty (so callers can
 * branch on `deriveProject(cwd) ? ... : ...`).
 */
import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

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
  try {
    const stat = statSync(gitPath);
    let configPath: string;
    if (stat.isFile()) {
      // worktree: `.git` is a file pointing to gitdir under the main repo
      const content = readFileSync(gitPath, 'utf8');
      const m = content.match(/gitdir:\s*(.+)/);
      if (!m) return null;
      configPath = join(dirname(m[1]!.trim()), 'config');
    } else if (stat.isDirectory()) {
      configPath = join(gitPath, 'config');
    } else {
      return null;
    }
    return readFileSync(configPath, 'utf8');
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
