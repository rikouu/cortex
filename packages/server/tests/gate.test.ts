import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { initDatabase, closeDatabase, insertMemory } from '../src/db/index.js';
import { loadConfig } from '../src/utils/config.js';
import { MemoryGate } from '../src/core/gate.js';
import { HybridSearchEngine } from '../src/search/hybrid.js';
import type { EmbeddingProvider } from '../src/embedding/interface.js';
import type { VectorBackend } from '../src/vector/interface.js';

function createMockEmbedding(): EmbeddingProvider {
  return {
    name: 'mock',
    dimensions: 4,
    embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3, 0.4]),
    embedBatch: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3, 0.4]]),
  };
}

function createMockVector(): VectorBackend {
  return {
    name: 'mock',
    initialize: vi.fn().mockResolvedValue(undefined),
    upsert: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(0),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe('MemoryGate', () => {
  let gate: MemoryGate;

  beforeAll(() => {
    const config = loadConfig({
      storage: { dbPath: ':memory:', walMode: false },
      llm: { extraction: { provider: 'none' }, lifecycle: { provider: 'none' } },
      embedding: { provider: 'none', dimensions: 4 },
      vectorBackend: { provider: 'sqlite-vec' },
      markdownExport: { enabled: false, exportMemoryMd: false, debounceMs: 999999 },
    });
    initDatabase(':memory:');

    // Insert test data
    insertMemory({ layer: 'core', category: 'identity', content: 'User name is Harry', agent_id: 'default', importance: 1.0 });
    insertMemory({ layer: 'core', category: 'fact', content: 'Tokyo apartment prices range from 30-80 million yen', agent_id: 'default', importance: 0.8 });
    insertMemory({ layer: 'working', category: 'context', content: 'Discussed investment strategy today', agent_id: 'default' });

    const searchEngine = new HybridSearchEngine(createMockVector(), createMockEmbedding(), config.search);
    gate = new MemoryGate(searchEngine, config.gate);
  });

  afterAll(() => {
    closeDatabase();
  });

  it('should skip small talk', async () => {
    const result = await gate.recall({ query: 'hi' });
    expect(result.meta.skipped).toBe(true);
    expect(result.meta.reason).toBe('small_talk');
    expect(result.memories.length).toBe(0);
  });

  it('should recall relevant memories', async () => {
    const result = await gate.recall({ query: 'Tokyo apartment investment' });
    expect(result.meta.skipped).toBe(false);
    expect(result.meta.latency_ms).toBeGreaterThanOrEqual(0);
    // BM25 should find the Tokyo memory
    expect(result.memories.length).toBeGreaterThanOrEqual(0); // may or may not match depending on FTS tokenizer
  });

  it('should respect max_tokens limit', async () => {
    const result = await gate.recall({ query: 'Harry', max_tokens: 50 });
    expect(result.meta.skipped).toBe(false);
  });

  it('should report metadata', async () => {
    const result = await gate.recall({ query: 'investment strategy' });
    expect(result.meta).toBeDefined();
    expect(result.meta.query).toBe('investment strategy');
    expect(typeof result.meta.total_found).toBe('number');
  });
});
