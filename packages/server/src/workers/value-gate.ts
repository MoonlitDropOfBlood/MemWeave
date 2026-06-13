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

export function evaluateObservation(input: ValueGateInput): ValueGateResult {
  const combined = [
    input.userPrompt || '',
    input.toolOutput || '',
    input.error || ''
  ].join('\n').toLowerCase();

  // Check for explicit "remember" requests
  for (const pattern of REMEMBER_PATTERNS) {
    if (pattern.test(input.userPrompt || '')) {
      return { shouldCreateMemory: true, reason: 'User explicitly asked to remember', suggestedTypes: ['fact', 'preference'], priority: 'high' };
    }
  }

  // Check for decisions
  for (const pattern of DECISION_PATTERNS) {
    if (pattern.test(input.userPrompt || '')) {
      return { shouldCreateMemory: true, reason: 'Architectural decision detected', suggestedTypes: ['decision'], priority: 'high' };
    }
  }

  // Check for tool failures
  if (input.hookType === 'post_tool_use' && input.toolName === 'Bash' && FAILURE_KEYWORDS.some(k => combined.includes(k))) {
    return { shouldCreateMemory: true, reason: 'Tool failure detected', suggestedTypes: ['bug'], priority: 'high' };
  }

  // Check for prompt_submit with substantive content
  if (input.hookType === 'prompt_submit' && input.userPrompt && input.userPrompt.length > 50) {
    return { shouldCreateMemory: true, reason: 'Substantive user prompt', suggestedTypes: ['event'], priority: 'medium' };
  }

  // Default: reject routine operations
  return { shouldCreateMemory: false, reason: 'Routine operation, no memory value', suggestedTypes: [], priority: 'low' };
}
