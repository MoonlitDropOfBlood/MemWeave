// MemWeave zcode plugin -- shared library for hook scripts.
//
// Adapted from the Codex plugin's _lib.mjs. Cross-platform Node, no native
// deps. Every helper returns undefined on failure so a MemWeave outage never
// breaks the zcode agent (fail-silent contract).
//
// zcode hooks are Claude-Code-style: the host sends a JSON event on stdin
// (fields: session_id, hook_event_name, cwd, transcript_path, tool_name,
// tool_input, ...), and the hook can emit a JSON object on stdout to inject
// context or control behavior.

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
 * Derive a session id from the zcode hook event. zcode uses snake_case
 * (session_id, cwd, hook_event_name). Fall back to a stable hash of cwd
 * so a missing session_id never produces an empty string.
 */
export function deriveSessionId(event) {
  if (event.session_id) return String(event.session_id);
  if (event.sessionId) return String(event.sessionId);
  if (event.sessionID) return String(event.sessionID);
  const cwd = event.cwd || process.cwd();
  return `zcode-${createHash('sha256').update(cwd).digest('hex').slice(0, 16)}`;
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
 * POST /api/v1/inject. Returns the response body (with contextXml) or
 * undefined on any failure. SessionStart hooks use this to prepend a
 * memory summary + <about-user> to the agent's context.
 */
export async function requestInjection({ sessionId, phase }) {
  return postJson('/api/v1/inject', { sessionId, phase });
}

export async function reportSession({ sessionId, source, title, deviceId }) {
  return postJson('/api/v1/sessions', { sessionId, source, title, deviceId });
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
 * Build a deterministic messageId from (sessionId, role, content) so retries
 * collapse to the same observation row server-side. The server's idempotency
 * is on (sessionId, messageId).
 */
export function makeMessageId(sessionId, role, content) {
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
  return `zcode-${sessionId}-${role}-${hash}`;
}

/**
 * Emit a zcode hook output JSON line to stdout. zcode (Claude-Code-style)
 * reads stdout JSON for context injection / control. For a write-only hook
 * (Stop), emitting { continue: true } lets the agent proceed normally.
 */
export function emitHookOutput(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}
