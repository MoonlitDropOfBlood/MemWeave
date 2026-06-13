import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { resolveMcpServerCommand, MemweaveInjectPlugin } from '../../src/plugin/index.js';

describe('plugin/index smoke', () => {
  describe('resolveMcpServerCommand', () => {
    it('returns a 4-element command array; the 4th element is <pluginDir>/../mcp/index.ts (cross-platform)', () => {
      // Use a real absolute path the test runner can reproduce on any OS.
      // path.resolve('src/plugin') returns the cwd-relative form on POSIX
      // and drive-prefixed form on Windows — that's exactly what the
      // plugin body does internally, so the comparison is apples-to-apples.
      const fakePluginDir = resolve('fake/repo/src/plugin');
      const expectedMcpEntry = resolve('fake/repo/src/mcp/index.ts');

      const cmd = resolveMcpServerCommand(fakePluginDir);
      expect(cmd).toHaveLength(4);
      expect(cmd[0]).toBe('npx');
      expect(cmd[1]).toBe('--yes');
      expect(cmd[2]).toBe('tsx');
      expect(cmd[3]).toBe(expectedMcpEntry);
    });

    it('resolves a Windows-style plugin dir to an absolute mcp path', () => {
      const fakePluginDir = 'D:\\fake\\repo\\src\\plugin';
      const cmd = resolveMcpServerCommand(fakePluginDir);
      // After the .. hop, the result is the mcp entry under the same
      // drive/prefix. Just assert shape.
      const normalized = cmd[3].replace(/\\/g, '/');
      expect(normalized.endsWith('/src/mcp/index.ts')).toBe(true);
      expect(normalized).not.toContain('..');
    });
  });

  describe('MemweaveInjectPlugin', () => {
    it('is exported as a function (Plugin shape)', () => {
      expect(typeof MemweaveInjectPlugin).toBe('function');
    });

    it('returns hooks containing config + the two hook callbacks when called with a stub ctx', async () => {
      // We don't need a real OpenCode context — the plugin only reads
      // `ctx.directory` (inside resolveMcpServerCommand). Cast to unknown
      // first to bypass the wider PluginInput shape (which includes a SDK
      // client we don't need).
      const ctx = { directory: '/fake/repo/src/plugin' } as unknown as Parameters<typeof MemweaveInjectPlugin>[0];

      const hooks = await MemweaveInjectPlugin(ctx);

      // The three surfaces that make the progressive-disclosure loop work.
      expect(hooks.config).toBeTypeOf('function');
      expect(hooks['experimental.chat.system.transform']).toBeTypeOf('function');
      expect(hooks['tool.execute.before']).toBeTypeOf('function');
    });

    it('config hook registers mcp["memweave"] with the right command', async () => {
      const fakePluginDir = resolve('fake/repo/src/plugin');
      const expectedMcpEntry = resolve('fake/repo/src/mcp/index.ts');
      const ctx = { directory: fakePluginDir } as unknown as Parameters<typeof MemweaveInjectPlugin>[0];
      const hooks = await MemweaveInjectPlugin(ctx);

      // Simulate OpenCode calling the config hook. The SDK's Config type
      // is wide; we type-erase with `unknown` to focus on behavior.
      const config: { mcp: Record<string, unknown> } = { mcp: {} };
      await hooks.config!(config as unknown as Parameters<NonNullable<typeof hooks.config>>[0]);

      expect(config.mcp['memweave']).toBeDefined();
      const mcpEntry = config.mcp['memweave'] as {
        type: string;
        command: string[];
        environment: Record<string, string>;
        enabled: boolean;
        timeout: number;
      };
      expect(mcpEntry.type).toBe('local');
      expect(mcpEntry.command[0]).toBe('npx');
      expect(mcpEntry.command[1]).toBe('--yes');
      expect(mcpEntry.command[2]).toBe('tsx');
      expect(mcpEntry.command[3]).toBe(expectedMcpEntry);
      expect(mcpEntry.environment.MEMWEAVE_URL).toMatch(/^https?:\/\//);
      expect(mcpEntry.enabled).toBe(true);
      expect(mcpEntry.timeout).toBe(30000);
    });

    it('config hook refuses to clobber a pre-existing non-local mcp["memweave"]', async () => {
      const ctx = { directory: '/fake/repo/src/plugin' } as unknown as Parameters<typeof MemweaveInjectPlugin>[0];
      const hooks = await MemweaveInjectPlugin(ctx);

      const config: { mcp: Record<string, unknown> } = {
        mcp: {
          memweave: { type: 'remote', url: 'https://other.example.com' }
        }
      };
      await hooks.config!(config as unknown as Parameters<NonNullable<typeof hooks.config>>[0]);

      // The pre-existing entry should be untouched.
      expect(config.mcp['memweave']).toEqual({ type: 'remote', url: 'https://other.example.com' });
    });
  });
});
