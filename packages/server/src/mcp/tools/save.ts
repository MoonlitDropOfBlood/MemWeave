import { z } from 'zod';
import type { McpTool } from '../registry.js';

export const saveTool: McpTool = {
  name: 'memory_save',
  description: 'Save an insight, decision, or fact to long-term memory.',
  inputSchema: {
    content: z.string().min(1).max(100_000).describe('The memory content (max 100000 chars)'),
    type: z.enum(['fact', 'decision', 'preference', 'event', 'project_context', 'lesson', 'code_pattern', 'bug', 'workflow']).optional()
      .describe('Memory type (auto-detected if omitted)'),
    title: z.string().min(1).max(120).describe('Short title'),
    concepts: z.array(z.string().min(1).max(100)).max(50).optional().describe('Searchable keywords (max 50)'),
    files: z.array(z.string().min(1).max(500)).max(50).optional().describe('Associated file paths (max 50)'),
    scopeLevel: z.enum(['global', 'project']).optional().describe('Scope level'),
    scopes: z.array(z.object({ key: z.string(), value: z.string() })).optional().describe('Scope tags'),
    importance: z.number().int().min(1).max(10).optional().describe('1-10 importance')
  },
  handler: async (service, args) => {
    return service.createMemory(args);
  }
};
