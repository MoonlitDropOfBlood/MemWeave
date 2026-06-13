import { z } from 'zod';
import type { McpTool } from '../registry.js';

export const expandTool: McpTool = {
  name: 'memory_expand',
  description: 'Expand a compact memory into full detail with graph and causal chain.',
  inputSchema: {
    memoryId: z.string().describe('Memory ID to expand'),
    includeGraph: z.boolean().optional().describe('Include graph neighbors'),
    includeCausal: z.boolean().optional().describe('Include causal chain')
  },
  handler: async (client, args) => {
    return client.getMemory(args.memoryId as string);
  }
};
