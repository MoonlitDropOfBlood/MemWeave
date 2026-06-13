import { z } from 'zod';
import type { McpTool } from '../registry.js';

export const saveTool: McpTool = {
  name: 'memory_save',
  description: 'Save an insight, decision, or fact to long-term memory.',
  inputSchema: {
    content: z.string().describe('The memory content'),
    type: z.enum(['fact', 'decision', 'preference', 'event', 'project_context', 'lesson', 'code_pattern', 'bug', 'workflow']).optional().describe('Memory type (auto-detected if omitted)'),
    title: z.string().optional().describe('Short title'),
    concepts: z.array(z.string()).optional().describe('Searchable keywords'),
    files: z.array(z.string()).optional().describe('Associated file paths'),
    scopeLevel: z.enum(['global', 'project']).optional().describe('Scope level'),
    scopes: z.array(z.object({ key: z.string(), value: z.string() })).optional().describe('Scope tags'),
    importance: z.number().optional().describe('1-10 importance')
  },
  handler: async (client, args) => {
    return client.createMemory(args as Record<string, unknown>);
  }
};
