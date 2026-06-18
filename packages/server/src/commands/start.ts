/**
 * `memweave start` — launch the HTTP server + consolidation scheduler.
 *
 * As of v0.5.7 the default behavior is **background (daemon) mode**:
 * the command spawns a detached child running the same CLI with
 * `--foreground` and exits immediately, leaving a PID file at the
 * system tmp dir and a rolling log at `<dataDir>/memweave.log`.
 * The parent terminal can be closed without affecting the server.
 *
 * Escape hatches:
 *   - `memweave start --foreground` (alias `-f`) — run inline, in the
 *     current terminal. Useful for debugging; output goes to your
 *     terminal as well as the log file.
 *   - `MEMWEAVE_FOREGROUND=1 memweave start` — same as above, but
 *     driven by env var. The detached child sets this so it knows
 *     it is the foreground instance, not the launcher.
 *
 * If a server is already running (PID file exists and points at a
 * live process), `start` refuses with a clear error rather than
 * silently failing on a port-bind.
 */
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig, expandPath } from '../core/config.js';
import type { CliContext, CommandResult, CommandHandler } from './index.js';

const PID_FILENAME = 'memweave.pid';

/** True when this invocation should run the server inline (no daemonize). */
function isForegroundMode(ctx: CliContext): boolean {
  if (process.env.MEMWEAVE_FOREGROUND === '1') return true;
  if (process.env.MEMWEAVE_FOREGROUND === '0') return false;
  return ctx.args.includes('--foreground') || ctx.args.includes('-f');
}

/** True if pid is a running process. Works on both Windows and POSIX. */
function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function pidFilePath(): string {
  return join(tmpdir(), PID_FILENAME);
}

/**
 * Read the PID file and return the pid if a live process is registered
 * there, otherwise null (and clean up the stale file in the latter case).
 */
function readLivePid(pidPath: string): number | null {
  if (!existsSync(pidPath)) return null;
  const raw = readFileSync(pidPath, 'utf8').trim();
  const pid = Number.parseInt(raw, 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    try { unlinkSync(pidPath); } catch { /* ignore */ }
    return null;
  }
  if (isProcessAlive(pid)) return pid;
  try { unlinkSync(pidPath); } catch { /* ignore */ }
  return null;
}

export const startCommand: CommandHandler = async (ctx: CliContext): Promise<CommandResult> => {
  const config = loadConfig(ctx.configPath);
  const dbPath = expandPath(config.storage.path);
  const dataDir = dirname(dbPath);
  const logPath = join(dataDir, 'memweave.log');
  const pidPath = pidFilePath();

  // 1. Refuse to start if another instance is already running.
  const existing = readLivePid(pidPath);
  if (existing !== null) {
    return {
      ok: false,
      message: `memweave-server is already running (PID ${existing}). Use \`memweave stop\` first.`,
      data: { pid: existing, pidPath, logPath }
    };
  }

  // 2. Make sure dataDir exists so the log file can be opened.
  try { mkdirSync(dataDir, { recursive: true }); } catch { /* ignore */ }

  if (isForegroundMode(ctx)) {
    return runServerForeground(ctx, config, dbPath, logPath, pidPath);
  }
  return daemonize(ctx, logPath, pidPath);
};

/**
 * Run the server inline in the current process. stdout/stderr go to
 * the caller's terminal AND to the log file (the cli-entry's console
 * writes are tee'd via the shell — we just open the log append-only
 * for the server's own pino logger).
 */
async function runServerForeground(
  ctx: CliContext,
  config: ReturnType<typeof loadConfig>,
  dbPath: string,
  logPath: string,
  pidPath: string
): Promise<CommandResult> {
  const { createHttpServer } = await import('../server/http.js');
  const { startConsolidationScheduler } = await import('../server/scheduler.js');

  const app = await createHttpServer({ dbPath, configPath: ctx.configPath });
  if (config.consolidation.enabled) {
    startConsolidationScheduler({
      dbPath,
      intervalMs: config.consolidation.intervalHours * 60 * 60 * 1000,
      runOnStart: true
    });
  }
  await app.listen({ host: config.server.host, port: config.server.port });

  writeFileSync(pidPath, String(process.pid), 'utf8');
  const cleanup = (): void => {
    try { unlinkSync(pidPath); } catch { /* ignore */ }
  };
  process.once('exit', cleanup);
  process.once('SIGINT', () => { cleanup(); process.exit(0); });
  process.once('SIGTERM', () => { cleanup(); process.exit(0); });

  // eslint-disable-next-line no-console
  console.log(`[memweave] log: ${logPath}`);

  return {
    ok: true,
    message: `memweave-server listening on ${config.server.host}:${config.server.port}`,
    data: { host: config.server.host, port: config.server.port, dbPath, pidPath, logPath, pid: process.pid }
  };
}

/**
 * Spawn a detached child running the same CLI in foreground mode.
 * The child's stdout/stderr are redirected to the log file; the
 * parent only writes a short status line to its own stdout and
 * exits. Closing the parent terminal does not affect the child.
 */
async function daemonize(
  ctx: CliContext,
  logPath: string,
  pidPath: string
): Promise<CommandResult> {
  // Resolve the path to the compiled cli-entry.js. start.js lives at
  // <pkg>/dist/commands/start.js, so cli-entry.js is two levels up.
  const here = fileURLToPath(import.meta.url);
  const cliEntryPath = join(dirname(dirname(here)), 'cli-entry.js');

  // Drop any --foreground / -f from the args we forward; the child
  // gets the env-var-based signal instead, which is harder to spoof.
  const forwardArgs = ctx.args.filter((a) => a !== '--foreground' && a !== '-f');

  let logFd: number;
  try {
    logFd = openSync(logPath, 'a');
  } catch (err) {
    return {
      ok: false,
      message: `Failed to open log file ${logPath}: ${(err as Error).message}`
    };
  }

  let child;
  try {
    child = spawn(
      process.execPath,
      [cliEntryPath, 'start', ...forwardArgs],
      {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        windowsHide: true,
        env: { ...process.env, MEMWEAVE_FOREGROUND: '1' }
      }
    );
  } catch (err) {
    return {
      ok: false,
      message: `Failed to spawn daemon: ${(err as Error).message}`
    };
  }

  // Detach from the parent's event loop so the parent can exit
  // without taking the child down.
  child.unref();

  // Poll the PID file for up to ~5s. The child writes its own PID
  // right after `app.listen()` succeeds, so this tells us the server
  // actually came up (or it tells us it died early).
  const deadline = Date.now() + 5000;
  let livePid: number | null = null;
  let earlyExit: number | null = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    livePid = readLivePid(pidPath);
    if (livePid !== null) break;
    if (child.exitCode !== null) {
      earlyExit = child.exitCode;
      break;
    }
  }

  if (livePid === null) {
    return {
      ok: false,
      message: earlyExit !== null
        ? `Daemon exited with code ${earlyExit} before binding the port. Check ${logPath}.`
        : `Daemon started but PID file not written within 5s. Check ${logPath}.`,
      data: { logPath, pidPath, childPid: child.pid, earlyExit }
    };
  }

  return {
    ok: true,
    message: `memweave-server started in background (PID ${livePid}). Log: ${logPath}`,
    data: { pid: livePid, pidPath, logPath, childPid: child.pid }
  };
}
