/**
 * Shared text sanitization utilities.
 * Strips injected system tags, metadata, and framework content from user/assistant text.
 *
 * Supports two modes:
 * 1. Structural markers: `<!-- cortex:strip-start -->...<!-- cortex:strip-end -->` (preferred, exact)
 * 2. Regex fallback: Pattern-based stripping for frameworks that don't use markers
 *
 * Frameworks (OpenClaw, etc.) can wrap injected content with cortex:strip markers
 * to ensure clean, precise removal without regex false positives.
 */

/** Structural strip markers — preferred, zero false positives */
const STRIP_MARKER_RE = /<!--\s*cortex:strip-start\s*-->[\s\S]*?<!--\s*cortex:strip-end\s*-->/g;

/** Regex to strip injected <cortex_memory> tags and other system metadata */
const INJECTED_TAG_RE = /<cortex_memory>[\s\S]*?<\/cortex_memory>/g;
const SYSTEM_TAG_RE = /<(?:system|context|memory|tool_result|tool_use|function_call|function_result|instructions|artifact|thinking|antThinking)[\s\S]*?<\/(?:system|context|memory|tool_result|tool_use|function_call|function_result|instructions|artifact|thinking|antThinking)>/g;

/** Plain-text metadata prefixes injected by some frameworks */
const PLAIN_META_RE = /^Conversation info \(untrusted metadata\):.*$/gm;
const SYSTEM_PREFIX_RE = /^(?:System (?:info|context|metadata|prompt|instruction)|Conversation (?:info|context|metadata)|Memory context|Previous context|Tool (?:description|instructions)|Image (?:analysis|description) instructions?)[\s(:\-][^\n]*$/gm;

/** Chat-ML / special role markers */
const ROLE_MARKER_RE = /^(?:<\|(?:system|im_start|im_end)\|>|\[(?:SYSTEM|INST|\/INST|SYS|\/SYS)\]|Human:|Assistant:|<<SYS>>|<<\/SYS>>)[^\n]*$/gm;

/** Tool/capability instructions injected by frameworks (OpenClaw, etc.) */
const TOOL_INSTRUCTION_RE = /^(?:To (?:send|upload|share|create|use|handle|process|generate|render|display|format|attach|include)\b[^\n]*\b(?:tool|function|method|API|endpoint|format|command|provider|message)\b[^\n]*|(?:Prefer|Use|Always use|When possible,? use)\b[^\n]*\b(?:tool|function|method|format)\b[^\n]*|(?:Note|Important|Warning|Tip):\s*(?:When|If|To|For)\s[^\n]*\b(?:tool|API|function|MCP|message|provider)\b[^\n]*)$/gmi;

/** Capability description lines (e.g. "I can analyze images", "This tool supports...") */
const CAPABILITY_RE = /^(?:(?:I|This (?:tool|assistant|model|system)) (?:can|support|am able to|will|allow)\b[^\n]{10,}|(?:Supported|Available|Enabled) (?:features|capabilities|tools|formats|options)[:\s][^\n]*)$/gmi;

/**
 * Strip all injected system content from text.
 *
 * If structural markers (`<!-- cortex:strip-start -->`) are present, uses them first
 * for precise removal. Always applies regex fallback for remaining patterns.
 */
export function stripInjectedContent(text: string): string {
  // Phase 1: structural markers (exact, preferred)
  let result = text.replace(STRIP_MARKER_RE, '');

  // Phase 2: regex fallback for remaining patterns
  result = result
    .replace(INJECTED_TAG_RE, '')
    .replace(SYSTEM_TAG_RE, '')
    .replace(PLAIN_META_RE, '')
    .replace(SYSTEM_PREFIX_RE, '')
    .replace(ROLE_MARKER_RE, '')
    .replace(TOOL_INSTRUCTION_RE, '')
    .replace(CAPABILITY_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return result;
}

/** Strip markdown code fences (```json ... ```) from LLM output */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```$/);
  return match ? match[1]!.trim() : trimmed;
}
