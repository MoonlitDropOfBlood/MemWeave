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
  // Chinese explicit-remember cues.
  /记住/i, /记住这个/i, /以后遇到/i, /记住.*偏好/i,
  /这个是我的偏好/i, /这个方案确定了/i, /以后记住/i,
  // English explicit-remember cues.
  /\bremember\b/i, /\bremember that\b/i, /\bfrom now on\b/i, /\bmake sure to\b/i,
  /\bnote that\b/i, /\bdon'?t forget\b/i, /\bkeep in mind\b/i, /\bfor future/i
];

const DECISION_PATTERNS = [
  // Chinese architectural-decision cues.
  /我们就用/i, /决定.*用/i, /选择.*而不是/i, /不用.*了/i,
  /采用/i, /使用.*方案/i, /确定.*架构/i,
  // English decision cues.
  /\blet'?s go with\b/i, /\bdecided to\b/i, /\bwe (?:will|should) use\b/i,
  /\bgoing with\b/i, /\binstead of\b/i, /\bthe approach is\b/i
];

/**
 * Signals that an assistant message contains a reusable conclusion (not just
 * process narration). Used to promote chat.assistant observations that carry
 * actual knowledge — code patterns, bug fixes, architectural conclusions.
 */
const ASSISTANT_KNOWLEDGE_PATTERNS = [
  /```[\s\S]/,          // a code block
  /\bTODO\b/i, /\bFIXME\b/i, /\bHACK\b/i,
  /\bthe (?:root cause|fix|solution) is\b/i,
  /\bwe need to\b/i, /\byou must\b/i, /\balways use\b/i, /\bnever use\b/i,
  /\barchitecture\b/i, /\bpattern\b/i
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

  // 3. Tool failures (legacy Claude-Code style hook + chat.tool).
  //    A tool result that looks like a build/test error is exactly
  //    the kind of "discrete event" the `event` type was designed
  //    for. Promote as `bug` so the agent can search failures.
  if (input.hookType === 'post_tool_use' && input.toolName === 'Bash' && FAILURE_KEYWORDS.some(k => combined.includes(k))) {
    return { shouldCreateMemory: true, reason: 'Tool failure detected', suggestedTypes: ['bug'], priority: 'high' };
  }

  // 3b. Assistant messages carrying reusable knowledge. chat.assistant
  //     observations are usually process narration ("Let me check..."), but
  //     some contain actual conclusions — code blocks, bug fixes, architectural
  //     statements. Promote those so they survive as memories (the enricher
  //     will then compress them into a clean title/summary/concepts).
  if (input.hookType === 'chat.assistant') {
    const assistantText = input.toolOutput || '';
    if (ASSISTANT_KNOWLEDGE_PATTERNS.some(p => p.test(assistantText)) && assistantText.length > 40) {
      return { shouldCreateMemory: true, reason: 'Assistant message contains reusable knowledge', suggestedTypes: ['lesson', 'code_pattern', 'fact'], priority: 'medium' };
    }
  }

  // Default: reject routine operations. Observations that did not
  // match any of the patterns above are still marked processed=1
  // by the consolidator - we never want to re-evaluate them.
  //
  // v0.5.4 NOTE: an earlier draft auto-promoted any chat.user or
  // chat.assistant observation longer than 50/200 chars as
  // type='event'. That was a category error: raw conversation
  // turns are NOT events. An `event` memory should describe a
  // discrete thing that happened in the world (a release, a
  // build failure, a config change), not "the user said X" or
  // "the assistant said Y". The right surface for converting a
  // conversation into memories is the agent itself, calling
  // the `memory_save` MCP tool with a proper type. See git
  // history for the removed rules.
  return { shouldCreateMemory: false, reason: 'Routine operation, no memory value', suggestedTypes: [], priority: 'low' };
}
