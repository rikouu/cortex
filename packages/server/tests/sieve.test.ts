import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { initDatabase, closeDatabase } from '../src/db/index.js';
import { loadConfig } from '../src/utils/config.js';
import { MemorySieve } from '../src/core/sieve.js';
import type { LLMProvider } from '../src/llm/interface.js';
import type { EmbeddingProvider } from '../src/embedding/interface.js';
import type { VectorBackend } from '../src/vector/interface.js';

// Mock LLM that returns structured JSON extraction
function createMockLLM(response?: string): LLMProvider {
  const defaultResponse = JSON.stringify({
    memories: [
      {
        content: 'User is interested in Tokyo real estate investment',
        category: 'fact',
        importance: 0.7,
        source: 'user_implied',
        reasoning: 'User asked about Tokyo real estate prices',
      },
    ],
    nothing_extracted: false,
  });
  return {
    name: 'mock',
    complete: vi.fn().mockResolvedValue(response ?? defaultResponse),
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

describe('MemorySieve', () => {
  beforeAll(() => {
    loadConfig({
      storage: { dbPath: ':memory:', walMode: false },
      llm: { extraction: { provider: 'none' }, lifecycle: { provider: 'none' } },
      embedding: { provider: 'none', dimensions: 4 },
      vectorBackend: { provider: 'sqlite-vec' },
      markdownExport: { enabled: false, exportMemoryMd: false, debounceMs: 999999 },
    });
    initDatabase(':memory:');
  });

  afterAll(() => {
    closeDatabase();
  });

  it('should extract high signals immediately', async () => {
    const config = loadConfig({
      storage: { dbPath: ':memory:', walMode: false },
      sieve: { highSignalImmediate: true },
      markdownExport: { enabled: false, exportMemoryMd: false, debounceMs: 999999 },
    });
    const sieve = new MemorySieve(createMockLLM(), createMockEmbedding(), createMockVector(), config);

    const result = await sieve.ingest({
      user_message: '我叫Harry，我是一个投资者',
      assistant_message: '你好Harry！',
    });

    expect(result.high_signals.length).toBeGreaterThan(0);
    expect(result.high_signals.some(s => s.category === 'identity')).toBe(true);
    expect(result.extracted.length).toBeGreaterThan(0);
  });

  it('should store LLM structured extractions', async () => {
    const config = loadConfig({
      storage: { dbPath: ':memory:', walMode: false },
      markdownExport: { enabled: false, exportMemoryMd: false, debounceMs: 999999 },
    });
    const mockLLM = createMockLLM();
    const sieve = new MemorySieve(mockLLM, createMockEmbedding(), createMockVector(), config);

    const result = await sieve.ingest({
      user_message: 'Tell me about Tokyo real estate prices',
      assistant_message: 'Tokyo real estate has been rising...',
    });

    expect(result.structured_extractions.length).toBeGreaterThan(0);
    expect(result.structured_extractions[0]!.category).toBe('fact');
    expect(mockLLM.complete).toHaveBeenCalled();
  });

  it('should handle LLM failure gracefully', async () => {
    const config = loadConfig({
      storage: { dbPath: ':memory:', walMode: false },
      markdownExport: { enabled: false, exportMemoryMd: false, debounceMs: 999999 },
    });
    const failLLM: LLMProvider = {
      name: 'fail',
      complete: vi.fn().mockRejectedValue(new Error('API error')),
    };
    const sieve = new MemorySieve(failLLM, createMockEmbedding(), createMockVector(), config);

    const result = await sieve.ingest({
      user_message: 'Some message',
      assistant_message: 'Some response',
    });

    // Should still work, with empty extractions
    expect(result.structured_extractions).toEqual([]);
    expect(result.extracted).toBeDefined();
  });
});
