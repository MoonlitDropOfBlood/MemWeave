import { z } from 'zod';
import type { McpTool } from '../registry.js';
import { SearchResponseSchema } from '../client.js';

export const fileHistoryTool: McpTool = {
  name: 'memory_file_history',
  description: 'Get past observations about specific files.',
  inputSchema: {
    filePath: z.string().describe('File path to query'),
    limit: z.number().optional().describe('Max results'),
    types: z.array(z.string()).optional().describe('Filter by memory types'),
    includeBugs: z.boolean().optional().describe('Include bug memories'),
    includePatterns: z.boolean().optional().describe('Include code pattern memories')
  },
  handler: async (client, args) => {
    return client.request('POST', '/api/v1/memories/search', { query: args.filePath, types: args.types, limit: args.limit ?? 10 }, SearchResponseSchema);
  }
};
