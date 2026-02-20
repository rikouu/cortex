import { uuidv7 } from 'uuidv7';
import * as OpenCC from 'opencc-js';

const t2s = OpenCC.Converter({ from: 't', to: 'cn' });

export function generateId(): string {
  return uuidv7();
}

/**
 * Normalize an entity name for consistent relation matching.
 * Applies: trim → NFKC unicode normalization → Traditional→Simplified Chinese → collapse whitespace.
 */
export function normalizeEntity(text: string): string {
  return t2s(text.trim().normalize('NFKC')).replace(/\s+/g, ' ');
}

/**
 * Parse duration string like "48h", "90d", "30m" to milliseconds.
 */
export function parseDuration(s: string): number {
  const match = s.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) throw new Error(`Invalid duration: ${s}`);
  const [, num, unit] = match;
  const n = parseInt(num!);
  switch (unit) {
    case 'ms': return n;
    case 's': return n * 1000;
    case 'm': return n * 60_000;
    case 'h': return n * 3_600_000;
    case 'd': return n * 86_400_000;
    default: throw new Error(`Unknown unit: ${unit}`);
  }
}

/**
 * Rough token count estimation (1 token ≈ 4 chars for English, ≈ 1.5 chars for CJK)
 */
export function estimateTokens(text: string): number {
  const cjkChars = (text.match(/[\u3000-\u9fff\uf900-\ufaff]/g) || []).length;
  const otherChars = text.length - cjkChars;
  return Math.ceil(cjkChars / 1.5 + otherChars / 4);
}
