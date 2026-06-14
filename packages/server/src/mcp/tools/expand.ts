import { z } from 'zod';
import type { McpTool } from '../registry.js';

export const expandTool: McpTool = {
  name: 'memory_expand',
  description: 'Expand a compact memory into full detail with graph neighbors and causal chain. Closes the progressive-disclosure loop.',
  inputSchema: {
    memoryId: z.string().describe('Memory ID to expand'),
    includeGraph: z.boolean().optional().describe('Include graph neighbors (default true)'),
    includeCausal: z.boolean().optional().describe('Include causal chain (default true)')
  },
  handler: async (service, args) => {
    const m = await service.getMemory(args.memoryId as string);
    if (!m) return { ok: false, error: `memory not found: ${args.memoryId}` };
    const out: Record<string, unknown> = { memory: m };
    if (args.includeGraph !== false) {
      try {
        out.graph = await service.graphQuery(args.memoryId as string, { depth: 1, direction: 'both' });
      } catch (err) {
        out.graph = { error: (err as Error).message };
      }
    }
    return out;
  }
};
