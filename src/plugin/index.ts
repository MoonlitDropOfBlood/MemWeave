import type { Plugin } from '@opencode-ai/plugin';
import type { Model } from '@opencode-ai/sdk';
import { MemweaveInjectClient, type InjectResponse } from './client.js';

const API = process.env.MEMWEAVE_URL || 'http://127.0.0.1:3131';
const TIMEOUT = 10000;
const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'Glob', 'Grep']);
const FILE_KEYS = ['filePath', 'file_path', 'path', 'file', 'pattern'];
const INJECTED_CACHE = new Map<string, Set<string>>();

/**
 * Pending file_pack XMLs that we couldn't push to the system prompt at the
 * moment of `tool.execute.before` (the hook output has no `system` array).
 * We flush them on the next `experimental.chat.system.transform` call.
 */
const PENDING_FILE_PACKS = new Map<string, Set<string>>();

function getPendingFilePacks(sessionId: string): Set<string> {
  let s = PENDING_FILE_PACKS.get(sessionId);
  if (!s) {
    s = new Set<string>();
    PENDING_FILE_PACKS.set(sessionId, s);
  }
  return s;
}

function extractFilePaths(args: Record<string, unknown>): string[] {
  const files: string[] = [];
  for (const key of FILE_KEYS) {
    const val = args[key];
    if (typeof val === 'string' && val.length > 0) {
      files.push(val);
    }
  }
  return files;
}

/**
 * Resolve the path to the bundled MCP server entry point. We pass the
 * absolute path to OpenCode via `ctx.directory` (the plugin's install dir)
 * so the user doesn't have to wire up `cwd` themselves.
 *
 * The plugin lives at `<repo>/src/plugin/index.ts`. The MCP entry is the
 * sibling `src/mcp/index.ts`. The plugin is launched as a TypeScript file
 * by `tsx` (declared in devDependencies), so we invoke it via `tsx`.
 */
function resolveMcpServerCommand(pluginDir: string): string[] {
  // ctx.directory is the directory containing the plugin file itself
  // (i.e. <repo>/src/plugin/). Walk up to <repo>/ then into src/mcp.
  const path = require('node:path') as typeof import('node:path');
  const mcpEntry = path.resolve(pluginDir, '..', 'mcp', 'index.ts');
  return ['npx', '--yes', 'tsx', mcpEntry];
}

export const MemweaveInjectPlugin: Plugin = async (ctx) => {
  const client = new MemweaveInjectClient({ baseUrl: API, timeout: TIMEOUT });
  const sessionInjected = INJECTED_CACHE;

  return {
    // ── Step 1: register the MemWeave MCP server with OpenCode ─────────────
    // This is the progressive-disclosure close-the-loop mechanism. Once
    // registered, OpenCode connects to the MCP server on plugin load and
    // exposes its 10 tools (memory_save, memory_recall, memory_smart_search,
    // memory_expand, memory_graph_query, memory_file_history, …) directly
    // to the LLM. The LLM can then call e.g. `memory_expand` to fetch the
    // full body of a memory it only saw a summary of in the injected XML.
    //
    // Pattern from the OpenCode plugin manual: see the `config` hook
    // section in https://opencode.ai/docs/plugins/ and the config-hook
    // chapter in joshuadavidthomas/opencode-plugins-manual. oh-my-openagent
    // uses the same mechanism to ship its own MCP servers.
    config: async (config) => {
      config.mcp = config.mcp ?? {};
      config.mcp['memweave'] = {
        type: 'local',
        command: resolveMcpServerCommand(ctx.directory),
        environment: {
          MEMWEAVE_URL: API
        },
        enabled: true,
        // MCP tool calls can be slow on first call (consolidation, search).
        timeout: 30000
      };
    },

    // ── Step 2: inject summary-only XML into the system prompt ────────────
    // The XML contains only <title> + <summary> per memory (progressive
    // disclosure). To get full body, the LLM calls `memory_expand` on the
    // MemWeave MCP server (registered above).
    'experimental.chat.system.transform': async (
      _input: { sessionID?: string; model: Model },
      output: { system: string[] }
    ) => {
      const sessionId = _input.sessionID ?? 'default';
      const alreadyInjected = sessionInjected.get(sessionId) ?? new Set<string>();
      const phase: 'session_start' | 'prompt_delta' = sessionInjected.has(sessionId) ? 'prompt_delta' : 'session_start';

      let response: InjectResponse;
      try {
        response = await client.requestInjection({
          sessionId,
          phase,
          alreadyInjected: [...alreadyInjected]
        });
      } catch {
        // Silent fail: injection is best-effort, don't break the agent
        return;
      }

      if (response.contextXml) {
        output.system.push(response.contextXml);
        for (const id of response.memoryIds) {
          alreadyInjected.add(id);
        }
        sessionInjected.set(sessionId, alreadyInjected);
      }

      // Flush any pending file_pack XMLs collected from prior
      // tool.execute.before calls (see below).
      const pending = PENDING_FILE_PACKS.get(sessionId);
      if (pending && pending.size > 0) {
        for (const xml of pending) output.system.push(xml);
        PENDING_FILE_PACKS.delete(sessionId);
      }
    },

    // ── Step 3: on file-touching tool calls, queue file-pack XML ───────────
    // `tool.execute.before` has no `system` array on its output, so we can't
    // push to the system prompt directly. Stash the XML and let the next
    // `experimental.chat.system.transform` flush it. We deliberately do NOT
    // mark the memories as injected here (only after they've been pushed to
    // system) — otherwise the delta pack would skip them on the next
    // system.transform even though the LLM never saw them.
    'tool.execute.before': async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> }
    ) => {
      if (!FILE_TOOLS.has(input.tool)) return;
      const sessionId = input.sessionID;
      const files = extractFilePaths(output.args);
      if (files.length === 0) return;
      const alreadyInjected = sessionInjected.get(sessionId) ?? new Set<string>();

      try {
        const response = await client.requestInjection({
          sessionId,
          phase: 'file_pack',
          files,
          alreadyInjected: [...alreadyInjected]
        });
        if (response.contextXml) {
          getPendingFilePacks(sessionId).add(response.contextXml);
          // Note: do NOT add response.memoryIds to sessionInjected here.
          // The XML hasn't been pushed to the system prompt yet. Wait for
          // the next system.transform to actually append it, then add the
          // ids there.
        }
      } catch {
        // Silent fail
      }
    }
  };
};
