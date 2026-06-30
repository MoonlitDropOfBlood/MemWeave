import { describe, expect, it } from 'vitest';
import { ValueGateResult, evaluateObservation } from '../../packages/server/src/workers/value-gate.js';

describe('ValueGate', () => {
  it('rejects routine file reads', () => {
    const result = evaluateObservation({
      hookType: 'post_tool_use',
      toolName: 'Read',
      toolInput: 'src/core/types.ts',
      toolOutput: 'import { z } from ...'
    });
    expect(result.shouldCreateMemory).toBe(false);
  });

  it('accepts explicit user save requests', () => {
    const result = evaluateObservation({
      hookType: 'prompt_submit',
      userPrompt: '记住这个：项目使用 SQLite 作为本地存储'
    });
    expect(result.shouldCreateMemory).toBe(true);
    expect(result.suggestedTypes).toContain('fact');
  });

  it('accepts architectural decisions', () => {
    const result = evaluateObservation({
      hookType: 'prompt_submit',
      userPrompt: '我们就用 MCP + REST，不上 WebSocket'
    });
    expect(result.shouldCreateMemory).toBe(true);
    expect(result.suggestedTypes).toContain('decision');
  });

  it('accepts tool failures', () => {
    const result = evaluateObservation({
      hookType: 'post_tool_use',
      toolName: 'Bash',
      toolOutput: 'Error: build failed\nType mismatch in src/app.ts'
    });
    expect(result.shouldCreateMemory).toBe(true);
    expect(result.suggestedTypes).toContain('bug');
  });

  it('accepts English explicit-remember cues', () => {
    const r = evaluateObservation({ hookType: 'prompt_submit', userPrompt: 'Remember to always use strict mode' });
    expect(r.shouldCreateMemory).toBe(true);
  });

  it('accepts English "from now on" cues', () => {
    const r = evaluateObservation({ hookType: 'prompt_submit', userPrompt: 'From now on, we use pnpm instead of npm' });
    expect(r.shouldCreateMemory).toBe(true);
    // "from now on" matches the remember-pattern path → fact/preference
    expect(r.suggestedTypes).toContain('fact');
  });

  it('accepts English decision cues ("let\'s go with")', () => {
    const r = evaluateObservation({ hookType: 'prompt_submit', userPrompt: "Let's go with the BM25 approach for now" });
    expect(r.shouldCreateMemory).toBe(true);
    expect(r.suggestedTypes).toContain('decision');
  });

  it('accepts assistant messages with code blocks (reusable knowledge)', () => {
    const r = evaluateObservation({
      hookType: 'chat.assistant',
      toolOutput: 'Here is the fix:\n```ts\nconst x = 1;\n```\nThis resolves the type error.'
    });
    expect(r.shouldCreateMemory).toBe(true);
    expect(r.priority).toBe('medium');
  });

  it('rejects short assistant process narration', () => {
    const r = evaluateObservation({ hookType: 'chat.assistant', toolOutput: 'Let me check that for you.' });
    expect(r.shouldCreateMemory).toBe(false);
  });

  it('accepts assistant messages with "the root cause is"', () => {
    const r = evaluateObservation({
      hookType: 'chat.assistant',
      toolOutput: 'The root cause is that the connection pool was exhausted. You must increase the pool size.'
    });
    expect(r.shouldCreateMemory).toBe(true);
  });
});
