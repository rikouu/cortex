import { type CortexConfig } from './utils/config.js';
import { createLogger } from './utils/logger.js';
import { MemoryGate } from './core/gate.js';
import { MemorySieve } from './core/sieve.js';
import { MemoryFlush } from './core/flush.js';
import { LifecycleEngine } from './decay/lifecycle.js';
import { HybridSearchEngine } from './search/hybrid.js';
import { MarkdownExporter } from './export/markdown.js';
import { createVectorBackend } from './vector/index.js';
import { createCascadeLLM } from './llm/cascade.js';
import { hasLLMConfigOverride, mergeLLMConfig } from './llm/config-utils.js';
import { createCascadeEmbedding } from './embedding/cascade.js';
import { CachedEmbeddingProvider } from './embedding/cache.js';
import { createReranker } from './search/reranker.js';
import { getAgentById } from './db/agent-queries.js';
import type { VectorBackend } from './vector/interface.js';
import type { LLMCascadeConfig } from './llm/interface.js';
import type { LLMProvider } from './llm/interface.js';
import type { EmbeddingProvider } from './embedding/interface.js';

const log = createLogger('app');

export interface CortexRuntime {
  llmExtraction: LLMProvider;
  llmLifecycle: LLMProvider;
  gate: MemoryGate;
  sieve: MemorySieve;
  flush: MemoryFlush;
  lifecycle: LifecycleEngine;
}

export class CortexApp {
  gate: MemoryGate;
  sieve: MemorySieve;
  flush: MemoryFlush;
  lifecycle: LifecycleEngine;
  searchEngine: HybridSearchEngine;
  exporter: MarkdownExporter;
  readonly vectorBackend: VectorBackend;
  llmExtraction: LLMProvider;
  llmLifecycle: LLMProvider;
  embeddingProvider: EmbeddingProvider;
  private agentRuntimeCache = new Map<string, { cacheKey: string; runtime: CortexRuntime }>();

  constructor(public config: CortexConfig) {
    // Initialize providers
    this.llmExtraction = createCascadeLLM(config.llm.extraction);
    this.llmLifecycle = createCascadeLLM(config.llm.lifecycle);
    const baseEmbedding = createCascadeEmbedding(config.embedding);
    this.embeddingProvider = new CachedEmbeddingProvider(baseEmbedding, 2000);
    this.vectorBackend = createVectorBackend(config.vectorBackend as any);

    // Initialize engines
    const reranker = createReranker(config.search.reranker, this.llmExtraction);
    this.searchEngine = new HybridSearchEngine(this.vectorBackend, this.embeddingProvider, config.search);
    this.gate = new MemoryGate(this.searchEngine, config.gate, this.llmExtraction, reranker, config.search.reranker?.weight);
    this.sieve = new MemorySieve(this.llmExtraction, this.embeddingProvider, this.vectorBackend, config);
    this.flush = new MemoryFlush(this.llmExtraction, this.embeddingProvider, this.vectorBackend, config);
    this.lifecycle = new LifecycleEngine(this.llmLifecycle, this.embeddingProvider, this.vectorBackend, config);
    this.exporter = new MarkdownExporter(config);

    log.info('CortexApp initialized');
  }

  /**
   * Reload LLM/Embedding providers and dependent engines when config changes.
   * Only recreates providers whose config actually changed.
   * vectorBackend is NOT reloaded (requires restart).
   */
  async reloadProviders(newConfig: CortexConfig): Promise<string[]> {
    const reloaded: string[] = [];

    // Check extraction LLM
    if (hasProviderChanged(this.config.llm.extraction, newConfig.llm.extraction)) {
      this.llmExtraction = createCascadeLLM(newConfig.llm.extraction);
      reloaded.push('llm.extraction');
      log.info('Reloaded extraction LLM provider');
    }

    // Check lifecycle LLM
    if (hasProviderChanged(this.config.llm.lifecycle, newConfig.llm.lifecycle)) {
      this.llmLifecycle = createCascadeLLM(newConfig.llm.lifecycle);
      reloaded.push('llm.lifecycle');
      log.info('Reloaded lifecycle LLM provider');
    }

    // Check embedding
    if (hasProviderChanged(this.config.embedding, newConfig.embedding)) {
      const baseEmbedding = createCascadeEmbedding(newConfig.embedding);
      this.embeddingProvider = new CachedEmbeddingProvider(baseEmbedding, 2000);
      reloaded.push('embedding');
      log.info('Reloaded embedding provider');
      // Re-initialize vector backend so it rebuilds the vec0 table if dimensions changed
      await this.vectorBackend.initialize(this.embeddingProvider.dimensions || 1536);
      reloaded.push('vectorBackend');
      log.info({ dimensions: this.embeddingProvider.dimensions }, 'Re-initialized vector backend for new embedding dimensions');
    }

    // Check which engine configs changed
    const searchConfigChanged = JSON.stringify(this.config.search) !== JSON.stringify(newConfig.search);
    const gateConfigChanged = JSON.stringify(this.config.gate) !== JSON.stringify(newConfig.gate);
    const sieveConfigChanged = JSON.stringify(this.config.sieve) !== JSON.stringify(newConfig.sieve);
    const flushConfigChanged = JSON.stringify(this.config.flush) !== JSON.stringify(newConfig.flush);
    const lifecycleConfigChanged = JSON.stringify(this.config.lifecycle) !== JSON.stringify(newConfig.lifecycle);
    const exporterConfigChanged = JSON.stringify(this.config.markdownExport) !== JSON.stringify(newConfig.markdownExport);
    if (searchConfigChanged) reloaded.push('search');
    if (gateConfigChanged) reloaded.push('gate');
    if (sieveConfigChanged) reloaded.push('sieve');
    if (flushConfigChanged) reloaded.push('flush');
    if (lifecycleConfigChanged) reloaded.push('lifecycle');
    if (exporterConfigChanged) reloaded.push('markdownExport');

    // Only rebuild engines whose dependencies actually changed
    const embeddingChanged = reloaded.includes('embedding');
    const extractionChanged = reloaded.includes('llm.extraction');
    const lifecycleLLMChanged = reloaded.includes('llm.lifecycle');

    const needsSearchEngine = searchConfigChanged || embeddingChanged;
    const needsReranker = searchConfigChanged || extractionChanged;
    const needsGate = gateConfigChanged || needsSearchEngine || needsReranker || extractionChanged;
    const needsSieve = sieveConfigChanged || extractionChanged || embeddingChanged;
    const needsFlush = flushConfigChanged || extractionChanged || embeddingChanged;
    const needsLifecycle = lifecycleConfigChanged || lifecycleLLMChanged || embeddingChanged;
    const needsExporter = exporterConfigChanged;

    if (needsSearchEngine) {
      this.searchEngine = new HybridSearchEngine(this.vectorBackend, this.embeddingProvider, newConfig.search);
    }
    if (needsGate) {
      const reranker = createReranker(newConfig.search.reranker, this.llmExtraction);
      this.gate = new MemoryGate(this.searchEngine, newConfig.gate, this.llmExtraction, reranker, newConfig.search.reranker?.weight);
    }
    if (needsSieve) {
      this.sieve = new MemorySieve(this.llmExtraction, this.embeddingProvider, this.vectorBackend, newConfig);
    }
    if (needsFlush) {
      this.flush = new MemoryFlush(this.llmExtraction, this.embeddingProvider, this.vectorBackend, newConfig);
    }
    if (needsLifecycle) {
      this.lifecycle = new LifecycleEngine(this.llmLifecycle, this.embeddingProvider, this.vectorBackend, newConfig);
    }
    if (needsExporter) {
      this.exporter = new MarkdownExporter(newConfig);
    }

    if (reloaded.length > 0) {
      this.agentRuntimeCache.clear();
      log.info({ reloaded }, 'Rebuilt changed engines');
    }

    this.config = newConfig;
    return reloaded;
  }

