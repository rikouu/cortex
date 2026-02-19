import { createLogger } from '../utils/logger.js';
import { HybridSearchEngine, type SearchResult } from '../search/index.js';
import { isSmallTalk } from '../signals/index.js';
import type { CortexConfig } from '../utils/config.js';

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
  constructor(
    private searchEngine: HybridSearchEngine,
    private config: CortexConfig['gate'],
  ) {}

  async recall(req: RecallRequest): Promise<RecallResponse> {
    const start = Date.now();

    // Skip small talk
    if (this.config.skipSmallTalk && isSmallTalk(req.query)) {
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

    const maxTokens = req.max_tokens || this.config.maxInjectionTokens;

    // Search all layers in parallel
    const { results } = await this.searchEngine.search({
      query: req.query,
      layers: req.layers,
      agent_id: req.agent_id,
      limit: 15,
    });

    // Format for injection
    const context = this.searchEngine.formatForInjection(results, maxTokens);
    const injectedCount = context ? context.split('\n').length - 2 : 0; // minus tags

    const latency = Date.now() - start;
    log.info({ query: req.query.slice(0, 50), results: results.length, injected: injectedCount, latency_ms: latency }, 'Recall completed');

    return {
      context,
      memories: results,
      meta: {
        query: req.query,
        total_found: results.length,
        injected_count: injectedCount,
        skipped: false,
        latency_ms: latency,
      },
    };
  }
}
