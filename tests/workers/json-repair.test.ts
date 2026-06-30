import { describe, expect, it } from 'vitest';
import { parseJsonLenient } from '../../packages/server/src/workers/json-repair.js';

describe('parseJsonLenient', () => {
  it('parses well-formed JSON directly', () => {
    const result = parseJsonLenient('{"title":"x","importance":5}');
    expect(result).toEqual({ title: 'x', importance: 5 });
  });

  it('strips markdown ```json fences', () => {
    const result = parseJsonLenient('```json\n{"title":"x"}\n```');
    expect(result).toEqual({ title: 'x' });
  });

  it('strips bare ``` fences', () => {
    const result = parseJsonLenient('```\n{"title":"x"}\n```');
    expect(result).toEqual({ title: 'x' });
  });

  it('extracts JSON from leading prose', () => {
    const result = parseJsonLenient('Here is the result:\n{"title":"x","concepts":["a","b"]}');
    expect(result).toEqual({ title: 'x', concepts: ['a', 'b'] });
  });

  it('extracts JSON from trailing prose', () => {
    const result = parseJsonLenient('{"title":"x"}\n\nThat was the answer.');
    expect(result).toEqual({ title: 'x' });
  });

  it('removes trailing commas', () => {
    const result = parseJsonLenient('{"title":"x","concepts":["a","b",],}');
    expect(result).toEqual({ title: 'x', concepts: ['a', 'b'] });
  });

  it('quotes unquoted keys', () => {
    const result = parseJsonLenient('{title: "x", importance: 5}');
    expect(result).toEqual({ title: 'x', importance: 5 });
  });

  it('handles truncated JSON by closing braces', () => {
    // A 3B model running out of max_tokens mid-output.
    const result = parseJsonLenient('{"title":"x","concepts":["a","b"');
    expect(result).toEqual({ title: 'x', concepts: ['a', 'b'] });
  });

  it('removes single-line comments', () => {
    const result = parseJsonLenient('{\n"title":"x", // a comment\n"importance":5\n}');
    expect(result).toEqual({ title: 'x', importance: 5 });
  });

  it('handles strings containing braces (does not break on } inside strings)', () => {
    const result = parseJsonLenient('{"content":"function() { return 1; }","title":"x"}');
    expect(result).toEqual({ content: 'function() { return 1; }', title: 'x' });
  });

  it('returns null for empty input', () => {
    expect(parseJsonLenient('')).toBeNull();
    expect(parseJsonLenient('   ')).toBeNull();
  });

  it('returns null for pure prose with no JSON', () => {
    expect(parseJsonLenient('I could not produce JSON for this input.')).toBeNull();
  });

  it('parses a full memory-candidate-shaped object', () => {
    const raw = `Here is the compressed memory:
\`\`\`json
{
  "shouldCreateMemory": true,
  "type": "decision",
  "title": "Use strict TypeScript",
  "summary": "Enable noImplicitAny and exactOptionalPropertyTypes",
  "content": "The team decided to enforce strict mode.",
  "concepts": ["typescript", "strict", "noImplicitAny"],
  "files": ["tsconfig.json"],
  "importance": 7,
  "confidence": 0.9,
  "scopeLevel": "project",
  "scopes": [{ "key": "project", "value": "memweave" }],
  "candidateEdges": []
}
\`\`\``;
    const result = parseJsonLenient(raw) as Record<string, unknown>;
    expect(result.title).toBe('Use strict TypeScript');
    expect(result.concepts).toEqual(['typescript', 'strict', 'noImplicitAny']);
    expect(result.importance).toBe(7);
  });
});
