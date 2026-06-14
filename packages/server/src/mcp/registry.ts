import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpService } from './service.js';
import type { z } from 'zod';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  handler: (service: McpService, args: Record<string, unknown>) => Promise<unknown>;
}

export function registerTools(server: McpServer, service: McpService, tools: McpTool[]): void {
  for (const tool of tools) {
    server.tool(
      tool.name,
      tool.description,
      tool.inputSchema,
      async (args) => {
        try {
          const result = await tool.handler(service, args);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: message }) }], isError: true };
        }
      }
    );
  }
}
