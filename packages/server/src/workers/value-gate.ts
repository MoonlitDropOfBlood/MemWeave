export interface ValueGateInput {
  hookType: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  userPrompt?: string;
  error?: string;
}

export interface ValueGateResult {
  shouldCreateMemory: boolean;
  reason: string;
  suggestedTypes: string[];
  priority: 'low' | 'medium' | 'high';
}

const REMEMBER_PATTERNS = [
  /记住/i, /记住这个/i, /以后遇到/i, /记住.*偏好/i,
  /这个是我的偏好/i, /这个方案确定了/i, /以后记住/i
];

const DECISION_PATTERNS = [
  /我们就用/i, /决定.*用/i, /选择.*而不是/i, /不用.*了/i,
  /采用/i, /使用.*方案/i, /确定.*架构/i
];

const FAILURE_KEYWORDS = ['error', 'fail', 'crash', 'exception', 'build failed', 'test failed'];

/**
 * Decide whether an `observations` row should be promoted to a memory.
 *
 * Hook-type vocabulary used by the OpenCode + Codex plugins
 * (v0.4 plugin contract):
 *   - 'chat.user'      - the user just sent a message
 *   - 'chat.assistant' - the assistant just produced a message
 *   - 'chat.tool'      - a tool call's result (input/output envelope)
 *
 * The original v0.4 contract used 'prompt_submit' / 'post_tool_use' /
 * 'pre_tool_use' which are the Claude-Code style hook names. We keep
 * those branches for back-compat (and for the case where a future
 * hook consumer uses them) but the active v0.4+ plugins emit
 * 'chat.*' names.
 */
export function evaluateObservation(input: ValueGateInput): ValueGateResult {
  const combined = [
    input.userPrompt || '',
    input.toolOutput || '',
    input.error || ''
  ].join('\n').toLowerCase();

  // 1. Explicit "remember" requests in the user message.
  for (const pattern of REMEMBER_PATTERNS) {
    if (pattern.test(input.userPrompt || '')) {
      return { shouldCreateMemory: true, reason: 'User explicitly asked to remember', suggestedTypes: ['fact', 'preference'], priority: 'high' };
    }
  }

  // 2. Architectural decisions in the user message.
  for (const pattern of DECISION_PATTERNS) {
    if (pattern.test(input.userPrompt || '')) {
      return { shouldCreateMemory: true, reason: 'Architectural decision detected', suggestedTypes: ['decision'], priority: 'high' };
    }
  }

  // 3. Tool failures (legacy Claude-Code style hook).
  if (input.hookType === 'post_tool_use' && input.toolName === 'Bash' && FAILURE_KEYWORDS.some(k => combined.includes(k))) {
    return { shouldCreateMemory: true, reason: 'Tool failure detected', suggestedTypes: ['bug'], priority: 'high' };
  }

  // 4. Substantive user prompt. Triggered by either:
  //    - the original 'prompt_submit' hook (legacy / hypothetical)
  //    - the actual 'chat.user' hook the OpenCode + Codex plugins use
  //    A short prompt is too noisy to be worth keeping; require > 50 chars
  //    of substance. We do NOT promote obvious "tool call wrappers" or
  //    one-liner acknowledgements.
  if (
    (input.hookType === 'prompt_submit' || input.hookType === 'chat.user') &&
    input.userPrompt && input.userPrompt.length > 50
  ) {
    return {
      shouldCreateMemory: true,
      reason: 'Substantive user prompt',
      suggestedTypes: ['event'],
      priority: 'medium'
    };
  }

  // 5. Assistant messages with substantive content. The OpenCode /
  //    Codex plugins write the assistant's full response into
  //    `tool_output` of the chat.assistant observation. We promote
  //    when the response is long enough to be worth keeping
  //    (>= 200 chars) so short acknowledgements ("OK.", "Sure.")
  //    are not promoted.
  if (input.hookType === 'chat.assistant' && (input.toolOutput || '').length >= 200) {
    return {
      shouldCreateMemory: true,
      reason: 'Substantive assistant response',
      suggestedTypes: ['event'],
      priority: 'medium'
    };
  }

  // Default: reject routine operations.
  return { shouldCreateMemory: false, reason: 'Routine operation, no memory value', suggestedTypes: [], priority: 'low' };
}
