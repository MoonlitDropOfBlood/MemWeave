import { z } from 'zod';
import type { McpTool } from '../registry.js';
import { GraphResponseSchema } from '../client.js';

export const graphQueryTool: McpTool = {
  name: 'memory_graph_query',
  description: 'Query the relationship graph around a memory.',
  inputSchema: {
    memoryId: z.string().describe('Starting memory ID'),
    depth: z.number().optional().describe('Traversal depth (1-3)'),
    edgeTypes: z.array(z.string()).optional().describe('Filter by edge types'),
    direction: z.enum(['in', 'out', 'both']).optional().describe('Edge direction'),
    limit: z.number().optional().describe('Max results')
  },
  handler: async (client, args) => {
    return client.request('GET', `/api/v1/memories/${encodeURIComponent(args.memoryId as string)}/graph`, args, GraphResponseSchema);
  }
};
