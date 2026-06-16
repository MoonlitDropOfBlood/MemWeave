#!/usr/bin/env node
// MemWeave Codex plugin -- Stop hook (cross-platform, no native deps)
//
// Reads a JSON event from stdin (Codex Stop event) and POSTs the
// session + last assistant message to the MemWeave server.
// Idempotent on (sessionId, messageId), so retries collapse to one
// row server-side.
//
// Communicates back to Codex via stdout JSON: { "continue": true }.
//
// This is the canonical implementation; the .sh / .cmd wrappers
// delegate here so the actual logic is identical on every platform.

import http from 'node:http';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';

const SERVER_URL = process.env.MEMWEAVE_SERVER_URL || 'http://127.0.0.1:3131';
const TENANT = process.env.MEMWEAVE_TENANT || 'tenant_default';

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', () => resolve(buf));
  });
}

function postJson(path, body) {
  return new Promise((resolve) => {
    try {
      const u = new URL(path, SERVER_URL);
      const data = JSON.stringify(body);
      const req = http.request(
        {
          hostname: u.hostname,
          port: u.port || 80,
          path: u.pathname + u.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
          },
          timeout: 10000,
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve());
        }
      );
      req.on('error', () => resolve()); // never fail-fast
      req.on('timeout', () => { req.destroy(); resolve(); });
      req.write(data);
      req.end();
    } catch {
      resolve();
    }
  });
}

const raw = await readStdin();
let event = {};
try { event = JSON.parse(raw); } catch { event = {}; }

const sessionId = event.session_id || event.sessionId ||
  `codex-${createHash('sha256')
    .update(event.cwd || process.cwd())
    .digest('hex')
    .slice(0, 16)}`;

const lastAssistant = event.last_assistant_message || event.lastAssistantMessage || '';
const turnId = event.turn_id || event.turnId || '0';
const transcriptPath = event.transcript_path || event.transcriptPath || null;
const cwd = event.cwd || null;

// 1. Upsert session (idempotent on sessionId)
// The server requires `title` (Zod schema) and `source` (must be one of
// the enum values: 'opencode' | 'cursor' | 'claude_code' | 'codex' | 'rest_api').
// We use a stable, short title so retries collapse to the same row.
const sessionTitle = (lastAssistant || `Codex session in ${cwd || 'unknown cwd'}`).slice(0, 80).replace(/\s+/g, ' ');
await postJson('/api/v1/sessions', {
  sessionId,
  source: 'codex',
  title: sessionTitle,
});

// 2. Write the assistant message as an observation (idempotent on msgId)
if (lastAssistant) {
  const hash = createHash('sha256').update(lastAssistant).digest('hex').slice(0, 16);
  const messageId = `codex-${sessionId}-turn-${turnId}-${hash}`;
  await postJson('/api/v1/observations', {
    sessionId,
    messageId,
    hookType: 'chat.assistant',
    text: lastAssistant,
  });
}

// Tell Codex: continue normally. We never block the Stop event.
process.stdout.write(JSON.stringify({ continue: true, suppress_output: true }) + '\n');
process.exit(0);
