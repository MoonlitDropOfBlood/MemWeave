import { describe, expect, it } from 'vitest';
import { ValueGateResult, evaluateObservation } from '../../src/workers/value-gate.js';

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
});
