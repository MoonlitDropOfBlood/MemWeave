import { z } from 'zod';
import type { McpTool } from '../registry.js';

export const createEdgeTool: McpTool = {
  name: 'memory_create_edge',
  description: 'Create an explicit relationship (edge) between two memories. Use when you know two memories are related and want that link discoverable via graph/causal retrieval. More reliable than waiting for background edge extraction.',
  inputSchema: {
    fromMemoryId: z.string().describe('The source memory id'),
    toMemoryId: z.string().describe('The target memory id'),
    type: z.enum([
      'causes', 'enables', 'contradicts', 'supersedes',
      'references', 'related_to', 'before', 'after',
      'duplicates', 'refines'
    ]).describe('The relationship type'),
    reason: z.string().optional().describe('Why these memories are related (free text)'),
    strength: z.number().min(0).max(1).optional().describe('Edge strength 0-1 (default 0.7)')
  },
  handler: async (service, args) => {
    return service.createEdge({
      fromMemoryId: args.fromMemoryId as string,
      toMemoryId: args.toMemoryId as string,
      type: args.type as never,
      reason: args.reason as string | undefined,
      strength: args.strength as number | undefined
    });
  }
};