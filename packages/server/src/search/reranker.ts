import { createLogger } from '../utils/logger.js';
import type { SearchResult } from './hybrid.js';

const log = createLogger('reranker');

export interface RerankerConfig {
  enabled: boolean;
  provider: 'cohere' | 'none';
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
 * Null reranker — passes through results unchanged.
 */
export class NullReranker implements Reranker {
  async rerank(_query: string, results: SearchResult[]): Promise<SearchResult[]> {
    return results;
  }
}

export function createReranker(config?: RerankerConfig): Reranker {
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
    default:
      return new NullReranker();
  }
}
