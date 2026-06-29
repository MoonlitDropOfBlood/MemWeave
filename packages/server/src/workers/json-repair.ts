/**
 * Lenient JSON parser for small-model output.
 *
 * Local 3B models (qwen2.5:3b via Ollama) frequently emit slightly malformed
 * JSON when asked for structured output: markdown code fences, leading prose,
 * trailing commas, unquoted keys, or truncated output. A strict `JSON.parse`
 * returns null and the memory is silently dropped — exactly the data-loss
 * failure mode the original compressor.ts had.
 *
 * This module applies a sequence of increasingly aggressive repairs and
 * re-tries, returning null only if nothing yields a parseable object.
 */

/**
 * Extract and parse a JSON object from a model's raw string output.
 * Returns null if no valid object can be recovered.
 */
export function parseJsonLenient(raw: string): unknown | null {
  if (!raw || !raw.trim()) return null;

  // 1. Strip markdown code fences (```json ... ``` or ``` ... ```).
  let text = raw.trim();
  text = stripCodeFences(text);

  // 2. Try parsing as-is first (fast path for well-formed output).
  const direct = tryParse(text);
  if (direct !== null) return direct;

  // 3. Extract the outermost {...} or [...] block (models often prepend prose).
  const extracted = extractOutermost(text);
  if (extracted !== null) {
    const repaired = applyRepairs(extracted);
    const parsed = tryParse(repaired);
    if (parsed !== null) return parsed;
  }

  // 4. Apply repairs to the full text and retry.
  const repairedFull = applyRepairs(text);
  const parsedFull = tryParse(repairedFull);
  if (parsedFull !== null) return parsedFull;

  return null;
}

function stripCodeFences(text: string): string {
  // ```json\n...\n``` or ```\n...\n```
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  if (fenceMatch) return fenceMatch[1].trim();
  return text;
}

function extractOutermost(text: string): string | null {
  const objStart = text.indexOf('{');
  const arrStart = text.indexOf('[');
  let startIdx = -1;
  let openChar = '';
  let closeChar = '';
  if (objStart === -1 && arrStart === -1) return null;
  if (objStart === -1) { startIdx = arrStart; openChar = '['; closeChar = ']'; }
  else if (arrStart === -1) { startIdx = objStart; openChar = '{'; closeChar = '}'; }
  else { startIdx = Math.min(objStart, arrStart); openChar = startIdx === objStart ? '{' : '['; closeChar = startIdx === objStart ? '}' : ']'; }

  let depth = 0;
  let inString = false;
  let escape = false;
  /** Stack of opened but unclosed structural chars (for truncation repair). */
  const stack: string[] = [];
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') { depth++; stack.push(ch === '{' ? '}' : ']'); }
    else if (ch === '}' || ch === ']') {
      depth--;
      stack.pop();
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  // Truncated: close the string if open, then close all unclosed structures.
  let suffix = inString ? '"' : '';
  for (let i = stack.length - 1; i >= 0; i--) suffix += stack[i];
  return text.slice(startIdx) + suffix;
}

function applyRepairs(text: string): string {
  let out = text;
  // Remove trailing commas before } or ].
  out = out.replace(/,\s*([}\]])/g, '$1');
  // Quote unquoted keys: {key: "val"} → {"key": "val"}
  out = out.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*):/g, '$1"$2"$3:');
  // Remove single-line // comments.
  out = out.replace(/\/\/[^\n]*/g, '');
  return out;
}

function tryParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
