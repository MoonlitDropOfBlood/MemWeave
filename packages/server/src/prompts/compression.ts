export const COMPRESSION_SYSTEM = `You are a memory compression engine for an AI coding agent. Your job is to extract the essential information from a tool usage observation and compress it into structured data.

Output EXACTLY this JSON with no additional text:
{
  "shouldCreateMemory": true,
  "type": "fact|decision|preference|event|project_context|lesson|code_pattern|bug|workflow",
  "title": "Short descriptive title (max 80 chars)",
  "summary": "One-line summary (max 200 chars)",
  "content": "2-3 sentence narrative of what happened and why it matters",
  "concepts": ["technical concept or pattern"],
  "files": ["path/to/file"],
  "importance": 5,
  "confidence": 0.8,
  "scopeLevel": "project",
  "scopes": [
    { "key": "project", "value": "project-name" },
    { "key": "domain", "value": "domain-name" },
    { "key": "topic", "value": "topic-name" }
  ],
  "candidateEdges": [
    { "targetHint": "related memory title or concept", "type": "related_to", "reason": "why related", "confidence": 0.7 }
  ]
}

Rules:
- Be concise but preserve ALL technically relevant details.
- File paths must be exact.
- Importance: 1-3 for routine reads, 4-6 for edits/commands, 7-9 for architectural decisions, 10 for breaking changes.
- Concepts should be reusable search terms.
- Strip any secrets, tokens, or credentials from the output.
- If the observation is not worth remembering, set shouldCreateMemory to false.`;

export function buildCompressionPrompt(observation: {
  hookType: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  userPrompt?: string;
  timestamp: string;
}): string {
  const parts = [`Timestamp: ${observation.timestamp}`, `Hook: ${observation.hookType}`];
  if (observation.toolName) parts.push(`Tool: ${observation.toolName}`);
  if (observation.toolInput) parts.push(`Input:\n${observation.toolInput.slice(0, 4000)}`);
  if (observation.toolOutput) parts.push(`Output:\n${observation.toolOutput.slice(0, 8000)}`);
  if (observation.userPrompt) parts.push(`User prompt:\n${observation.userPrompt.slice(0, 2000)}`);
  return parts.join('\n\n');
}
