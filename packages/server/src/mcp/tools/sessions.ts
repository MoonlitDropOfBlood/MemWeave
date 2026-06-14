import { z } from 'zod';
import type { McpTool } from '../registry.js';

export const sessionsTool: McpTool = {
  name: 'memory_sessions',
  description: 'List recent sessions with observation counts.',
  inputSchema: {
    limit: z.number().optional().describe('Max sessions (default 10)'),
    project: z.string().optional().describe('Filter by project'),
    sourceClient: z.string().optional().describe('Filter by client type')
  },
  handler: async (service, args) => {
    return service.listSessions({ limit: typeof args.limit === 'number' ? args.limit : undefined });
  }
};
