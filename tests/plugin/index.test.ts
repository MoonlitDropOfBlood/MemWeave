import { describe, expect, it } from 'vitest';
import { resolveMcpServerCommand, MemweaveInjectPlugin } from '../../packages/opencode-plugin/src/index.js';

describe('plugin/index smoke', () => {
  describe('resolveMcpServerCommand', () => {
    it('returns `npx --yes @mem-weave/mcp` (published package entry)', () => {
      const cmd = resolveMcpServerCommand('/any/dir');
      expect(cmd).toEqual(['npx', '--yes', '@mem-weave/mcp']);
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
      const ctx = { directory: '/fake/repo/src/plugin' } as unknown as Parameters<typeof MemweaveInjectPlugin>[0];
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
      expect(mcpEntry.command).toEqual(['npx', '--yes', '@mem-weave/mcp']);
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
