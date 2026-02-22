import { createLogger } from '../utils/logger.js';
import type { LLMProvider } from '../llm/interface.js';

const log = createLogger('query-expansion');

export interface QueryExpansionConfig {
  enabled: boolean;
  maxVariants: number;
}

/**
 * Expand a recall query into multiple search variants using LLM.
 * This improves recall by searching with synonyms and rephrasings.
 */
export async function expandQuery(
  query: string,
  llm: LLMProvider,
  config: QueryExpansionConfig,
): Promise<string[]> {
  if (!config.enabled || query.length < 5) {
    return [query];
  }

  const maxVariants = config.maxVariants || 3;

  try {
    const response = await llm.complete(
      `Given this memory search query, generate ${maxVariants - 1} alternative search queries that capture the same intent using different words, synonyms, or angles. The goal is to improve recall when searching a personal memory database.

Original query: "${query}"

Rules:
- Each variant should use different keywords/phrasing
- Keep variants concise (under 30 words)
- Include the semantic meaning but vary the vocabulary
- For non-English queries, keep variants in the same language
- Output ONLY the variant queries, one per line, no numbering or prefixes`,
      {
        maxTokens: 200,
        temperature: 0.7,
        systemPrompt: 'You are a search query expansion engine. Output only the expanded queries, nothing else.',
      },
    );

    const variants = response
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 3 && !line.startsWith('-') && !line.match(/^\d+[\.\)]/))
      .slice(0, maxVariants - 1);

    const allQueries = [query, ...variants];
    log.info({ original: query.slice(0, 50), variants: variants.length }, 'Query expanded');
    return allQueries;
  } catch (e: any) {
    log.warn({ error: e.message }, 'Query expansion failed, using original query');
    return [query];
  }
}
