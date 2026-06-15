import type { Plugin } from '@opencode-ai/plugin';
import type { Model } from '@opencode-ai/sdk';
import { MemweaveInjectClient, type InjectResponse } from './client.js';

const API = process.env.MEMWEAVE_URL || 'http://127.0.0.1:3131';
const TIMEOUT = Number(process.env.MEMWEAVE_PLUGIN_TIMEOUT) || 10000;
const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'Glob', 'Grep']);
const FILE_KEYS = ['filePath', 'file_path', 'path', 'file', 'pattern'];

/** Evict cache entries older than this. Caps memory leak across long sessions. */
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  ids: Set<string>;
  lastSeenMs: number;
}

const INJECTED_CACHE = new Map<string, CacheEntry>();
const PENDING_FILE_PACKS = new Map<string, CacheEntry>();

function touchCache(map: Map<string, CacheEntry>, sessionId: string): CacheEntry {
  let entry = map.get(sessionId);
  if (!entry) {
    entry = { ids: new Set<string>(), lastSeenMs: Date.now() };
    map.set(sessionId, entry);
  } else {
    entry.lastSeenMs = Date.now();
  }
  return entry;
}

/**
 * Periodic sweep: drop entries that haven't been touched in CACHE_TTL_MS.
 * Prevents the maps from growing unbounded over the OpenCode process lifetime.
 */
