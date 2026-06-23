#!/usr/bin/env node
// MemWeave Mavis plugin -- UserPromptSubmit hook (cross-platform Node).
//
// Reads a CC-style event from stdin (Mavis's UserPromptSubmit is a
// direct port of the Claude Code hook format), POSTs the user prompt
// as a chat.user observation, then asks the server for a
// prompt_delta memory pack and emits it as `additionalContext` so the
// LLM sees it before answering.
//
// The hook is fail-silent: if the MemWeave server is down or the
// request fails, the agent continues normally. We never block.

import {
  readStdin,
  parseEvent,
  deriveSessionId,
  deriveCwd,
  deriveScopes,
  requestInjection,
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

// Mavis mirrors CC's prompt field; tolerate camelCase variants too.
const prompt = (event.prompt ?? event.user_prompt ?? event.userPrompt ?? '').toString();
if (!prompt) {
  // No prompt to capture or to search against -- skip silently.
  emitHookOutput({ continue: true });
  process.exit(0);
}

// 1. Upsert session (idempotent). The server requires `title` +
// `source`. Use a short stable title from the first 80 chars of the
// prompt so retries collapse to the same row.
const title = prompt.slice(0, 80).replace(/\s+/g, ' ');
await reportSession({ sessionId, source: 'mavis', title });

// 2. Write the user message as a chat.user observation. Idempotent
// on (sessionId, messageId) via the JSON envelope in tool_input.
const userMsgId = makeMessageId(sessionId, 'user', prompt);
await reportObservation({
  sessionId,
  messageId: userMsgId,
  hookType: 'chat.user',
  text: prompt,
  scopes,
});

// 3. Fetch a prompt_delta memory pack. The server runs a 4-layer
// search (BM25 + vector + graph + causal) and returns a
// token-budgeted XML chunk. We hand it to Mavis as
// `hookSpecificOutput.additionalContext` so the LLM sees it before
// responding.
//
// We deliberately do NOT track `alreadyInjected` here -- the Mavis
// marketplace format does not give us a session-scoped cache we can
// trust across hooks. Every prompt re-fetches; the server is the
// source of truth for dedup. Cost is one search per prompt; that's
// fine.
const injection = await requestInjection({
  sessionId,
  phase: 'prompt_delta',
  query: prompt,
});

const additionalContext = injection && typeof injection.contextXml === 'string'
  ? injection.contextXml
  : '';

// 4. Emit the hook output. Mavis reads the LAST line of stdout as
// the JSON hook response. We always emit, even if additionalContext
// is empty, so the agent never waits on a missing line.
if (additionalContext) {
  emitHookOutput({
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext,
    },
  });
} else {
  emitHookOutput({ continue: true, suppressOutput: true });
}
process.exit(0);
