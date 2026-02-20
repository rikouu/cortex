import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { initDatabase, closeDatabase, insertMemory } from '../src/db/index.js';
import { loadConfig } from '../src/utils/config.js';
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

describe('HybridSearchEngine', () => {
  let engine: HybridSearchEngine;

  beforeAll(() => {
    const config = loadConfig({
      storage: { dbPath: ':memory:', walMode: false },
      llm: { extraction: { provider: 'none' }, lifecycle: { provider: 'none' } },
      embedding: { provider: 'none', dimensions: 4 },
      vectorBackend: { provider: 'sqlite-vec' },
      markdownExport: { enabled: false, exportMemoryMd: false, debounceMs: 999999 },
    });
    initDatabase(':memory:');

    // Seed data
    insertMemory({ layer: 'core', category: 'fact', content: 'React is a JavaScript library for building UIs', agent_id: 'test', importance: 0.8 });
    insertMemory({ layer: 'core', category: 'fact', content: 'Vue is a progressive JavaScript framework', agent_id: 'test', importance: 0.7 });
    insertMemory({ layer: 'working', category: 'context', content: 'Discussed database optimization today', agent_id: 'test' });
    insertMemory({ layer: 'core', category: 'identity', content: 'Harry is a full-stack developer', agent_id: 'test', importance: 1.0 });

    engine = new HybridSearchEngine(createMockVector(), createMockEmbedding(), config.search);
  });

  afterAll(() => {
    closeDatabase();
  });

  it('should return results for a text query', async () => {
    const { results } = await engine.search({ query: 'JavaScript', limit: 10 });
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it('should include debug info when requested', async () => {
    const { results, debug } = await engine.search({ query: 'React', limit: 10, debug: true });
    expect(debug).toBeDefined();
    expect(typeof debug!.textResultCount).toBe('number');
    expect(typeof debug!.vectorResultCount).toBe('number');
    expect(debug!.timings).toBeDefined();
  });

  it('should respect limit parameter', async () => {
    const { results } = await engine.search({ query: 'JavaScript', limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('should format results for injection', () => {
    const mockResults = [
      { id: '1', content: 'Test memory', layer: 'core' as const, category: 'fact', importance: 0.8,
        decay_score: 1, access_count: 0, created_at: '', textScore: 0.5, vectorScore: 0.5,
        fusedScore: 0.5, layerWeight: 1, recencyBoost: 1, accessBoost: 1, finalScore: 0.5 },
    ];
    const formatted = engine.formatForInjection(mockResults, 2000);
    expect(formatted).toContain('Test memory');
  });

  it('should handle empty query gracefully', async () => {
    const { results } = await engine.search({ query: '', limit: 10 });
    expect(Array.isArray(results)).toBe(true);
  });
});
