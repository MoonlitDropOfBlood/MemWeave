/**
 * CLI command dispatcher — each command lives in its own file and exports
 * a `(ctx: CliContext) => Promise<CommandResult>` function.
 */
import type { CliCommand } from '../cli.js';

export interface CliContext {
  env: NodeJS.ProcessEnv;
  args: string[];
  configPath?: string;
}

export interface CommandResult {
  ok: boolean;
  message?: string;
  data?: unknown;
}

export type CommandHandler = (ctx: CliContext) => Promise<CommandResult>;

import { startCommand } from './start.js';
import { stopCommand } from './stop.js';
import { statusCommand } from './status.js';
import { initCommand } from './init.js';
import { doctorCommand } from './doctor.js';
import { migrateCommand } from './migrate.js';
import { backupCommand } from './backup.js';
import { helpCommand } from './help.js';
import { versionCommand } from './version.js';

const handlers: Record<CliCommand, CommandHandler> = {
  start: startCommand,
  stop: stopCommand,
  status: statusCommand,
  init: initCommand,
  doctor: doctorCommand,
  migrate: migrateCommand,
  backup: backupCommand,
  help: helpCommand,
  version: versionCommand
};

export async function runCommand(command: CliCommand, ctx: CliContext): Promise<CommandResult> {
  const handler = handlers[command];
  if (!handler) {
    return { ok: false, message: `No handler for command: ${command}` };
  }
  return handler(ctx);
}
