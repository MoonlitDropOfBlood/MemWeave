import { z } from 'zod';
import type { McpTool } from '../registry.js';

export const patternsTool: McpTool = {
  name: 'memory_patterns',
  description: 'Detect recurring patterns across sessions.',
  inputSchema: {
    type: z.string().optional().describe('Filter by memory type'),
    sinceDays: z.number().optional().describe('Look back period in days'),
    limit: z.number().optional().describe('Max results')
  },
  handler: async (service, args) => {
    // Pattern detection is layered on top of search: we ask the search
    // engine for a broad set of recent memories and let the caller
    // (LLM) spot the pattern. Cheaper than running a dedicated pass
    // server-side and good enough for the use case.
    return service.searchMemories({
      query: '*',
      limit: typeof args.limit === 'number' ? args.limit : 20,
      ...(typeof args.type === 'string' ? { types: [args.type] } : {})
    });
  }
};
