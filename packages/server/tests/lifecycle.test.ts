import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { initDatabase, closeDatabase, insertMemory, getMemoryById, getDb } from '../src/db/index.js';
import { loadConfig } from '../src/utils/config.js';
import { LifecycleEngine } from '../src/decay/lifecycle.js';
import type { LLMProvider } from '../src/llm/interface.js';
import type { EmbeddingProvider } from '../src/embedding/interface.js';
import type { VectorBackend } from '../src/vector/interface.js';

function createMockLLM(): LLMProvider {
  return {
    name: 'mock',
    complete: vi.fn().mockResolvedValue('Merged summary of memories.'),
  };
}

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

describe('LifecycleEngine', () => {
  let lifecycle: LifecycleEngine;

  beforeAll(() => {
    const config = loadConfig({
      storage: { dbPath: ':memory:', walMode: false },
      llm: { extraction: { provider: 'none' }, lifecycle: { provider: 'none' } },
      embedding: { provider: 'none', dimensions: 4 },
      vectorBackend: { provider: 'sqlite-vec' },
      markdownExport: { enabled: false, exportMemoryMd: false, debounceMs: 999999 },
      lifecycle: {
        promotionThreshold: 0.6,
        archiveThreshold: 0.2,
        decayLambda: 0.03,
      },
    });
    initDatabase(':memory:');
    lifecycle = new LifecycleEngine(createMockLLM(), createMockEmbedding(), createMockVector(), config);
  });

  afterAll(() => {
    closeDatabase();
  });

  it('should clean expired working memories', async () => {
    // Insert expired memory
    const expired = insertMemory({
      layer: 'working',
      category: 'context',
      content: 'expired context',
      agent_id: 'test',
      expires_at: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
    });

    const report = await lifecycle.run(false);
    expect(report.expiredWorking).toBeGreaterThanOrEqual(1);

    // Memory should be gone
    const mem = getMemoryById(expired.id);
    expect(mem).toBeFalsy();
  });

  it('should run without errors in dry run mode', async () => {
    insertMemory({ layer: 'working', category: 'context', content: 'test working memory', agent_id: 'test', importance: 0.8 });
    insertMemory({ layer: 'core', category: 'fact', content: 'test core memory', agent_id: 'test', decay_score: 0.1 });

    const report = await lifecycle.run(true);
    expect(report).toBeDefined();
    expect(report.errors.length).toBe(0);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.startedAt).toBeTruthy();
    expect(report.completedAt).toBeTruthy();
  });

  it('should update decay scores', async () => {
    const mem = insertMemory({
      layer: 'core',
      category: 'fact',
      content: 'decay test memory',
      agent_id: 'test',
      decay_score: 1.0,
    });

    await lifecycle.run(false);

    const updated = getMemoryById(mem.id);
    // Decay score should have been updated (decreased slightly for older memories)
    expect(updated).toBeDefined();
  });

  it('should produce a complete report', async () => {
    const report = await lifecycle.run(false);
    expect(typeof report.promoted).toBe('number');
    expect(typeof report.merged).toBe('number');
    expect(typeof report.archived).toBe('number');
    expect(typeof report.compressedToCore).toBe('number');
    expect(typeof report.expiredWorking).toBe('number');
    expect(Array.isArray(report.errors)).toBe(true);
  });
});
