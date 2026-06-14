import type { Plugin } from '@opencode-ai/plugin';
import type { Model } from '@opencode-ai/sdk';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
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

/**
 * Resolve the absolute path to the installed @mem-weave/mcp package dist,
 * so we can spawn it directly via node instead of npx.
 *
 * Why: npx @mem-weave/mcp on Windows with npm 9+ silently exits because
 * npm refuses to publish a bin field on a scoped package (it gets
 * silently stripped from the tarball), and npx then has no command to
 * run. Spawning node with the resolved path sidesteps the entire npx
 * bin-resolution machinery.
 *
 * Search order:
 *   1. NODE_PATH env (advanced: let the user override)
 *   2. npm root -g (global install)
 *   3. Common npx cache locations under ~/.npm/_npx/<HASH>/node_modules/
 *   4. The plugin node_modules dir (works if user installed mcp next to the plugin)
 */
export function resolveMcpDistPath(): string | undefined {
  // 1. Global install: most reliable for npm i -g @mem-weave/mcp
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf-8' }).trim();
    const candidate = join(globalRoot, '@mem-weave', 'mcp', 'dist', 'index.js');
    if (existsSync(candidate)) return candidate;
  } catch { /* npm not in PATH, or no global dir */ }

  // 2. npx cache -- falls back if user has used npx at least once
  try {
    const npxCache = join(homedir(), '.npm', '_npx');
    if (existsSync(npxCache)) {
      // Pick the most recently modified cache that contains @mem-weave/mcp
      const entries: Array<{ dir: string; mtime: number }> = [];
      for (const hash of readdirSync(npxCache)) {
        const candidate = join(npxCache, hash, 'node_modules', '@mem-weave', 'mcp', 'dist', 'index.js');
        if (existsSync(candidate)) {
          const stat = statSync(join(npxCache, hash));
          entries.push({ dir: candidate, mtime: stat.mtimeMs });
        }
      }
      entries.sort((a, b) => b.mtime - a.mtime);
      if (entries[0]) return entries[0].dir;
    }
  } catch { /* _npx unreadable */ }

  // 3. Fall back to plugin node_modules (peer install pattern)
  const here = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const localCandidate = resolve(here, '..', 'node_modules', '@mem-weave', 'mcp', 'dist', 'index.js');
  if (existsSync(localCandidate)) return localCandidate;

  return undefined;
}

/**
 * Return the command to launch the MemWeave MCP server.
 *
 * We prefer spawn node with an absolute dist path so we dont depend on
 * npx bin resolution (which is broken for scoped packages with no bin
 * on npm 9+). If no path can be resolved, we fall back to npx as a
 * last resort: the user will see a clearer error from npx than from
 * a silent failure.
 *
 * The pluginDir parameter is kept for backward compatibility (the
 * function is exported and referenced in tests).
 */
export function resolveMcpServerCommand(_pluginDir: string): string[] {
  const distPath = resolveMcpDistPath();
  if (distPath) return ['node', distPath];
  return ['npx', '--yes', '@mem-weave/mcp'];
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
    // to the LLM. The LLM can then call e.g. memory_expand to fetch the
    // full body of a memory it only saw a summary of in the injected XML.
    //
    // Pattern from the OpenCode plugin manual: see the config hook
    // section in https://opencode.ai/docs/plugins/ and the config-hook
    // chapter in joshuadavidthomas/opencode-plugins-manual. oh-my-openagent
    // uses the same mechanism to ship its own MCP servers.
    config: async (config) => {
      config.mcp = config.mcp ?? {};
      // Guard against name collision. If the user already has an MCP server
      // named 'memweave' (from another plugin, say), merging into it would
      // silently clobber it. Refuse and surface a clear message in the
      // OpenCode logs instead.
      if (config.mcp['memweave'] && config.mcp['memweave'].type !== 'local') {
        // eslint-disable-next-line no-console
        console.warn(
          '[memweave] config.mcp["memweave"] is already set to a non-local server; ' +
          'skipping registration. If you want MemWeave tools, remove or rename ' +
          'the existing entry.'
        );
        return;
      }
      config.mcp['memweave'] = {
        type: 'local',
        command: resolveMcpServerCommand(ctx.directory),
        environment: {
          MEMWEAVE_URL: API
        },
        enabled: true,
        // MCP tool calls can be slow on first call:
        //   - local-xenova needs to load a ~30MB model on cold start
        //   - consolidation runs the 4-layer search pipeline
        // The 60s ceiling accommodates the worst-case cold start; subsequent
        // calls are typically sub-second. Override per-call via
        // MEMWEAVE_PLUGIN_TIMEOUT (currently unused by MCP path but kept
        // for symmetry with the inject client).
        timeout: 60000
      };
    },

    // ── Step 2: inject summary-only XML into the system prompt ────────────
    // The XML contains only <title> + <summary> per memory (progressive
    // disclosure). To get full body, the LLM calls memory_expand on the
    // MemWeave MCP server (registered above).
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
