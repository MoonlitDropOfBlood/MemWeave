#!/usr/bin/env node
// MemWeave Mavis plugin -- Stop hook (cross-platform Node).
//
// Mirrors the codex plugin's Stop hook. Mavis's Stop event gives the
// last assistant message text (or, on some agent backends, the full
// transcript path -- we tolerate both). We upsert the session row
// and write the assistant message as a chat.assistant observation.
// Idempotent on (sessionId, messageId), so retries and Stop-replays
// collapse to a single row server-side.
//
// The hook is fail-silent: if the MemWeave server is down or the
// request fails, the Mavis agent completes normally. We never block.

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

const lastAssistant = (
  event.last_assistant_message ??
  event.lastAssistantMessage ??
  event.assistant_message ??
  event.assistantMessage ??
  event.last_message ??
  ''
).toString();

const turnId = (event.turn_id ?? event.turnId ?? '0').toString();

// 1. Upsert session (idempotent on sessionId). The server's Zod schema
// requires `title` (min 1, max 500) and `source` (one of the
// SourceClient enum values, which now includes 'mavis'). Use a short
// stable title so retries collapse to the same row.
const sessionTitle = (lastAssistant || `Mavis session in ${cwd || 'unknown cwd'}`)
  .slice(0, 80)
  .replace(/\s+/g, ' ');
await reportSession({ sessionId, source: 'mavis', title: sessionTitle });

// 2. Write the assistant message as a chat.assistant observation.
// Idempotent on (sessionId, messageId). Same content -> same hash
// -> same id -> no duplicates on Stop replay.
if (lastAssistant) {
  const assistantMsgId = makeMessageId(sessionId, 'assistant', lastAssistant + turnId);
  await reportObservation({
    sessionId,
    messageId: assistantMsgId,
    hookType: 'chat.assistant',
    text: lastAssistant,
    scopes,
  });
}

// 3. Tell Mavis: continue normally. We never block the Stop event.
emitHookOutput({ continue: true, suppressOutput: true });
process.exit(0);
