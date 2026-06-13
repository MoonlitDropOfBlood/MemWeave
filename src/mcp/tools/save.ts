import { z } from 'zod';
import type { McpTool } from '../registry.js';
import { MEMORY_LIMITS } from '../../core/types.js';

export const saveTool: McpTool = {
  name: 'memory_save',
  description: 'Save an insight, decision, or fact to long-term memory.',
  inputSchema: {
    content: z.string().min(1).max(MEMORY_LIMITS.CONTENT_MAX)
      .describe(`The memory content (max ${MEMORY_LIMITS.CONTENT_MAX} chars)`),
    type: z.enum(['fact', 'decision', 'preference', 'event', 'project_context', 'lesson', 'code_pattern', 'bug', 'workflow']).optional().describe('Memory type (auto-detected if omitted)'),
    title: z.string().min(1).max(120).optional().describe('Short title'),
    concepts: z.array(z.string().min(1).max(100)).max(MEMORY_LIMITS.CONCEPTS_MAX).optional()
      .describe(`Searchable keywords (max ${MEMORY_LIMITS.CONCEPTS_MAX} entries)`),
    files: z.array(z.string().min(1).max(500)).max(MEMORY_LIMITS.FILES_MAX).optional()
      .describe(`Associated file paths (max ${MEMORY_LIMITS.FILES_MAX} entries)`),
    scopeLevel: z.enum(['global', 'project']).optional().describe('Scope level'),
    scopes: z.array(z.object({ key: z.string(), value: z.string() })).optional().describe('Scope tags'),
    importance: z.number().int().min(1).max(10).optional().describe('1-10 importance')
  },
  handler: async (client, args) => {
    return client.createMemory(args as Record<string, unknown>);
  }
};
