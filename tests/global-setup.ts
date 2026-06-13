// Vitest globalSetup: starts a memweave-server on port 3131 before any tests
// run, and stops it when the test run completes.
//
// This makes the integration tests (tests/mcp/**, tests/plugin/client.test.ts)
// work without requiring a manually-started server.
//
// If MEMWEAVE_TEST_URL is already set (e.g. against a remote server), this
// setup is a no-op.
//
// If MEMWEAVE_NO_AUTOSTART=1, this setup is a no-op.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SERVER_PORT = 3131;
const READY_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 200;

let serverProcess: ChildProcess | null = null;
let tmpDir: string | null = null;

async function waitForReady(): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < READY_TIMEOUT_MS) {
    try {
      const res = await fetch(`http://127.0.0.1:${SERVER_PORT}/api/v1/health`);
      if (res.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Server did not become ready within ${READY_TIMEOUT_MS}ms`);
}

export async function setup(): Promise<void> {
  // If user already pointed us at a specific server, do nothing.
  if (process.env.MEMWEAVE_TEST_URL) return;
  if (process.env.MEMWEAVE_NO_AUTOSTART === '1') return;

  tmpDir = mkdtempSync(join(tmpdir(), 'memweave-test-server-'));
  const dbPath = join(tmpDir, 'test-server.db');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MEMWEAVE_NO_SCHEDULER: '1'
  };
  // Use tsx to run TypeScript directly; bootstrap reads MEMWEAVE_CONFIG but
  // we can pass the storage path through env or rely on defaults.
  // For test isolation, we set the storage path via MEMWEAVE_CONFIG pointing
  // to a config file that we create on the fly.
  const configPath = join(tmpDir, 'config.jsonc');
  const fs = await import('node:fs');
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      server: { host: '127.0.0.1', port: SERVER_PORT },
      storage: { path: dbPath },
      auth: { defaultTenantName: 'default', deviceApiKey: 'dev-local-key' }
    })
  );
  env.MEMWEAVE_CONFIG = configPath;

  serverProcess = spawn(
    process.execPath,
    ['--import', 'tsx', 'packages/server/src/server/bootstrap.ts'],
    {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );

  // Capture output for debugging
  serverProcess.stdout?.on('data', () => { /* noop */ });
  serverProcess.stderr?.on('data', () => { /* noop */ });

  serverProcess.on('exit', (code) => {
    if (code !== null && code !== 0 && code !== 143 /* SIGTERM */) {
      console.error(`[globalSetup] Server exited with code ${code}`);
    }
  });

  await waitForReady();
}

export async function teardown(): Promise<void> {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill('SIGTERM');
    // Give it a moment to shut down
    await new Promise((r) => setTimeout(r, 200));
    if (serverProcess.exitCode === null) {
      serverProcess.kill('SIGKILL');
    }
  }
  serverProcess = null;
  if (tmpDir) {
    try {
      const fs = await import('node:fs');
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
  tmpDir = null;
}
