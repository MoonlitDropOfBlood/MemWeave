#!/usr/bin/env node
// MemWeave Mavis plugin -- PreToolUse hook (cross-platform Node).
//
// Mavis's PreToolUse mirrors Claude Code's. We only react to
// file-touching tools (Read / Edit / Write / Glob / Grep), and only
// when the tool input has a recognisable file path. For other tools
// (bash, web, mcp calls) we no-op so we don't burn a search call.
//
// On a file-touching tool, we ask the server for a file_pack memory
// pack and emit it as `additionalContext`. The Mavis loader then
// shows the LLM the per-file memories in the same turn -- so when
// the LLM is about to read a file it has prior context on, it
// already knows the related memories.
//
// We always emit exactly one output line -- the loader reads the
// LAST line of stdout as the hook response.

import {
  readStdin,
  parseEvent,
  deriveSessionId,
  requestInjection,
  extractFilePaths,
  emitHookOutput,
} from './_lib.mjs';

const FILES_TOOLS = new Set(['Read', 'Edit', 'Write', 'Glob', 'Grep']);

const raw = await readStdin();
const event = parseEvent(raw);

const toolName = (event.tool_name ?? event.toolName ?? '').toString();
const toolInput = event.tool_input ?? event.toolInput ?? {};

let output;
if (!FILES_TOOLS.has(toolName)) {
  // Non-file tool: no-op.
  output = { continue: true, suppressOutput: true };
} else {
  const files = extractFilePaths(toolInput);
  if (files.length === 0) {
    // File tool with no parseable path: no-op.
    output = { continue: true, suppressOutput: true };
  } else {
    const sessionId = deriveSessionId(event);
    const injection = await requestInjection({
      sessionId,
      phase: 'file_pack',
      files,
    });
    const additionalContext =
      injection && typeof injection.contextXml === 'string'
        ? injection.contextXml
        : '';
    if (additionalContext) {
      // Use the PreToolUse-specific envelope so Mavis knows this is
      // a permission-decision-shaped response. We do NOT change the
      // permissionDecision; "allow" is the default.
      output = {
        continue: true,
        suppressOutput: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext,
        },
      };
    } else {
      output = { continue: true, suppressOutput: true };
    }
  }
}

emitHookOutput(output);
process.exit(0);
