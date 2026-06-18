import type { CliContext, CommandResult, CommandHandler } from './index.js';

const HELP = `MemWeave — persistent cross-device memory for AI coding agents

Usage:
  memweave <command> [options]

Commands:
  start [--foreground]   Start the HTTP server in the background (default)
                         and exit. The server keeps running after the
                         parent terminal is closed. Use --foreground / -f
                         to run inline (debugging). Output is appended to
                         <dataDir>/memweave.log; use \`memweave status\` to
                         probe /api/v1/health and \`memweave stop\` to shut
                         down.
  stop                   Stop a running memweave-server (via PID file)
  status                 Probe /api/v1/health
  init                   Create default config, DB, and device key
  doctor                 Check dependencies, port, DB, embedding/LLM config
  mcp                    Start the stdio MCP shim
  migrate                Apply schema (idempotent) and preview consolidation
  backup [path]          Copy the SQLite DB to a snapshot file
  help                   Show this help
  version                Print version

Config (env or ~/.memweave/config.jsonc):
  MEMWEAVE_CONFIG          Path to config.jsonc
  MEMWEAVE_FOREGROUND      1 = run start inline (debug); 0 = force detach

Examples:
  memweave init
  memweave start            # background
  memweave start -f         # foreground (Ctrl-C to stop)
  memweave status
  memweave stop
  memweave backup ~/backups/memweave-$(date +%Y%m%d).db
`;

export const helpCommand: CommandHandler = async (_ctx: CliContext): Promise<CommandResult> => {
  return { ok: true, message: HELP };
};
