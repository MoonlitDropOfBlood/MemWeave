import { z } from 'zod';
import type { McpTool } from '../registry.js';

export const fileHistoryTool: McpTool = {
  name: 'memory_file_history',
  description: 'Get past observations about specific files.',
  inputSchema: {
    filePath: z.string().describe('File path to query'),
    limit: z.number().optional().describe('Max results'),
    includeBugs: z.boolean().optional().describe('Include bug memories'),
    includePatterns: z.boolean().optional().describe('Include code pattern memories')
  },
  handler: async (service, args) => {
    // Simplified: search by file path. Full file_history view is a thin
    // wrapper around the same search; we forward the most relevant
    // knobs and let retrieval/normalize the result.
    return service.searchMemories({
      query: args.filePath as string,
      limit: typeof args.limit === 'number' ? args.limit : 10
    });
  }
};
