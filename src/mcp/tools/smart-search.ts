import { z } from 'zod';
import type { McpTool } from '../registry.js';

export const smartSearchTool: McpTool = {
  name: 'memory_smart_search',
  description: 'Hybrid semantic+keyword search with progressive disclosure.',
  inputSchema: {
    query: z.string().describe('Search query'),
    limit: z.number().optional().describe('Max results (default 8)'),
    types: z.array(z.string()).optional().describe('Filter by memory types'),
    includeGraph: z.boolean().optional().describe('Include graph expansion'),
    includeCausal: z.boolean().optional().describe('Include causal chain recall'),
    mode: z.enum(['compact', 'full']).optional().describe('Result detail level')
  },
  handler: async (client, args) => {
    return client.request('POST', '/api/v1/memories/search', { ...args, mode: args.mode ?? 'compact' }, z.any());
  }
};
