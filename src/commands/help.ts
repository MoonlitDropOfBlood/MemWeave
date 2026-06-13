import type { CliContext, CommandResult, CommandHandler } from './index.js';

const HELP = `MemWeave — persistent cross-device memory for AI coding agents

Usage:
  memweave <command> [options]

Commands:
  start           Start the HTTP server + background workers
  stop            Stop a running memweave-server (via PID file)
  status          Probe /api/v1/health
  init            Create default config, DB, and device key
  doctor          Check dependencies, port, DB, embedding/LLM config
  mcp             Start the stdio MCP shim
  migrate         Apply schema (idempotent) and preview consolidation
  backup [path]   Copy the SQLite DB to a snapshot file
  help            Show this help
  version         Print version

Config (env or ~/.memweave/config.jsonc):
  MEMWEAVE_CONFIG          Path to config.jsonc

Examples:
  memweave init
  memweave doctor
  memweave start
  memweave backup ~/backups/memweave-$(date +%Y%m%d).db
`;

export const helpCommand: CommandHandler = async (_ctx: CliContext): Promise<CommandResult> => {
  return { ok: true, message: HELP };
};
