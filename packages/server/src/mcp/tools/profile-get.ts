import { z } from 'zod';
import type { McpTool } from '../registry.js';

export const profileGetTool: McpTool = {
  name: 'memory_profile_get',
  description: 'Retrieve the current user profile (traits + summary). Returns null if no profile has been set yet. The profile is injected into the system prompt as an <about-user> section on every session start, so the agent knows the user without asking.',
  inputSchema: {
    userKey: z.string().optional().describe('Profile key (default "default" — the single-user case)')
  },
  handler: async (service, args) => {
    return service.getProfile((args.userKey as string | undefined) ?? 'default');
  }
};