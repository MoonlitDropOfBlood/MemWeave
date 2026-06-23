// MemWeave Codex plugin -- shared library for hook scripts.
//
// Cross-platform Node, no native deps. Imported by prompt-inject.mjs,
// file-pack.mjs, and writeback.mjs so HTTP plumbing lives in one place.
//
// Convention: every helper returns `undefined` on any failure (network
// error, parse error, missing field). Hook scripts use this to stay
// fail-silent -- a MemWeave outage must never break the Codex agent.

import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
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

export function deriveProjectScope(event) {
  return deriveCwd(event);
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

export async function reportSession({ sessionId, source, title, deviceId }) {
  return postJson('/api/v1/sessions', {
    sessionId,
    source,
    title,
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
