#!/usr/bin/env node
// MemWeave claude-code-plugin -- SessionStart hook (cross-platform, no native deps).
//
// Fires when a zcode / Claude Code session starts. Calls the MemWeave server's
// /api/v1/inject endpoint to fetch the <about-user> + <memory-context> bundle,
// then emits it as additionalContext so the agent sees relevant memories +
// the user profile from the very first turn — no need to call memory_recall
// manually.
//
// Claude-Code-style SessionStart injection format (stdout JSON):
//   { "hookSpecificOutput": { "hookEventName": "SessionStart",
//                             "additionalContext": "<xml>..." } }
// zcode reads the same format (it sets CLAUDE_PLUGIN_ROOT).
//
// Fail-silent: any error → emit empty additionalContext and exit 0. A
// MemWeave outage must never block session start.

import {
  readStdin,
  parseEvent,
  deriveSessionId,
  requestInjection,
  emitHookOutput,
} from './_lib.mjs';

const raw = await readStdin();
const event = parseEvent(raw);
const sessionId = deriveSessionId(event);

// Request the session_start injection bundle (memories + <about-user>).
const injection = await requestInjection({ sessionId, phase: 'session_start' });

let additionalContext = '';
if (injection && typeof injection.contextXml === 'string' && injection.contextXml.length > 0) {
  additionalContext = injection.contextXml;
}

// Emit the Claude-Code-style SessionStart injection. The agent receives
// additionalContext prepended to its system prompt.
emitHookOutput({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext
  }
});