  async initialize(): Promise<void> {
    // Initialize vector backend
    await this.vectorBackend.initialize(this.embeddingProvider.dimensions || 1536);
    log.info('Vector backend initialized');
  }

  async shutdown(): Promise<void> {
    await this.vectorBackend.close();
    log.info('CortexApp shut down');
  }

  getRuntime(agentId?: string): CortexRuntime {
    if (!agentId) {
      return this.getGlobalRuntime();
    }

    const override = this.getAgentOverride(agentId);
    const extractionOverride = override?.llm?.extraction;
    const lifecycleOverride = override?.llm?.lifecycle;

    if (!hasLLMConfigOverride(extractionOverride) && !hasLLMConfigOverride(lifecycleOverride)) {
      return this.getGlobalRuntime();
    }

    const extractionConfig = mergeLLMConfig(this.config.llm.extraction, extractionOverride);
    const lifecycleConfig = mergeLLMConfig(this.config.llm.lifecycle, lifecycleOverride);
    const cacheKey = JSON.stringify({
      extractionConfig,
      lifecycleConfig,
      gate: this.config.gate,
      searchReranker: this.config.search.reranker,
      sieve: this.config.sieve,
      flush: this.config.flush,
      lifecycle: this.config.lifecycle,
    });

    const cached = this.agentRuntimeCache.get(agentId);
    if (cached?.cacheKey === cacheKey) {
      return cached.runtime;
    }

    const llmExtraction = createCascadeLLM(extractionConfig);
    const llmLifecycle = createCascadeLLM(lifecycleConfig);
    const reranker = createReranker(this.config.search.reranker, llmExtraction);
    const runtime: CortexRuntime = {
      llmExtraction,
      llmLifecycle,
      gate: new MemoryGate(this.searchEngine, this.config.gate, llmExtraction, reranker, this.config.search.reranker?.weight),
      sieve: new MemorySieve(llmExtraction, this.embeddingProvider, this.vectorBackend, this.config),
      flush: new MemoryFlush(llmExtraction, this.embeddingProvider, this.vectorBackend, this.config),
      lifecycle: new LifecycleEngine(llmLifecycle, this.embeddingProvider, this.vectorBackend, this.config),
    };

    this.agentRuntimeCache.set(agentId, { cacheKey, runtime });
    return runtime;
  }

  private getGlobalRuntime(): CortexRuntime {
    return {
      llmExtraction: this.llmExtraction,
      llmLifecycle: this.llmLifecycle,
      gate: this.gate,
      sieve: this.sieve,
      flush: this.flush,
      lifecycle: this.lifecycle,
    };
  }

  private getAgentOverride(agentId: string): any | null {
    const agent = getAgentById(agentId);
    if (!agent?.config_override) return null;
    try {
      return JSON.parse(agent.config_override);
    } catch (e: any) {
      log.warn({ agentId, error: e.message }, 'Failed to parse agent config override');
      return null;
    }
  }
}

/** Compare old vs new provider config to decide if provider needs recreation */
function hasProviderChanged(
  oldCfg: LLMCascadeConfig | { provider?: string; model?: string; apiKey?: string; baseUrl?: string; dimensions?: number; timeoutMs?: number },
  newCfg: LLMCascadeConfig | { provider?: string; model?: string; apiKey?: string; baseUrl?: string; dimensions?: number; timeoutMs?: number },
): boolean {
  return JSON.stringify(oldCfg) !== JSON.stringify(newCfg);
}
