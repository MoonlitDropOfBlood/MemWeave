import { z } from 'zod';
import type { McpTool } from '../registry.js';

export const patternsTool: McpTool = {
  name: 'memory_patterns',
  description: 'Detect recurring patterns across sessions.',
  inputSchema: {
    type: z.string().optional().describe('Filter by memory type'),
    sinceDays: z.number().optional().describe('Look back period in days'),
    limit: z.number().optional().describe('Max results')
  },
  handler: async (client, args) => {
    return client.request('POST', '/api/v1/memories/search', { query: 'pattern', ...args, limit: args.limit ?? 10 }, z.any());
  }
};