function startCacheSweeper(): NodeJS.Timeout {
  const timer = setInterval(() => {
    const cutoff = Date.now() - CACHE_TTL_MS;
    for (const [key, entry] of INJECTED_CACHE) {
      if (entry.lastSeenMs < cutoff) INJECTED_CACHE.delete(key);
    }
    for (const [key, entry] of PENDING_FILE_PACKS) {
      if (entry.lastSeenMs < cutoff) PENDING_FILE_PACKS.delete(key);
    }
  }, CACHE_TTL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

const _cacheSweeper = startCacheSweeper();

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

export const MemweaveInjectPlugin: Plugin = async ({ client: ocClient }) => {
  const client = new MemweaveInjectClient({ baseUrl: API, timeout: TIMEOUT });
  const sessionInjected = INJECTED_CACHE;

  return {
    // ── Force-register the remote MemWeave MCP endpoint ───────────────
    // The MemWeave MCP server is embedded inside @mem-weave/server and
    // exposed at /mcp (Streamable HTTP). Rather than ask the user to
    // hand-edit ~/.config/opencode/opencode.json's `mcp` block, the
    // plugin registers the remote endpoint itself on every OpenCode
    // boot. We deliberately OVERWRITE any user-supplied `mcp.memweave`
    // entry so the stack always points at the server the plugin
    // targets (set via MEMWEAVE_URL). Other MCP servers in the
    // `mcp` block are left untouched.
    config: async (config) => {
      const mcpUrl = `${API.replace(/\/+$/, '')}/mcp`;
      if (!config.mcp) {
        config.mcp = {} as NonNullable<typeof config.mcp>;
      }
      (config.mcp as Record<string, unknown>).memweave = {
        type: 'remote',
        url: mcpUrl,
        enabled: true,
      };
    },

    // ── Write-side closure: report every chat message to MemWeave ─────
    // As of v0.4 the plugin listens to OpenCode's `event` bus and pushes
    // every completed message (user + assistant) to the MemWeave server
    // as a Session + Observation. This closes the loop: the LLM/agent
    // is no longer read-only — its high-signal turns become observations
    // that the consolidation worker can promote to memories.
    //
    // The flow:
    //   1. `event.message.updated` fires once per message after OpenCode
    //      has finalised it. We extract the role + message id + session
    //      id from the message metadata.
    //   2. We then ask the OpenCode SDK (input.client.session.messages)
    //      for the full Part[] list of that single message so we have
    //      the actual text (Message metadata itself has no `text`).
    //   3. POST /api/v1/sessions (idempotent) and POST
    //      /api/v1/observations (idempotent on (sessionId, messageId))
    //      on the MemWeave server.
    // All steps are silent-fail — a MemWeave outage never breaks the
    // agent. Debouncing isn't needed: `message.updated` is once per
    // message, not once per streamed token (the per-token stream
    // is `message.part.updated` which we deliberately do NOT handle).
    event: async (input) => {
      const ev = input.event;
      if (ev.type !== 'message.updated') return;
      const msg = ev.properties.info;

      // Skip synthetic messages (system-generated, no user content)
      if ('synthetic' in msg && msg.synthetic) return;

      const sessionID = msg.sessionID;
      const messageID = msg.id;
      if (!sessionID || !messageID) return;

      // Tool messages don't exist in `Message` (it's UserMessage |
      // AssistantMessage), but assistant text can include tool-call
      // XML/tags from MCP. We just take the text we get.
      if (msg.role !== 'user' && msg.role !== 'assistant') return;

      // Resolve the OpenCode SDK client (provided by the host
      // OpenCode process). The plugin only has access to it inside
      // the `event` callback — the function passed to the SDK
      // captures it via the `sdk` parameter.
      // We re-use the host-supplied `input.client` from the
      // PluginInput envelope. Note: the `event` hook signature in
      // `@opencode-ai/plugin` is `(input: { event: Event }) => void`
      // — the SDK client is not on the input. We attach it to
      // module scope at the top of the plugin factory instead.
      const sdk = ocClient;
      if (!sdk) return;

      // Pull the full Part[] for this message so we have the text.
      let textParts: string[] = [];
      try {
        const res = await sdk.session.messages({ path: { id: sessionID } });
        const messages = (res as { data?: Array<{ info: unknown; parts: Array<{ type: string; text?: string }> }> }).data ?? [];
        const target = messages.find((m) => {
          const info = m.info as { id?: string };
          return info.id === messageID;
        });
        if (target) {
          for (const p of target.parts) {
            if (p.type === 'text' && typeof p.text === 'string') {
              textParts.push(p.text);
            }
          }
        }
      } catch {
        // Silent fail: server unreachable or session not yet visible.
        return;
      }

      const text = textParts.join('\n').trim();
      if (text.length === 0) return;

      const hookType: 'chat.user' | 'chat.assistant' =
        msg.role === 'user' ? 'chat.user' : 'chat.assistant';

      // Idempotent: server upserts on (sessionId, messageId). The
      // title is derived from the first ~80 chars of the user
      // message (or the assistant text, whichever we have).
      const title = text.slice(0, 80).replace(/\s+/g, ' ');
      try {
        await client.reportSession({ sessionId: sessionID, source: 'opencode', title });
        await client.reportObservation({
          sessionId: sessionID,
          messageId: messageID,
          hookType,
          text,
        });
      } catch {
        // Silent fail
      }
    },

    // ── Inject summary-only XML into the system prompt ────────────────
    // The XML contains only <title> + <summary> per memory (progressive
    // disclosure). To get full body, the LLM calls memory_expand on
    // the remote MemWeave MCP server.
    'experimental.chat.system.transform': async (
      _input: { sessionID?: string; model: Model },
      output: { system: string[] }
    ) => {
      const sessionId = _input.sessionID ?? 'default';
      const injectedEntry = touchCache(INJECTED_CACHE, sessionId);
      const alreadyInjected = injectedEntry.ids;
      const phase: 'session_start' | 'prompt_delta' = alreadyInjected.size > 0 ? 'prompt_delta' : 'session_start';

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
      }

      // Flush any pending file_pack XMLs collected from prior
      // tool.execute.before calls (see below).
      const pendingEntry = PENDING_FILE_PACKS.get(sessionId);
      if (pendingEntry && pendingEntry.ids.size > 0) {
        for (const xml of pendingEntry.ids) output.system.push(xml);
        pendingEntry.ids.clear();
      }
    },

    // ── Step 3: on file-touching tool calls, queue file-pack XML ───────────
    // tool.execute.before has no system array on its output, so we can't
    // push to the system prompt directly. Stash the XML and let the next
    // experimental.chat.system.transform flush it. We deliberately do NOT
    // mark the memories as injected here (only after they've been pushed to
    // system) -- otherwise the delta pack would skip them on the next
    // system.transform even though the LLM never saw them.
    'tool.execute.before': async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> }
    ) => {
      if (!FILE_TOOLS.has(input.tool)) return;
      const sessionId = input.sessionID;
      const files = extractFilePaths(output.args);
      if (files.length === 0) return;
      const alreadyInjected = touchCache(INJECTED_CACHE, sessionId).ids;

      try {
        const response = await client.requestInjection({
          sessionId,
          phase: 'file_pack',
          files,
          alreadyInjected: [...alreadyInjected]
        });
        if (response.contextXml) {
          touchCache(PENDING_FILE_PACKS, sessionId).ids.add(response.contextXml);
          // Note: do NOT add response.memoryIds to alreadyInjected here.
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
