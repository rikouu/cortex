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
import type { VectorBackend } from './vector/interface.js';
import type { LLMProvider } from './llm/interface.js';
import type { EmbeddingProvider } from './embedding/interface.js';

const log = createLogger('app');

export class CortexApp {
  readonly gate: MemoryGate;
  readonly sieve: MemorySieve;
  readonly flush: MemoryFlush;
  readonly lifecycle: LifecycleEngine;
  readonly searchEngine: HybridSearchEngine;
  readonly exporter: MarkdownExporter;
  readonly vectorBackend: VectorBackend;
  readonly llmExtraction: LLMProvider;
  readonly llmLifecycle: LLMProvider;
  readonly embeddingProvider: EmbeddingProvider;

  constructor(private config: CortexConfig) {
    // Initialize providers
    this.llmExtraction = createCascadeLLM(config.llm.extraction);
    this.llmLifecycle = createCascadeLLM(config.llm.lifecycle);
    this.embeddingProvider = createCascadeEmbedding(config.embedding);
    this.vectorBackend = createVectorBackend(config.vectorBackend as any);

    // Initialize engines
    this.searchEngine = new HybridSearchEngine(this.vectorBackend, this.embeddingProvider, config.search);
    this.gate = new MemoryGate(this.searchEngine, config.gate);
    this.sieve = new MemorySieve(this.llmExtraction, this.embeddingProvider, this.vectorBackend, config);
    this.flush = new MemoryFlush(this.llmExtraction, this.embeddingProvider, this.vectorBackend, config);
    this.lifecycle = new LifecycleEngine(this.llmLifecycle, this.embeddingProvider, this.vectorBackend, config);
    this.exporter = new MarkdownExporter(config);

    log.info('CortexApp initialized');
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
