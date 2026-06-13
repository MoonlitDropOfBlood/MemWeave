import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CliError, parseCli, type CliCommand } from '../packages/server/src/cli.js';
import { helpCommand } from '../packages/server/src/commands/help.js';
import { versionCommand } from '../packages/server/src/commands/version.js';
import { initCommand } from '../packages/server/src/commands/init.js';
import { migrateCommand } from '../packages/server/src/commands/migrate.js';
import { backupCommand } from '../packages/server/src/commands/backup.js';
import { loadConfig } from '../packages/server/src/core/config.js';

describe('parseCli', () => {
  it('parses known commands', () => {
    const cases: Array<[string[], CliCommand, string[]]> = [
      [['node', 'memweave', 'start'], 'start', []],
      [['node', 'memweave', 'stop'], 'stop', []],
      [['node', 'memweave', 'status'], 'status', []],
      [['node', 'memweave', 'init'], 'init', []],
      [['node', 'memweave', 'doctor'], 'doctor', []],
      [['node', 'memweave', 'migrate'], 'migrate', []],
      [['node', 'memweave', 'backup', '/tmp/x.db'], 'backup', ['/tmp/x.db']],
      [['node', 'memweave', 'help'], 'help', []],
      [['node', 'memweave', 'version'], 'version', []]
    ];
    for (const [argv, cmd, args] of cases) {
      const parsed = parseCli(argv);
      expect(parsed.command).toBe(cmd);
      expect(parsed.args).toEqual(args);
    }
  });

  it('maps --help and -h to help', () => {
    expect(parseCli(['node', 'memweave', '--help']).command).toBe('help');
    expect(parseCli(['node', 'memweave', '-h']).command).toBe('help');
    expect(parseCli(['node', 'memweave']).command).toBe('help');
  });

  it('maps --version and -v to version', () => {
    expect(parseCli(['node', 'memweave', '--version']).command).toBe('version');
    expect(parseCli(['node', 'memweave', '-v']).command).toBe('version');
    expect(parseCli(['node', 'memweave', 'version']).command).toBe('version');
  });

  it('throws CliError for unknown command', () => {
    expect(() => parseCli(['node', 'memweave', 'frobnicate'])).toThrow(CliError);
  });
});

describe('CliError', () => {
  it('is a proper Error subclass', () => {
    const err = new CliError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CliError');
    expect(err.message).toBe('test');
  });
});

describe('helpCommand', () => {
  it('returns the help text', async () => {
    const res = await helpCommand({ env: process.env, args: [] });
    expect(res.ok).toBe(true);
    expect(res.message).toContain('memweave <command>');
    expect(res.message).toContain('start');
    expect(res.message).toContain('stop');
  });
});

describe('versionCommand', () => {
  it('reads the version from package.json', async () => {
    const res = await versionCommand({ env: process.env, args: [] });
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/^memweave /);
  });
});

let tmpHome: string;
let configPath: string;
let dbPath: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'memweave-cli-'));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  configPath = join(tmpHome, '.memweave', 'config.jsonc');
  dbPath = join(tmpHome, '.memweave', 'data', 'memweave.db');
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  try { rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('initCommand', () => {
  it('creates a config file and DB', async () => {
    const res = await initCommand({ env: process.env, args: [] });
    expect(res.ok).toBe(true);
    expect(existsSync(configPath)).toBe(true);
    const cfg = loadConfig(configPath);
    expect(cfg.server.port).toBe(3131);
    const initRes = res.data as { configPath: string; dbPath: string };
    expect(initRes.dbPath).toBe(dbPath);
  });
});

describe('migrateCommand', () => {
  it('applies the schema and runs a dry-run consolidation', async () => {
    await initCommand({ env: process.env, args: [] });
    const res = await migrateCommand({ env: process.env, args: [] });
    expect(res.ok).toBe(true);
    const data = res.data as { tableCount: number; consolidationPreview: { promoted: number; evicted: number } };
    expect(data.tableCount).toBeGreaterThan(0);
  });
});

describe('backupCommand', () => {
  it('copies the DB to a destination path', async () => {
    await initCommand({ env: process.env, args: [] });
    const dest = join(tmpHome, 'backups', 'test.db');
    const res = await backupCommand({ env: process.env, args: [dest] });
    expect(res.ok).toBe(true);
    expect(existsSync(dest)).toBe(true);
    const data = res.data as { source: string; dest: string; size: number };
    expect(data.size).toBeGreaterThan(0);
  });

  it('generates a default destination when none is given', async () => {
    await initCommand({ env: process.env, args: [] });
    const res = await backupCommand({ env: process.env, args: [] });
    expect(res.ok).toBe(true);
    const data = res.data as { dest: string };
    expect(data.dest).toContain('.backup-');
  });

  it('returns error when DB does not exist', async () => {
    const res = await backupCommand({ env: process.env, args: [join(tmpHome, 'no-such.db')] });
    expect(res.ok).toBe(false);
  });

  it('rejects `mcp` subcommand with a helpful migration message', () => {
    // v0.2 removed the `mcp` subcommand. Users who try it should get a
    // clear pointer to the @mem-weave/mcp package.
    expect(() => parseCli(['node', 'memweave', 'mcp'])).toThrow(/removed in v0\.2/);
    expect(() => parseCli(['node', 'memweave', 'mcp'])).toThrow(/@mem-weave\/mcp/);
  });
});
