import { z } from 'zod';
import type { McpTool } from '../registry.js';

export const recallTool: McpTool = {
  name: 'memory_recall',
  description: 'Search past observations by keywords (BM25 layer).',
  inputSchema: {
    query: z.string().describe('Search query'),
    limit: z.number().optional().describe('Max results (default 5)'),
    types: z.array(z.string()).optional().describe('Filter by memory types')
  },
  handler: async (service, args) => {
    return service.searchMemories({ ...args, includeGraph: false, includeCausal: false });
  }
};
