import { z } from 'zod';
import type { McpTool } from '../registry.js';

export const forgetTool: McpTool = {
  name: 'memory_forget',
  description: 'Soft-delete memories with audit trail. Hard delete is available via dev tooling only.',
  inputSchema: {
    memoryIds: z.array(z.string()).min(1).describe('Memory IDs to delete'),
    reason: z.string().describe('Reason for deletion (stored in audit log)'),
    hardDelete: z.boolean().optional().describe('Bypass soft delete (default false)')
  },
  handler: async (service, args) => {
    const ids = args.memoryIds as string[];
    const out: Array<{ memoryId: string; ok: boolean; error?: string }> = [];
    for (const id of ids) {
      try {
        await service.deleteMemory(id);
        out.push({ memoryId: id, ok: true });
      } catch (err) {
        out.push({ memoryId: id, ok: false, error: (err as Error).message });
      }
    }
    return { results: out, reason: args.reason };
  }
};
