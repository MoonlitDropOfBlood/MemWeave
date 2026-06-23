#!/usr/bin/env node
// MemWeave Codex plugin -- Stop hook (cross-platform, no native deps).
//
// Reads a JSON event from stdin (Codex Stop event) and POSTs the
// session + last assistant message to the MemWeave server.
// Idempotent on (sessionId, messageId), so retries collapse to one
// row server-side.
//
// Communicates back to Codex via stdout JSON: { continue: true }.
//
// The HTTP plumbing lives in _lib.mjs (shared with prompt-inject.mjs
// and file-pack.mjs); this file is just the Stop-specific glue.

import {
  readStdin,
  parseEvent,
  deriveSessionId,
  deriveCwd,
  deriveScopes,
  reportSession,
  reportObservation,
  makeMessageId,
  emitHookOutput,
} from './_lib.mjs';

const raw = await readStdin();
const event = parseEvent(raw);

const sessionId = deriveSessionId(event);
const cwd = deriveCwd(event);
const scopes = deriveScopes(event);

// Codex gives the assistant's last message text on Stop. v0.5.4
// also gives a `transcript_path` and `cwd`; both optional.
const lastAssistant =
  event.last_assistant_message ??
  event.lastAssistantMessage ??
  event.assistant_message ??
  event.assistantMessage ??
  '';
const turnId = (event.turn_id ?? event.turnId ?? '0').toString();
const transcriptPath = event.transcript_path ?? event.transcriptPath ?? null;

// 1. Upsert session (idempotent on sessionId). Use a short stable
// title so retries collapse to the same row.
const sessionTitle = (lastAssistant || `Codex session in ${cwd || 'unknown cwd'}`)
  .slice(0, 80)
  .replace(/\s+/g, ' ');
await reportSession({ sessionId, source: 'codex', title: sessionTitle });

// 2. Write the assistant message as a chat.assistant observation.
// Idempotent on (sessionId, messageId). Same content -> same hash
// -> same id -> no duplicates on Stop replay.
if (lastAssistant) {
  const assistantMsgId = makeMessageId(
    sessionId,
    'assistant',
    lastAssistant + turnId
  );
  await reportObservation({
    sessionId,
    messageId: assistantMsgId,
    hookType: 'chat.assistant',
    text: lastAssistant,
    scopes,
  });
}

// 3. Tell Codex: continue normally. We never block the Stop event.
emitHookOutput({ continue: true, suppressOutput: true });
process.exit(0);
