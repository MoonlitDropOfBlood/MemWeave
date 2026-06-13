/**
 * MemWeave CLI — design spec §9.11.
 *
 * Subcommands (all optional; running without args shows help):
 *
 *   memweave start           Start the HTTP server + background workers (default)
 *   memweave stop            Stop a running memweave-server (via PID file)
 *   memweave status          Probe /api/v1/health
 *   memweave init            Create default config, DB, and device key
 *   memweave doctor          Check dependencies, port, DB, embedding/LLM config
 *   memweave mcp             Start the stdio MCP shim
 *   memweave migrate         Run schema migration (idempotent)
 *   memweave backup [path]   Copy the SQLite DB to a snapshot file
 *   memweave help            Show help
 *
 * Note: this file is the *parser / dispatcher*. The actual logic for each
 * command lives in `./commands/`. The CLI never edits `bootstrap.ts` — the
 * default `start` command simply invokes the existing server bootstrap.
 */
import { runCommand, type CliContext, type CommandResult } from './commands/index.js';

export type CliCommand =
  | 'start'
  | 'stop'
  | 'status'
  | 'init'
  | 'doctor'
  | 'mcp'
  | 'migrate'
  | 'backup'
  | 'help'
  | 'version';

export interface CliInvocation {
  command: CliCommand;
  args: string[];
  env: NodeJS.ProcessEnv;
  configPath?: string;
}

export interface ParsedCli {
  command: CliCommand;
  args: string[];
}

export function parseCli(argv: string[]): ParsedCli {
  const [, , cmd, ...rest] = argv;
  if (!cmd || cmd === '-h' || cmd === '--help') return { command: 'help', args: [] };
  if (cmd === '-v' || cmd === '--version' || cmd === 'version') return { command: 'version', args: [] };
  const known: CliCommand[] = ['start', 'stop', 'status', 'init', 'doctor', 'mcp', 'migrate', 'backup', 'help'];
  if (known.includes(cmd as CliCommand)) {
    return { command: cmd as CliCommand, args: rest };
  }
  throw new CliError(`Unknown command: ${cmd}\nRun \`memweave help\` for usage.`);
}

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

export async function runCli(invocation: CliInvocation): Promise<CommandResult> {
  const ctx: CliContext = {
    env: invocation.env,
    args: invocation.args,
    configPath: invocation.configPath
  };
  return runCommand(invocation.command, ctx);
}

export { runCommand, type CommandResult } from './commands/index.js';
