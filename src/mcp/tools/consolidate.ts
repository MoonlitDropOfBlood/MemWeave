import { z } from 'zod';
import type { McpTool } from '../registry.js';

export const consolidateTool: McpTool = {
  name: 'memory_consolidate',
  description: 'Run the memory consolidation pipeline.',
  inputSchema: {
    tier: z.enum(['short', 'medium', 'long', 'all']).optional().describe('Which tier to consolidate'),
    dryRun: z.boolean().optional().describe('Preview without making changes')
  },
  handler: async (client, args) => {
    return client.request('POST', '/api/v1/consolidate', args, z.any());
  }
};
