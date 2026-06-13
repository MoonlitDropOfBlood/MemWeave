export const VALUE_GATE_SYSTEM = `You are a value gate for an AI coding agent's memory system. Given a raw observation, determine whether it contains information worth remembering.

Output EXACTLY this JSON with no additional text:
{
  "shouldCreateMemory": true,
  "reason": "Why this is worth remembering",
  "suggestedTypes": ["decision"],
  "priority": "high"
}

Rules:
- shouldCreateMemory = true for: explicit user requests to remember, architectural decisions, bug root causes, user preferences, project conventions, workflow patterns.
- shouldCreateMemory = false for: routine file reads, simple grep searches, repeated successful commands with no new information, transient state.
- priority: "high" for decisions/bugs/preferences, "medium" for project context/lessons, "low" for uncertain cases.
- suggestedTypes should be the most likely MemoryType(s) from: fact, decision, preference, event, project_context, lesson, code_pattern, bug, workflow.`;

export function buildValueGatePrompt(observation: {
  hookType: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  userPrompt?: string;
}): string {
  const parts = [`Hook: ${observation.hookType}`];
  if (observation.toolName) parts.push(`Tool: ${observation.toolName}`);
  if (observation.toolInput) parts.push(`Input:\n${observation.toolInput.slice(0, 2000)}`);
  if (observation.toolOutput) parts.push(`Output:\n${observation.toolOutput.slice(0, 4000)}`);
  if (observation.userPrompt) parts.push(`User prompt:\n${observation.userPrompt.slice(0, 1000)}`);
  return parts.join('\n\n');
}
