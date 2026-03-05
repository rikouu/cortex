import { createLogger } from '../utils/logger.js';
import { HybridSearchEngine, type SearchResult } from '../search/index.js';
import { isSmallTalk } from '../signals/index.js';
import { expandQuery } from '../search/query-expansion.js';
import { stripInjectedContent } from '../utils/sanitize.js';
import type { Reranker } from '../search/reranker.js';
import type { CortexConfig } from '../utils/config.js';
import type { LLMProvider } from '../llm/interface.js';
import { findRelatedRelations } from '../db/queries.js';
import { normalizeEntity } from '../utils/helpers.js';

const log = createLogger('gate');

export interface RecallRequest {
  query: string;
  agent_id?: string;
  max_tokens?: number;
  layers?: ('working' | 'core' | 'archive')[];
}

export interface RecallResponse {
  context: string;
  memories: SearchResult[];
  meta: {
    query: string;
    total_found: number;
    injected_count: number;
    skipped: boolean;
    reason?: string;
    latency_ms: number;
  };
}

export class MemoryGate {
  private rerankerWeight: number;

  constructor(
    private searchEngine: HybridSearchEngine,
    private config: CortexConfig['gate'],
    private llm?: LLMProvider,
    private reranker?: Reranker,
    rerankerWeight?: number,
  ) {
    this.rerankerWeight = rerankerWeight ?? 0.5;
  }

  async recall(req: RecallRequest): Promise<RecallResponse> {
    const start = Date.now();
    const query = stripInjectedContent(req.query);

    // Skip small talk
    if (this.config.skipSmallTalk && isSmallTalk(query)) {
      return {
        context: '',
        memories: [],
        meta: {
          query: req.query,
          total_found: 0,
          injected_count: 0,
          skipped: true,
          reason: 'small_talk',
          latency_ms: Date.now() - start,
        },
      };
    }

    const RELATION_BUDGET = 300;
    const relationInjection = this.config.relationInjection !== false;
    const maxTokens = req.max_tokens || this.config.maxInjectionTokens;

    // Query expansion: generate variant queries for better recall
    let queries: string[];
    if (this.config.queryExpansion?.enabled && this.llm) {
      queries = await expandQuery(query, this.llm, this.config.queryExpansion);
    } else {
      queries = [query];
    }

    // Search all variants and merge results
    const resultMap = new Map<string, SearchResult>();
    const hitCount = new Map<string, number>();
    for (const q of queries) {
      const { results: qResults } = await this.searchEngine.search({
        query: q,
        layers: req.layers,
        agent_id: req.agent_id,
        limit: this.config.searchLimit || 30,
      });
      for (const r of qResults) {
        hitCount.set(r.id, (hitCount.get(r.id) ?? 0) + 1);
        const existing = resultMap.get(r.id);
        if (!existing || r.finalScore > existing.finalScore) {
          resultMap.set(r.id, r);
        }
      }
    }

    // Boost score for memories hit by multiple query variants (diminishing returns)
    let results = Array.from(resultMap.values())
      .map(r => {
        const hits = hitCount.get(r.id) ?? 1;
        // ln(1)=0, ln(2)≈0.69, ln(3)≈1.10, ln(5)≈1.61 → boost caps naturally
        const boost = hits > 1 ? 1 + 0.08 * Math.log(hits) : 1;
        return { ...r, finalScore: r.finalScore * boost };
      })
      .sort((a, b) => b.finalScore - a.finalScore);

    if (this.reranker && results.length > 0) {
      // Normalize original scores to 0-1 range for fair fusion
      const maxOriginal = Math.max(...results.map(r => r.finalScore)) || 1;
      const originalScores = new Map(results.map(r => [r.id, r.finalScore / maxOriginal]));

      const reranked = await this.reranker.rerank(query, results, 15);
      const rw = this.rerankerWeight;
      const ow = 1 - rw;

      // Fuse reranker score with original score
      results = reranked.map(r => ({
        ...r,
        finalScore: rw * r.finalScore + ow * (originalScores.get(r.id) ?? 0),
      })).sort((a, b) => b.finalScore - a.finalScore);
    } else {
      results = results.slice(0, 15);
    }

    // Format for injection (reserve token budget for relations if enabled)
    const memoryTokens = relationInjection ? maxTokens - RELATION_BUDGET : maxTokens;
    let context = this.searchEngine.formatForInjection(results, memoryTokens);
    const injectedCount = context ? context.split('\n').length - 2 : 0; // minus tags

    // Inject relevant relations
    if (relationInjection) {
      // Collect entity tokens from query + top 5 memory contents
      const tokenize = (text: string) =>
        text.split(/\s+/).map(w => normalizeEntity(w)).filter(w => w.length >= 2);

      const entitySet = new Set<string>(tokenize(query));
      for (const r of results.slice(0, 5)) {
        for (const t of tokenize(r.content)) entitySet.add(t);
      }

      const relations = findRelatedRelations([...entitySet].slice(0, 20), req.agent_id);
      if (relations.length > 0) {
        const lines = relations.map(r => `${r.subject} --${r.predicate}--> ${r.object} (${r.confidence.toFixed(2)})`);
        context = `${context}\n<cortex_relations>\n${lines.join('\n')}\n</cortex_relations>`;
        log.debug({ count: relations.length }, 'Relations injected');
      }
    }

    const latency = Date.now() - start;
    log.info({ query: query.slice(0, 50), results: results.length, injected: injectedCount, latency_ms: latency }, 'Recall completed');

    return {
      context,
      memories: results,
      meta: {
        query,
        total_found: results.length,
        injected_count: injectedCount,
        skipped: false,
        latency_ms: latency,
      },
    };
  }
}
