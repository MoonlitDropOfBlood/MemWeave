import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../core/config.js';
import { expandPath } from '../core/config.js';
import type { CliContext, CommandResult, CommandHandler } from './index.js';

const PID_FILENAME = 'memweave.pid';

/**
 * `memweave stop` — read PID file, send SIGTERM, wait, SIGKILL fallback.
 */
export const stopCommand: CommandHandler = async (ctx: CliContext): Promise<CommandResult> => {
  const config = loadConfig(ctx.configPath);
  const dbPath = expandPath(config.storage.path);
  const pidPath = join(tmpdir(), PID_FILENAME);

  if (!existsSync(pidPath)) {
    return { ok: true, message: 'No PID file found; nothing to stop.', data: { pidPath } };
  }

  const pid = Number.parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    return { ok: false, message: `Invalid PID file: ${pidPath}` };
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    return { ok: false, message: `Failed to send SIGTERM to PID ${pid}: ${(err as Error).message}` };
  }

  // Give it a moment to exit
  await new Promise((r) => setTimeout(r, 500));
  try {
    process.kill(pid, 0);
    // Still alive, escalate
    process.kill(pid, 'SIGKILL');
    await new Promise((r) => setTimeout(r, 200));
  } catch {
    // Already dead
  }

  try {
    unlinkSync(pidPath);
  } catch {
    // ignore
  }

  void dbPath;
  return { ok: true, message: `Sent SIGTERM/SIGKILL to PID ${pid}`, data: { pid } };
};
