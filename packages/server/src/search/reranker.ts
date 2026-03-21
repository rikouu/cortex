import { createLogger } from '../utils/logger.js';
import type { SearchResult } from './hybrid.js';
import type { LLMProvider } from '../llm/interface.js';

const log = createLogger('reranker');

/** Auth (401/403) and network errors that should trigger instant failover (<100ms) */
function isInstantFailover(res?: Response, error?: any): { failover: boolean; reason: string } {
  // Auth errors: skip immediately, don't retry
  if (res && (res.status === 401 || res.status === 403)) {
    return { failover: true, reason: `auth_error_${res.status}` };
  }
  // Network errors: ECONNREFUSED, ENOTFOUND, ETIMEDOUT, fetch TypeError
  if (error) {
    const msg = error.message || '';
    if (
      error.name === 'TypeError' ||  // fetch network failure
      msg.includes('ECONNREFUSED') ||
      msg.includes('ENOTFOUND') ||
      msg.includes('ETIMEDOUT') ||
      msg.includes('ERR_CONNECTION') ||
      msg.includes('socket hang up') ||
      msg.includes('network')
    ) {
      return { failover: true, reason: 'network_error' };
    }
  }
  return { failover: false, reason: '' };
}

export interface RerankerConfig {
  enabled: boolean;
  provider: 'cohere' | 'voyage' | 'jina' | 'siliconflow' | 'llm' | 'none';
  apiKey?: string;
  model?: string;
  topN?: number;
  baseUrl?: string;
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

