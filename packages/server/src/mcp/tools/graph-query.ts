import { z } from 'zod';
import type { McpTool } from '../registry.js';

export const graphQueryTool: McpTool = {
  name: 'memory_graph_query',
  description: 'Walk the relationship graph around a memory.',
  inputSchema: {
    memoryId: z.string().describe('Starting memory ID'),
    depth: z.number().min(1).max(3).optional().describe('Traversal depth (1-3)'),
    direction: z.enum(['in', 'out', 'both']).optional().describe('Edge direction'),
    limit: z.number().optional().describe('Max results')
  },
  handler: async (service, args) => {
    return service.graphQuery(args.memoryId as string, {
      depth: typeof args.depth === 'number' ? args.depth : undefined,
      direction: typeof args.direction === 'string' ? args.direction as 'in' | 'out' | 'both' : undefined,
      limit: typeof args.limit === 'number' ? args.limit : undefined
    });
  }
};
