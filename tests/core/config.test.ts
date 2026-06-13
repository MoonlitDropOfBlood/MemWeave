import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultConfig, expandEnv, expandPath, loadConfig, resolveEnvPlaceholders } from '../../src/core/config.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'memweave-cfg-'));
});

afterEach(() => {
  // tmpDir cleanup is automatic
});

describe('defaultConfig()', () => {
  it('returns sensible defaults when no file is given', () => {
    const cfg = defaultConfig();
    expect(cfg.server.host).toBe('127.0.0.1');
    expect(cfg.server.port).toBe(3131);
    expect(cfg.storage.path).toBe('~/.memweave/data/memweave.db');
    expect(cfg.auth.deviceApiKey).toBe('dev-local-key');
    expect(cfg.auth.requireAuth).toBe(false);
    expect(cfg.embedding.provider).toBe('noop');
    expect(cfg.embedding.dimensions).toBe(768);
    expect(cfg.llm.provider).toBe('noop');
    expect(cfg.consolidation.enabled).toBe(true);
    expect(cfg.consolidation.intervalHours).toBe(6);
    expect(cfg.injection.sessionStartBudget).toBe(1200);
    expect(cfg.search.rrfK).toBe(60);
    expect(cfg.search.bm25Only).toBe(false);
  });
});

describe('loadConfig()', () => {
  it('returns defaults when path is undefined', () => {
    const cfg = loadConfig();
    expect(cfg.server.port).toBe(3131);
    expect(cfg.embedding.provider).toBe('noop');
  });

  it('merges a partial config file with defaults', () => {
    const p = join(tmpDir, 'config.jsonc');
    writeFileSync(p, JSON.stringify({ server: { port: 4000 } }));
    const cfg = loadConfig(p);
    expect(cfg.server.port).toBe(4000);
    expect(cfg.server.host).toBe('127.0.0.1'); // default
    expect(cfg.embedding.provider).toBe('noop'); // default
  });

  it('parses a full config file', () => {
    const p = join(tmpDir, 'config.jsonc');
    writeFileSync(p, JSON.stringify({
      server: { host: '0.0.0.0', port: 9090 },
      storage: { path: '/tmp/m.db' },
      embedding: { provider: 'openai-compatible', model: 'text-embedding-3-small', dimensions: 1536 },
      llm: { provider: 'openai-compatible', model: 'gpt-4o', temperature: 0.5 },
      consolidation: { enabled: true, intervalHours: 1 },
      injection: { sessionStartBudget: 2000 },
      search: { bm25Only: true }
    }));
    const cfg = loadConfig(p);
    expect(cfg.server.host).toBe('0.0.0.0');
    expect(cfg.server.port).toBe(9090);
    expect(cfg.storage.path).toBe('/tmp/m.db');
    expect(cfg.embedding.provider).toBe('openai-compatible');
    expect(cfg.embedding.dimensions).toBe(1536);
    expect(cfg.llm.model).toBe('gpt-4o');
    expect(cfg.llm.temperature).toBe(0.5);
    expect(cfg.consolidation.intervalHours).toBe(1);
    expect(cfg.injection.sessionStartBudget).toBe(2000);
    expect(cfg.search.bm25Only).toBe(true);
  });

  it('throws a clear error on invalid JSON syntax', () => {
    const p = join(tmpDir, 'bad.jsonc');
    writeFileSync(p, '{ this is not valid }');
    expect(() => loadConfig(p)).toThrow(/Invalid config file/);
  });

  it('throws when a required numeric field is below bounds', () => {
    const p = join(tmpDir, 'bad.jsonc');
    writeFileSync(p, JSON.stringify({ server: { port: 999999 } }));
    expect(() => loadConfig(p)).toThrow();
  });
});

describe('expandEnv()', () => {
  it('passes through non-placeholder strings', () => {
    expect(expandEnv('plain-string')).toBe('plain-string');
  });

  it('resolves env:// references from process.env', () => {
    process.env.MEMWEAVE_TEST_FOO = 'hello';
    expect(expandEnv('env://MEMWEAVE_TEST_FOO')).toBe('hello');
    delete process.env.MEMWEAVE_TEST_FOO;
  });

  it('throws when env var is missing', () => {
    expect(() => expandEnv('env://MEMWEAVE_DEFINITELY_NOT_SET_XYZ')).toThrow(/Missing environment variable/);
  });
});

describe('resolveEnvPlaceholders()', () => {
  it('walks nested objects and arrays', () => {
    process.env.MEMWEAVE_TEST_BAR = 'world';
    const result = resolveEnvPlaceholders({
      a: 'env://MEMWEAVE_TEST_BAR',
      b: { c: 'env://MEMWEAVE_TEST_BAR', d: 42 },
      e: ['env://MEMWEAVE_TEST_BAR', 'plain']
    });
    expect(result).toEqual({
      a: 'world',
      b: { c: 'world', d: 42 },
      e: ['world', 'plain']
    });
    delete process.env.MEMWEAVE_TEST_BAR;
  });
});

describe('expandPath()', () => {
  it('expands ~ to home directory', () => {
    const expanded = expandPath('~/foo');
    expect(expanded).not.toContain('~');
  });

  it('resolves absolute paths', () => {
    expect(expandPath('/tmp/bar')).toContain('bar');
  });
});