    let res: Response;
    try {
      res = await fetch('https://api.cohere.com/v2/rerank', {
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
    } catch (e: any) {
      const { failover, reason } = isInstantFailover(undefined, e);
      if (failover) {
        log.warn({ reason, error: e.message }, 'Cohere rerank instant failover, returning original order');
      } else {
        log.warn({ error: e.message }, 'Cohere rerank failed, returning original order');
      }
      return results;
    }

    try {
      // Fast failover for auth errors — don't read body, return immediately
      const authCheck = isInstantFailover(res);
      if (authCheck.failover) {
        log.warn({ status: res.status, reason: authCheck.reason }, 'Cohere rerank auth error, returning original order');
        return results;
      }

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
      const documents = candidates.map((r, i) => `[${i}] (sim=${r.vectorScore.toFixed(3)}) ${r.content}`).join('\n');

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
 * Voyage AI Rerank API integration.
 * Docs: https://docs.voyageai.com/docs/reranker
 */
export class VoyageReranker implements Reranker {
  private apiKey: string;
  private model: string;
  private defaultTopN: number;

  constructor(opts: { apiKey?: string; model?: string; topN?: number }) {
    this.apiKey = opts.apiKey || process.env.VOYAGE_API_KEY || '';
    this.model = opts.model || 'rerank-2.5';
    this.defaultTopN = opts.topN || 10;
  }

  async rerank(query: string, results: SearchResult[], topN?: number): Promise<SearchResult[]> {
    if (!this.apiKey) {
      log.warn('Voyage API key not configured, skipping rerank');
      return results;
    }
    if (results.length === 0) return results;

    const n = topN || this.defaultTopN;
    let res: Response;
    try {
      res = await fetch('https://api.voyageai.com/v1/rerank', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          query,
          documents: results.map(r => r.content),
          top_k: Math.min(n, results.length),
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (e: any) {
      const { failover, reason } = isInstantFailover(undefined, e);
      if (failover) {
        log.warn({ reason, error: e.message }, 'Voyage rerank instant failover, returning original order');
      } else {
        log.warn({ error: e.message }, 'Voyage rerank failed, returning original order');
      }
      return results;
    }

    try {
      const authCheck = isInstantFailover(res);
      if (authCheck.failover) {
        log.warn({ status: res.status, reason: authCheck.reason }, 'Voyage rerank auth error, returning original order');
        return results;
      }

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Voyage rerank error ${res.status}: ${body}`);
      }

      const data = (await res.json()) as { data: { index: number; relevance_score: number }[] };

      const reranked: SearchResult[] = data.data.map(r => ({
        ...results[r.index]!,
        finalScore: r.relevance_score,
      }));

      log.info({ query: query.slice(0, 50), input: results.length, output: reranked.length }, 'Voyage reranked results');
      return reranked;
    } catch (e: any) {
      log.warn({ error: e.message }, 'Voyage rerank failed, returning original order');
      return results;
    }
  }
}

/**
 * Jina AI Reranker API integration.
 * Docs: https://jina.ai/reranker/
 */
export class JinaReranker implements Reranker {
  private apiKey: string;
  private model: string;
  private defaultTopN: number;

  constructor(opts: { apiKey?: string; model?: string; topN?: number }) {
    this.apiKey = opts.apiKey || process.env.JINA_API_KEY || '';
    this.model = opts.model || 'jina-reranker-v2-base-multilingual';
    this.defaultTopN = opts.topN || 10;
  }

  async rerank(query: string, results: SearchResult[], topN?: number): Promise<SearchResult[]> {
    if (!this.apiKey) {
      log.warn('Jina API key not configured, skipping rerank');
      return results;
    }
    if (results.length === 0) return results;

    const n = topN || this.defaultTopN;
    let res: Response;
    try {
      res = await fetch('https://api.jina.ai/v1/rerank', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          query,
          documents: results.map(r => r.content),
          top_n: Math.min(n, results.length),
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (e: any) {
      const { failover, reason } = isInstantFailover(undefined, e);
      if (failover) {
        log.warn({ reason, error: e.message }, 'Jina rerank instant failover, returning original order');
      } else {
        log.warn({ error: e.message }, 'Jina rerank failed, returning original order');
      }
      return results;
    }

    try {
      const authCheck = isInstantFailover(res);
      if (authCheck.failover) {
        log.warn({ status: res.status, reason: authCheck.reason }, 'Jina rerank auth error, returning original order');
        return results;
      }

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Jina rerank error ${res.status}: ${body}`);
      }

      const data = (await res.json()) as { results: { index: number; relevance_score: number }[] };

      const reranked: SearchResult[] = data.results.map(r => ({
        ...results[r.index]!,
        finalScore: r.relevance_score,
      }));

      log.info({ query: query.slice(0, 50), input: results.length, output: reranked.length }, 'Jina reranked results');
      return reranked;
    } catch (e: any) {
      log.warn({ error: e.message }, 'Jina rerank failed, returning original order');
      return results;
    }
  }
}

/**
 * SiliconFlow Reranker API integration (OpenAI-compatible rerank endpoint).
 * Docs: https://docs.siliconflow.cn/
 */
export class SiliconFlowReranker implements Reranker {
  private apiKey: string;
  private model: string;
  private defaultTopN: number;
  private baseUrl: string;

  constructor(opts: { apiKey?: string; model?: string; topN?: number; baseUrl?: string }) {
    this.apiKey = opts.apiKey || process.env.SILICONFLOW_API_KEY || '';
    this.model = opts.model || 'BAAI/bge-reranker-v2-m3';
    this.defaultTopN = opts.topN || 10;
    this.baseUrl = opts.baseUrl || 'https://api.siliconflow.cn/v1';
  }

  async rerank(query: string, results: SearchResult[], topN?: number): Promise<SearchResult[]> {
    if (!this.apiKey) {
      log.warn('SiliconFlow API key not configured, skipping rerank');
      return results;
    }
    if (results.length === 0) return results;

    const n = topN || this.defaultTopN;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/rerank`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          query,
          documents: results.map(r => r.content),
          top_n: Math.min(n, results.length),
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (e: any) {
      const { failover, reason } = isInstantFailover(undefined, e);
      if (failover) {
        log.warn({ reason, error: e.message }, 'SiliconFlow rerank instant failover, returning original order');
      } else {
        log.warn({ error: e.message }, 'SiliconFlow rerank failed, returning original order');
      }
      return results;
    }

    try {
      const authCheck = isInstantFailover(res);
      if (authCheck.failover) {
        log.warn({ status: res.status, reason: authCheck.reason }, 'SiliconFlow rerank auth error, returning original order');
        return results;
      }

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`SiliconFlow rerank error ${res.status}: ${body}`);
      }

      const data = (await res.json()) as { results: { index: number; relevance_score: number }[] };

      const reranked: SearchResult[] = data.results.map(r => ({
        ...results[r.index]!,
        finalScore: r.relevance_score,
      }));

      log.info({ query: query.slice(0, 50), input: results.length, output: reranked.length }, 'SiliconFlow reranked results');
      return reranked;
    } catch (e: any) {
      log.warn({ error: e.message }, 'SiliconFlow rerank failed, returning original order');
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
    case 'voyage':
      return new VoyageReranker({
        apiKey: config.apiKey,
        model: config.model || 'rerank-2.5',
        topN: config.topN,
      });
    case 'jina':
      return new JinaReranker({
        apiKey: config.apiKey,
        model: config.model || 'jina-reranker-v2-base-multilingual',
        topN: config.topN,
      });
    case 'siliconflow':
      return new SiliconFlowReranker({
        apiKey: config.apiKey,
        model: config.model || 'BAAI/bge-reranker-v2-m3',
        topN: config.topN,
        baseUrl: config.baseUrl,
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
