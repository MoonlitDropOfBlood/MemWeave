#!/usr/bin/env node
// MemWeave zcode plugin -- Stop hook (cross-platform, no native deps).
//
// Fires when a zcode conversation turn ends. Reads the JSON event from stdin,
// POSTs the session + last assistant message to the MemWeave server as a
// chat.assistant observation. Idempotent on (sessionId, messageId) so retries
// (Stop replays) collapse to one row server-side.
//
// zcode Stop event payload (Claude-Code-style, snake_case):
//   { session_id, hook_event_name: "Stop", cwd, transcript_path,
//     stop_hook_active, ... }
// The assistant message text is NOT in the Stop payload directly — zcode
// stores the transcript at transcript_path. We read the last assistant turn
// from the transcript JSONL when available; if not, we fall back to writing
// only the session (so it at least exists for future observations).
//
// Fail-silent: any error → emit { continue: true } and exit 0. A MemWeave
// outage must never block the agent.

import { readFileSync } from 'node:fs';
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
const transcriptPath = event.transcript_path ?? event.transcriptPath ?? null;

// Extract the last assistant message text. zcode writes a JSONL transcript
// (one message object per line). We read it and find the last assistant turn.
let lastAssistant = '';
if (transcriptPath) {
  try {
    const content = readFileSync(transcriptPath, 'utf8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    // Walk backwards to find the last assistant message.
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const msg = JSON.parse(lines[i]);
        // zcode/Claude-Code transcript entries: { type: "assistant", message: { content: [...] } }
        // or flatter { role: "assistant", content: "..." }. Handle both.
        if (msg.type === 'assistant' || msg.role === 'assistant') {
          const content = msg.message?.content ?? msg.content;
          if (typeof content === 'string') {
            lastAssistant = content;
          } else if (Array.isArray(content)) {
            // content is an array of blocks; concatenate text blocks.
            lastAssistant = content
              .filter((b) => typeof b === 'object' && b.type === 'text')
              .map((b) => b.text ?? '')
              .join('\n');
          }
          if (lastAssistant) break;
        }
      } catch {
        // skip unparseable lines
      }
    }
  } catch {
    // transcript read failed — proceed with empty lastAssistant
  }
}

// 1. Upsert session (idempotent on sessionId).
const sessionTitle = (lastAssistant || `zcode session in ${cwd || 'unknown cwd'}`)
  .slice(0, 80)
  .replace(/\s+/g, ' ');
await reportSession({ sessionId, source: 'zcode', title: sessionTitle });

// 2. Write the assistant message as a chat.assistant observation.
// Idempotent on (sessionId, messageId).
if (lastAssistant) {
  const assistantMsgId = makeMessageId(sessionId, 'assistant', lastAssistant);
  await reportObservation({
    sessionId,
    messageId: assistantMsgId,
    hookType: 'chat.assistant',
    text: lastAssistant,
    scopes,
  });
}

// Always let the agent proceed. Stop hooks that block would hang the agent.
emitHookOutput({ continue: true });
