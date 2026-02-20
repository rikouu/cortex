import { createLogger } from '../utils/logger.js';
import { HybridSearchEngine, type SearchResult } from '../search/index.js';
import { isSmallTalk } from '../signals/index.js';
import type { CortexConfig } from '../utils/config.js';

const log = createLogger('gate');

/** Regex to strip injected metadata prefixes from recall queries */
const INJECTED_TAG_RE = /<cortex_memory>[\s\S]*?<\/cortex_memory>/g;
const SYSTEM_TAG_RE = /<(?:system|context|memory|tool_result|function_call)[\s\S]*?<\/(?:system|context|memory|tool_result|function_call)>/g;
const PLAIN_META_RE = /^Conversation info \(untrusted metadata\):.*$/gm;
const SYSTEM_PREFIX_RE = /^(?:System (?:info|context|metadata)|Conversation (?:info|context|metadata)|Memory context|Previous context)[\s(][^\n]*$/gm;

function cleanRecallQuery(query: string): string {
  return query
    .replace(INJECTED_TAG_RE, '')
    .replace(SYSTEM_TAG_RE, '')
    .replace(PLAIN_META_RE, '')
    .replace(SYSTEM_PREFIX_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

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
    const query = cleanRecallQuery(req.query);

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

    const maxTokens = req.max_tokens || this.config.maxInjectionTokens;

    // Search all layers in parallel
    const { results } = await this.searchEngine.search({
      query,
      layers: req.layers,
      agent_id: req.agent_id,
      limit: 15,
    });

    // Format for injection
    const context = this.searchEngine.formatForInjection(results, maxTokens);
    const injectedCount = context ? context.split('\n').length - 2 : 0; // minus tags

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
