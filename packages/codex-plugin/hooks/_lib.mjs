// MemWeave Codex plugin -- shared library for hook scripts.
//
// Cross-platform Node, no native deps. Imported by prompt-inject.mjs,
// file-pack.mjs, and stop.mjs so HTTP plumbing lives in one place.
//
// Convention: every helper returns `undefined` on any failure (network
// error, parse error, missing field). Hook scripts use this to stay
// fail-silent -- a MemWeave outage must never break the Codex agent.

import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { URL } from 'node:url';

export const SERVER_URL =
  process.env.MEMWEAVE_SERVER_URL || 'http://127.0.0.1:3131';
export const TENANT = process.env.MEMWEAVE_TENANT || 'tenant_default';

export function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', () => resolve(buf));
  });
}

export function parseEvent(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Derive a session id from the Codex hook event. Codex's CC-style
 * hook format uses snake_case, but we tolerate camelCase variants +
 * a stable hash of cwd so a missing session_id never produces an
 * empty string.
 */
export function deriveSessionId(event) {
  if (event.session_id) return String(event.session_id);
  if (event.sessionId) return String(event.sessionId);
  if (event.sessionID) return String(event.sessionID);
  const cwd = event.cwd || process.cwd();
  return `codex-${createHash('sha256').update(cwd).digest('hex').slice(0, 16)}`;
}

export function deriveCwd(event) {
  if (event.cwd) return String(event.cwd);
  try {
    return process.cwd();
  } catch {
    return '';
  }
}

/**
 * v0.7.0: Resolve a project name from a working directory.
 *
 * Cascade (mirrors `packages/server/src/util/resolve-project.ts` per
 * the design spec D1; same behaviour across all 4 implementations --
 * the 3 plugin hook scripts + the server-side backfill helper):
 *   1. git remote "origin" URL → last path segment
 *      (e.g. `git@github.com:foo/memweave.git` → `memweave`)
 *   2. cwd basename
 *   3. cwd absolute path
 *
 * Pure FS, no `git` subprocess spawn (per D6). Any FS read failure
 * (missing .git, unreadable config, worktree with dangling gitdir)
 * is caught and falls through to basename. Returns '' only for an
 * empty cwd -- the upstream call site should treat that as
 * "unknown project" and skip the scope.
 */
export function deriveProjectFromCwd(cwd) {
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

function readGitConfig(cwd) {
  const gitPath = join(cwd, '.git');
  let stat;
  try {
    stat = statSync(gitPath);
  } catch {
    return null;
  }
  let configPath;
  if (stat.isFile()) {
    // worktree: .git is a file pointing to a gitdir under the main repo
    let content;
    try {
      content = readFileSync(gitPath, 'utf8');
    } catch {
      return null;
    }
    const m = content.match(/gitdir:\s*(.+)/);
    if (!m) return null;
    configPath = resolveConfigPathFromGitdir(m[1].trim());
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
 * "origin"]` block. Real worktree configs only contain branch info —
 * the origin URL lives in the main repo's shared config.
 *
 * Strategy (matches git's own config resolution):
 *   1. Read `<gitdir>/commondir` (a file containing either `.` or a
 *      path to the shared gitdir). Resolve relative paths against the
 *      gitdir. Use `<resolved>/config`.
 *   2. Otherwise, if `gitdir` contains `/worktrees/`, strip the
 *      `/worktrees/<wt-name>` suffix to recover the main gitdir.
 *   3. Otherwise, fall back to `<gitdir>/config` (best-effort).
 */
function resolveConfigPathFromGitdir(gitdir) {
  // 1. Try the commondir file (canonical git way).
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

  // 2. Walk up if gitdir contains /worktrees/. Normalize separators
  //    first so the search is correct on Windows; pass the
  //    forward-slash prefix to join() — path.join normalizes on Windows.
  const normalized = gitdir.replace(/\\/g, '/').replace(/\/+$/, '');
  const wtIdx = normalized.lastIndexOf('/worktrees/');
  if (wtIdx !== -1) {
    return join(normalized.slice(0, wtIdx), 'config');
  }

  // 3. Best-effort: the worktree's own config.
  return join(gitdir, 'config');
}

function extractOriginUrl(gitConfig) {
  const re = /\[remote\s+"origin"\][^\[]*?url\s*=\s*([^\s\n]+)/;
  const m = gitConfig.match(re);
  return m ? m[1].trim() : null;
}

function lastSegment(url) {
  const cleaned = url.replace(/\.git$/, '');
  // Split on both / and : (the `:` appears in scp-style URLs like git@github.com:user/repo)
  const parts = cleaned.split(/[/:]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

export function deriveProjectScope(event) {
  return deriveProjectFromCwd(deriveCwd(event));
}

export function deriveScopes(event) {
  const project = deriveProjectScope(event);
  return project ? [{ key: 'project', value: project }] : [];
}

export function postJson(path, body, timeoutMs = 10000) {
  return new Promise((resolve) => {
    try {
      const u = new URL(path, SERVER_URL);
      const lib = u.protocol === 'https:' ? https : http;
      const data = JSON.stringify(body);
      const req = lib.request(
        {
          hostname: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: u.pathname + u.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
          },
          timeout: timeoutMs,
        },
        (res) => {
          let chunks = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (chunks += c));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(JSON.parse(chunks));
              } catch {
                resolve({});
              }
            } else {
              resolve(undefined);
            }
          });
        }
      );
      req.on('error', () => resolve(undefined));
      req.on('timeout', () => {
        req.destroy();
        resolve(undefined);
      });
      req.write(data);
      req.end();
    } catch {
      resolve(undefined);
    }
  });
}

/**
 * POST /api/v1/inject. Returns the response body or undefined on
 * any failure. Hooks should treat undefined as "skip injection,
 * agent continues normally".
 */
export async function requestInjection({
  sessionId,
  phase,
  query,
  files,
  alreadyInjected = [],
}) {
  return postJson('/api/v1/inject', {
    sessionId,
    phase,
    query,
    files,
    alreadyInjected,
  });
}

export async function reportSession({ sessionId, source, title, project, deviceId }) {
  return postJson('/api/v1/sessions', {
    sessionId,
    source,
    title,
    project,
    deviceId,
  });
}

export async function reportObservation({
  sessionId,
  messageId,
  hookType,
  text,
  scopes = [],
  toolName,
  toolInput,
  toolOutput,
}) {
  return postJson('/api/v1/observations', {
    sessionId,
    messageId,
    hookType,
    text,
    scopes,
    toolName,
    toolInput,
    toolOutput,
  });
}

/**
 * Build a deterministic messageId from (sessionId, role, content) so
 * retries + the Stop hook's `last_assistant_message` field collapse
 * to the same observation row server-side. The server's idempotency
 * is on (sessionId, messageId), so the same content must produce the
 * same id every time.
 */
export function makeMessageId(sessionId, role, content) {
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
  return `codex-${sessionId}-${role}-${hash}`;
}

/**
 * Extract file paths from a Codex tool_input. Codex's hook format
 * matches the opencode-plugin's key set: filePath, file_path, path,
 * file, pattern.
 */
export function extractFilePaths(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return [];
  const KEYS = ['filePath', 'file_path', 'path', 'file', 'pattern'];
  const out = [];
  for (const k of KEYS) {
    const v = toolInput[k];
    if (typeof v === 'string' && v.length > 0) out.push(v);
  }
  return out;
}

/**
 * Write a Codex hook output JSON line to stdout. Codex reads the
 * LAST line of stdout as the hook output, so this is safe to call
 * for any hook.
 */
export function emitHookOutput(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}
