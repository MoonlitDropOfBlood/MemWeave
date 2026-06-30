import { z } from 'zod';
import type { McpTool } from '../registry.js';

export const profileUpdateTool: McpTool = {
  name: 'memory_profile_update',
  description: 'Add traits / rewrite the summary of the user profile. Traits are MERGED into the existing set (additive, deduped) — not overwritten. The summary REPLACES the old one when provided. Use when you learn something durable about the user (preferences, role, tech stack, working style).',
  inputSchema: {
    userKey: z.string().optional().describe('Profile key (default "default")'),
    traits: z.array(z.string()).optional().describe('User traits to ADD (e.g. ["prefers TypeScript", "backend engineer", "uses pnpm"])'),
    summary: z.string().optional().describe('A new natural-language summary of the user (replaces existing)')
  },
  handler: async (service, args) => {
    return service.updateProfile({
      userKey: (args.userKey as string | undefined) ?? 'default',
      traits: args.traits as string[] | undefined,
      summary: args.summary as string | undefined
    });
  }
};