import type { CliContext, CommandResult, CommandHandler } from './index.js';

/**
 * `memweave mcp` — start the stdio MCP shim.
 *
 * Delegates to the existing `src/mcp/index.ts` entry. The shim will
 * block on stdin/stdout until the parent process closes the pipes.
 */
export const mcpCommand: CommandHandler = async (_ctx: CliContext): Promise<CommandResult> => {
  await import('../mcp/index.js');
  // The MCP entry awaits forever on stdio; if it returns, the shim exited.
  return { ok: true, message: 'MCP shim exited.' };
};
