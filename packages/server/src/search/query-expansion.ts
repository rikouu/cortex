import { createLogger } from '../utils/logger.js';
import type { LLMProvider } from '../llm/interface.js';

const log = createLogger('query-expansion');

export interface QueryExpansionConfig {
  enabled: boolean;
  maxVariants: number;
}

/**
 * Expand a recall query using a hybrid strategy:
 * - Short queries (≤8 chars): keyword expansion, single enriched search
 * - Long queries (>8 chars): generate 2 full variant queries for multi-angle cross-validation
 */
export async function expandQuery(
  query: string,
  llm: LLMProvider,
  config: QueryExpansionConfig,
): Promise<string[]> {
  if (!config.enabled || query.length < 5) {
    return [query];
  }

  try {
    // Short queries (≤8 chars): keyword expansion, single search
    if (query.length <= 8) {
      const response = await llm.complete(
        `Given this memory search query, output 3-5 additional keywords/synonyms that would help find relevant memories. Same language as the query. Output only the keywords, space-separated.\n\nQuery: "${query}"`,
        {
          maxTokens: 60,
          temperature: 0.3,
          systemPrompt: 'Output only keywords, nothing else.',
        },
      );

      const keywords = response.trim();
      const enriched = `${query} ${keywords}`;
      log.info({ original: query, keywords }, 'Query expanded (keyword mode)');
      return [enriched]; // Single enriched search
    }

    // Long queries (>8 chars): generate 2 full variant queries
    const maxVariants = Math.min(config.maxVariants || 3, 2); // Cap at 2 variants
    const response = await llm.complete(
      `Given this memory search query, generate ${maxVariants} alternative search queries that capture the same intent using different words, synonyms, or angles. The goal is to improve recall when searching a personal memory database.

Original query: "${query}"

Rules:
- Each variant should use different keywords/phrasing
- Keep variants concise (under 30 words)
- Include the semantic meaning but vary the vocabulary
- For non-English queries, keep variants in the same language
- Output ONLY the variant queries, one per line, no numbering or prefixes`,
      {
        maxTokens: 120,
        temperature: 0.7,
        systemPrompt: 'You are a search query expansion engine. Output only the expanded queries, nothing else.',
      },
    );

    const variants = response
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 3 && !line.startsWith('-') && !line.match(/^\d+[\.\)]/))
      .slice(0, maxVariants);

    const allQueries = [query, ...variants];
    log.info({ original: query.slice(0, 50), variants: variants.length }, 'Query expanded (variant mode)');
    return allQueries;
  } catch (e: any) {
    log.warn({ error: e.message }, 'Query expansion failed, using original query');
    return [query];
  }
}
