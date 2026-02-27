import { createLogger } from '../utils/logger.js';
import type { SearchResult } from './hybrid.js';
import type { LLMProvider } from '../llm/interface.js';

const log = createLogger('reranker');

export interface RerankerConfig {
  enabled: boolean;
  provider: 'cohere' | 'llm' | 'none';
  apiKey?: string;
  model?: string;
  topN?: number;
}

export interface Reranker {
  rerank(query: string, results: SearchResult[], topN?: number): Promise<SearchResult[]>;
}

/**
 * Cohere Rerank API integration.
 */
export class CohereReranker implements Reranker {
  private apiKey: string;
  private model: string;
  private defaultTopN: number;

  constructor(opts: { apiKey?: string; model?: string; topN?: number }) {
    this.apiKey = opts.apiKey || process.env.COHERE_API_KEY || '';
    this.model = opts.model || 'rerank-v3.5';
    this.defaultTopN = opts.topN || 10;
  }

  async rerank(query: string, results: SearchResult[], topN?: number): Promise<SearchResult[]> {
    if (!this.apiKey) {
      log.warn('Cohere API key not configured, skipping rerank');
      return results;
    }

    if (results.length === 0) return results;

    const n = topN || this.defaultTopN;
    const documents = results.map(r => r.content);

    try {
      const res = await fetch('https://api.cohere.com/v2/rerank', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          query,
          documents,
          top_n: Math.min(n, results.length),
          return_documents: false,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Cohere rerank error ${res.status}: ${body}`);
      }

      const data = (await res.json()) as { results: { index: number; relevance_score: number }[] };

      // Rebuild results in reranked order
      const reranked: SearchResult[] = data.results.map(r => {
        const original = results[r.index]!;
        return {
          ...original,
          finalScore: r.relevance_score, // Override with reranker score
        };
      });

      log.info({ query: query.slice(0, 50), input: results.length, output: reranked.length }, 'Reranked results');
      return reranked;
    } catch (e: any) {
      log.warn({ error: e.message }, 'Rerank failed, returning original order');
      return results;
    }
  }
}

/**
 * LLM-based reranker — uses the extraction LLM to score relevance.
 */
export class LLMReranker implements Reranker {
  private defaultTopN: number;

  constructor(
    private llm: LLMProvider,
    opts?: { topN?: number },
  ) {
    this.defaultTopN = opts?.topN || 10;
  }

  async rerank(query: string, results: SearchResult[], topN?: number): Promise<SearchResult[]> {
    if (results.length === 0) return results;

    const n = topN || this.defaultTopN;
    // Only rerank top candidates to save tokens
    const candidates = results.slice(0, Math.min(results.length, n * 2));

    try {
      const documents = candidates.map((r, i) => `[${i}] ${r.content}`).join('\n');

      const response = await this.llm.complete(
        `Rate how useful each memory would be if injected into an AI assistant's context to help answer the query. Output ONLY a JSON array of objects with "index" and "score" (0.0 to 1.0), sorted by score descending.

Scoring guide:
- 0.9-1.0: Directly answers or critically constrains the response
- 0.6-0.8: Provides useful background context
- 0.3-0.5: Tangentially related
- 0.0-0.2: Irrelevant
Consider: Would the assistant give a WORSE answer without this memory?

Query: "${query}"

Memories:
${documents}

Output format: [{"index": 0, "score": 0.95}, {"index": 2, "score": 0.7}, ...]
Output ONLY valid JSON, no explanation.`,
        {
          maxTokens: 500,
          temperature: 0,
          systemPrompt: 'You are a relevance scoring engine. Output only valid JSON.',
        },
      );

      // Parse JSON from response (handle markdown code blocks)
      const jsonStr = response.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();
      const scores = JSON.parse(jsonStr) as { index: number; score: number }[];

      const reranked: SearchResult[] = scores
        .filter(s => s.index >= 0 && s.index < candidates.length)
        .slice(0, n)
        .map(s => ({
          ...candidates[s.index]!,
          finalScore: s.score,
        }));

      log.info({ query: query.slice(0, 50), input: candidates.length, output: reranked.length }, 'LLM reranked results');
      return reranked;
    } catch (e: any) {
      log.warn({ error: e.message }, 'LLM rerank failed, returning original order');
      return results.slice(0, n);
    }
  }
}

/**
 * Null reranker — passes through results unchanged.
 */
export class NullReranker implements Reranker {
  async rerank(_query: string, results: SearchResult[]): Promise<SearchResult[]> {
    return results;
  }
}

export function createReranker(config?: RerankerConfig, llm?: LLMProvider): Reranker {
  if (!config?.enabled || config.provider === 'none') {
    return new NullReranker();
  }

  switch (config.provider) {
    case 'cohere':
      return new CohereReranker({
        apiKey: config.apiKey,
        model: config.model,
        topN: config.topN,
      });
    case 'llm':
      if (!llm) {
        log.warn('LLM reranker requested but no LLM provider available, falling back to none');
        return new NullReranker();
      }
      return new LLMReranker(llm, { topN: config.topN });
    default:
      return new NullReranker();
  }
}
