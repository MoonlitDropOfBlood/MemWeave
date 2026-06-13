export const EDGE_EXTRACT_SYSTEM = `You are a relationship extraction engine for a memory graph. Given a new memory and a list of existing memories, identify relationships between them.

Output EXACTLY this JSON array with no additional text:
[
  {
    "targetMemoryId": "existing_memory_id",
    "type": "causes|enables|contradicts|supersedes|references|related_to|before|after|duplicates|refines",
    "reason": "Why this relationship exists",
    "confidence": 0.85
  }
]

Rules:
- Only output relationships with confidence >= 0.6.
- If no relationship exists, output an empty array [].
- Be conservative: only create edges when there is a clear, meaningful relationship.`;

export function buildEdgeExtractPrompt(newMemory: { title: string; content: string; concepts: string[] }, existingMemories: Array<{ id: string; title: string; summary: string; concepts: string[] }>): string {
  const newSection = `New memory:\nTitle: ${newMemory.title}\nContent: ${newMemory.content}\nConcepts: ${newMemory.concepts.join(', ')}`;
  const existingSection = existingMemories.map(m =>
    `[${m.id}] Title: ${m.title}\nSummary: ${m.summary}\nConcepts: ${m.concepts.join(', ')}`
  ).join('\n\n');
  return `${newSection}\n\nExisting memories:\n${existingSection}`;
}
