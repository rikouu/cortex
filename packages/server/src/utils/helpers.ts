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
  return t2s(text.trim().normalize('NFKC')).replace(/\s+/g, ' ').toLowerCase();
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
 * Extract entity tokens from text for relation matching.
 * Handles CJK (no spaces) by extracting character bigrams + known patterns.
 */
export function extractEntityTokens(text: string): string[] {
  const tokens = new Set<string>();

  // Split on whitespace and punctuation
  const words = text.split(/[\s,;:!?。，；：！？、·\-\(\)\[\]（）【】「」『』""'']+/)
    .map(w => normalizeEntity(w))
    .filter(w => w.length >= 2);

  for (const w of words) {
    tokens.add(w);
    // For CJK-heavy tokens, also extract bigrams for fuzzy matching
    const cjkChars = w.match(/[\u3000-\u9fff\uf900-\ufaff]/g);
    if (cjkChars && cjkChars.length >= 2 && w.length >= 3) {
      for (let i = 0; i < w.length - 1; i++) {
        const bigram = w.slice(i, i + 2);
        if (/[\u3000-\u9fff\uf900-\ufaff]{2}/.test(bigram)) {
          tokens.add(bigram);
        }
      }
    }
  }

  return [...tokens];
}

/**
 * Escape SQL LIKE wildcards (% and _) in a string.
 */
export function escapeLikePattern(s: string): string {
  return s.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Rough token count estimation (1 token ≈ 4 chars for English, ≈ 1.5 chars for CJK)
 */
export function estimateTokens(text: string): number {
  const cjkChars = (text.match(/[\u3000-\u9fff\uf900-\ufaff]/g) || []).length;
  const otherChars = text.length - cjkChars;
  return Math.ceil(cjkChars / 1.5 + otherChars / 4);
}
