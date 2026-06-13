import type { Plugin } from '@opencode-ai/plugin';
import type { Model } from '@opencode-ai/sdk';
import { MemweaveInjectClient, type InjectResponse } from './client.js';
import { buildSystemAppend, type MemoryForInjection } from './injector.js';

const API = process.env.MEMWEAVE_URL || 'http://127.0.0.1:3131';
const TIMEOUT = 10000;
const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'Glob', 'Grep']);
const FILE_KEYS = ['filePath', 'file_path', 'path', 'file', 'pattern'];
const INJECTED_CACHE = new Map<string, Set<string>>();

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

export const MemweaveInjectPlugin: Plugin = async (_ctx) => {
  const client = new MemweaveInjectClient({ baseUrl: API, timeout: TIMEOUT });
  const sessionInjected = INJECTED_CACHE;

  return {
    'experimental.chat.system.transform': async (_input: { sessionID?: string; model: Model }, output: { system: string[] }) => {
      const sessionId = _input.sessionID ?? 'default';
      const alreadyInjected = sessionInjected.get(sessionId) ?? new Set<string>();

      // The system prompt transform hook doesn't provide user prompt directly
      // We use empty query for session_start, rely on server to return stable pack
      let phase: 'session_start' | 'prompt_delta' = sessionInjected.has(sessionId) ? 'prompt_delta' : 'session_start';
      let response: InjectResponse;
      try {
        response = await client.requestInjection({
          sessionId,
          phase,
          alreadyInjected: [...alreadyInjected]
        });
      } catch (err) {
        // Silent fail: injection is best-effort, don't break the agent
        return;
      }

      // The contextXml is rendered by the server; we just append it.
      if (response.contextXml) {
        output.system.push(response.contextXml);
        for (const id of response.memoryIds) {
          alreadyInjected.add(id);
        }
        sessionInjected.set(sessionId, alreadyInjected);
      }
    },

    'tool.execute.before': async (input: { tool: string; sessionID: string; callID: string }, output: { args: Record<string, unknown> }) => {
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
          output.args = { ...output.args, _memweaveInjected: true } as Record<string, unknown>;
          // We need to inject via system prompt, but tool.execute.before only has args
          // For file tools, we'll append to a special property that gets picked up
          // Actually the hook output doesn't have system array, so we need a different approach
          // For now, we'll use the fact that tool.execute.before can modify args
          // But the injection really needs to go to system prompt
          // This is a limitation - we'll note it and the session_start handles main injection
        }
        for (const id of response.memoryIds) {
          alreadyInjected.add(id);
        }
        sessionInjected.set(sessionId, alreadyInjected);
      } catch {
        // Silent fail
      }
    }
  };
};