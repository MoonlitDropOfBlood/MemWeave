import { z } from 'zod';
import type { McpTool } from '../registry.js';

export const consolidateTool: McpTool = {
  name: 'memory_consolidate',
  description: 'Manually trigger a consolidation ("sleep") cycle. Runs promotion, eviction, and merge.',
  inputSchema: {
    tier: z.enum(['short', 'medium', 'long', 'all']).optional().describe('Which tier to consolidate (default all)'),
    dryRun: z.boolean().optional().describe('Preview without making changes (default false)')
  },
  handler: async (service, args) => {
    return service.triggerConsolidation({
      tier: args.tier as 'short' | 'medium' | 'long' | 'all' | undefined,
      dryRun: args.dryRun === true
    });
  }
};
