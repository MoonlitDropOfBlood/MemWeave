import { z } from 'zod';
import type { McpTool } from '../registry.js';

export const forgetTool: McpTool = {
  name: 'memory_forget',
  description: 'Delete specific memories with audit trail.',
  inputSchema: {
    memoryIds: z.array(z.string()).describe('Memory IDs to delete'),
    reason: z.string().describe('Reason for deletion'),
    hardDelete: z.boolean().optional().describe('Bypass soft delete')
  },
  handler: async (client, args) => {
    const ids = (args.memoryIds as string[]).join(',');
    return client.request('DELETE', `/api/v1/memories/${encodeURIComponent(ids)}`, args, z.any());
  }
};
