import { type CortexConfig, getConfig } from './utils/config.js';
import { createLogger } from './utils/logger.js';
import { MemoryGate } from './core/gate.js';
import { MemorySieve } from './core/sieve.js';
import { MemoryFlush } from './core/flush.js';
import { LifecycleEngine } from './decay/lifecycle.js';
import { HybridSearchEngine } from './search/hybrid.js';
import { MarkdownExporter } from './export/markdown.js';
import { createVectorBackend } from './vector/index.js';
import { createCascadeLLM } from './llm/cascade.js';
import { createCascadeEmbedding } from './embedding/cascade.js';
import { CachedEmbeddingProvider } from './embedding/cache.js';
import { createReranker } from './search/reranker.js';
import type { VectorBackend } from './vector/interface.js';
import type { LLMProvider } from './llm/interface.js';
import type { EmbeddingProvider } from './embedding/interface.js';

const log = createLogger('app');

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
    this.gate = new MemoryGate(this.searchEngine, config.gate, this.llmExtraction, reranker);
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
  reloadProviders(newConfig: CortexConfig): string[] {
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
    }

    // Check if search/gate config changed (reranker, query expansion, etc.)
    const searchConfigChanged = JSON.stringify(this.config.search) !== JSON.stringify(newConfig.search);
    const gateConfigChanged = JSON.stringify(this.config.gate) !== JSON.stringify(newConfig.gate);
    if (searchConfigChanged) reloaded.push('search');
    if (gateConfigChanged) reloaded.push('gate');

    // Rebuild dependent engines if any provider or config changed
    if (reloaded.length > 0) {
      const reranker = createReranker(newConfig.search.reranker, this.llmExtraction);
      this.searchEngine = new HybridSearchEngine(this.vectorBackend, this.embeddingProvider, newConfig.search);
      this.gate = new MemoryGate(this.searchEngine, newConfig.gate, this.llmExtraction, reranker);
      this.sieve = new MemorySieve(this.llmExtraction, this.embeddingProvider, this.vectorBackend, newConfig);
      this.flush = new MemoryFlush(this.llmExtraction, this.embeddingProvider, this.vectorBackend, newConfig);
      this.lifecycle = new LifecycleEngine(this.llmLifecycle, this.embeddingProvider, this.vectorBackend, newConfig);
      log.info({ reloaded }, 'Rebuilt dependent engines');
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
}

/** Compare old vs new provider config to decide if provider needs recreation */
function hasProviderChanged(
  oldCfg: { provider?: string; model?: string; apiKey?: string; baseUrl?: string },
  newCfg: { provider?: string; model?: string; apiKey?: string; baseUrl?: string },
): boolean {
  if (newCfg.provider !== oldCfg.provider) return true;
  if (newCfg.model !== oldCfg.model) return true;
  if (newCfg.baseUrl !== oldCfg.baseUrl) return true;
  // Only compare apiKey if the new config actually provides one (non-empty)
  if (newCfg.apiKey && newCfg.apiKey !== oldCfg.apiKey) return true;
  return false;
}
