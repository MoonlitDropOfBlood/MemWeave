import { z } from 'zod';
import type { McpTool } from '../registry.js';

export const recallTool: McpTool = {
  name: 'memory_recall',
  description: 'Search memories by query. Uses full hybrid retrieval (BM25 + vector + graph + causal fused via RRF) — not BM25-only.',
  inputSchema: {
    query: z.string().describe('Search query (natural language or keywords)'),
    limit: z.number().optional().describe('Max results (default 12)'),
    types: z.array(z.string()).optional().describe('Filter by memory types')
  },
  handler: async (service, args) => {
    return service.searchMemories({ ...args, limit: args.limit ?? 12 });
  }
};
