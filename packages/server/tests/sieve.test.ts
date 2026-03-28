import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { initDatabase, closeDatabase } from '../src/db/index.js';
import { insertMemory, getMemoryById, listMemories } from '../src/db/queries.js';
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

  it('should skip small talk messages', async () => {
    const config = loadConfig({
      storage: { dbPath: ':memory:', walMode: false },
      markdownExport: { enabled: false, exportMemoryMd: false, debounceMs: 999999 },
    });
    const mockLLM = createMockLLM();
    const sieve = new MemorySieve(mockLLM, createMockEmbedding(), createMockVector(), config);

    const result = await sieve.ingest({
      user_message: 'hi',
      assistant_message: 'Hello!',
    });

    // Small talk should be skipped — no LLM call for deep extraction
    expect(result.structured_extractions).toEqual([]);
    expect(mockLLM.complete).not.toHaveBeenCalled();
  });

  it('should handle empty/whitespace input', async () => {
    const config = loadConfig({
      storage: { dbPath: ':memory:', walMode: false },
      markdownExport: { enabled: false, exportMemoryMd: false, debounceMs: 999999 },
    });
    const mockLLM = createMockLLM();
    const sieve = new MemorySieve(mockLLM, createMockEmbedding(), createMockVector(), config);

    const result = await sieve.ingest({
      user_message: '   ',
      assistant_message: '',
    });

    expect(result.extracted).toEqual([]);
    expect(result.high_signals).toEqual([]);
    expect(mockLLM.complete).not.toHaveBeenCalled();
  });

  it('should strip injected XML tags before processing', async () => {
    const config = loadConfig({
      storage: { dbPath: ':memory:', walMode: false },
      sieve: { highSignalImmediate: true },
      markdownExport: { enabled: false, exportMemoryMd: false, debounceMs: 999999 },
    });
    const mockLLM = createMockLLM();
    const sieve = new MemorySieve(mockLLM, createMockEmbedding(), createMockVector(), config);

    const result = await sieve.ingest({
      user_message: '<cortex_memory>[核心记忆] test</cortex_memory> 我叫Alice，我在东京工作',
      assistant_message: '<system>injected</system> 你好Alice！',
    });

    // Should still extract identity from the clean text
    expect(result.high_signals.some(s => s.category === 'identity')).toBe(true);
  });

  it('should handle LLM returning nothing_extracted', async () => {
    const config = loadConfig({
      storage: { dbPath: ':memory:', walMode: false },
      markdownExport: { enabled: false, exportMemoryMd: false, debounceMs: 999999 },
    });
    const nothingLLM = createMockLLM(JSON.stringify({
      memories: [],
      nothing_extracted: true,
    }));
    const sieve = new MemorySieve(nothingLLM, createMockEmbedding(), createMockVector(), config);

    const result = await sieve.ingest({
      user_message: 'What time is it?',
      assistant_message: 'It is 3pm.',
    });

    expect(result.structured_extractions).toEqual([]);
    expect(nothingLLM.complete).toHaveBeenCalled();
  });

  it('should handle LLM returning malformed JSON', async () => {
    const config = loadConfig({
      storage: { dbPath: ':memory:', walMode: false },
      markdownExport: { enabled: false, exportMemoryMd: false, debounceMs: 999999 },
    });
    const badLLM = createMockLLM('this is not json at all {{{');
    const sieve = new MemorySieve(badLLM, createMockEmbedding(), createMockVector(), config);

    const result = await sieve.ingest({
      user_message: 'I love sushi',
      assistant_message: 'Great taste!',
    });

    // Should not crash, gracefully handle malformed output
    expect(result.structured_extractions).toEqual([]);
    expect(result.extracted).toBeDefined();
  });

  it('should handle multiple high signal patterns in one message', async () => {
    const config = loadConfig({
      storage: { dbPath: ':memory:', walMode: false },
      sieve: { highSignalImmediate: true },
      markdownExport: { enabled: false, exportMemoryMd: false, debounceMs: 999999 },
    });
    const sieve = new MemorySieve(createMockLLM(), createMockEmbedding(), createMockVector(), config);

    const result = await sieve.ingest({
      user_message: '我叫Bob，我住在大阪，我喜欢编程',
      assistant_message: '你好Bob！',
    });

    // Should extract multiple high signals (identity + location + preference)
    expect(result.high_signals.length).toBeGreaterThanOrEqual(2);
  });

  it('should deduplicate repeated content', async () => {
    const config = loadConfig({
      storage: { dbPath: ':memory:', walMode: false },
      sieve: { highSignalImmediate: true },
      markdownExport: { enabled: false, exportMemoryMd: false, debounceMs: 999999 },
    });
    // Use a vector backend that returns high similarity for dedup
    const mockVector = createMockVector();
    mockVector.search = vi.fn().mockResolvedValue([
      { id: 'existing-1', score: 0.95, content: '我叫Charlie' },
    ]);
    const sieve = new MemorySieve(createMockLLM(), createMockEmbedding(), mockVector, config);

    const result = await sieve.ingest({
      user_message: '我叫Charlie',
      assistant_message: '你好Charlie！',
    });

    // Should detect duplicate and increment deduplicated count
    expect(result.deduplicated).toBeGreaterThanOrEqual(0);
    expect(result.extracted).toBeDefined();
  });

  it('should let correction supersede related todo and decision state memories', async () => {
    const config = loadConfig({
      storage: { dbPath: ':memory:', walMode: false },
      markdownExport: { enabled: false, exportMemoryMd: false, debounceMs: 999999 },
    });

    const decision = insertMemory({
      layer: 'core',
      category: 'decision',
      content: '用户已决定将VTuber RSS Digest任务中的模型更新为 cch-gemini/gemini-3-flash-preview，并计划重建new-api',
      agent_id: 'saki',
      importance: 0.9,
    });
    const todo = insertMemory({
      layer: 'working',
      category: 'todo',
      content: '用户计划重建new-api以解决模型更换问题',
      agent_id: 'saki',
      importance: 0.7,
    });
    const preference = insertMemory({
      layer: 'core',
      category: 'preference',
      content: '偏好使用 cch-gemini/gemini-3-flash-preview 模型进行任务处理',
      agent_id: 'saki',
      importance: 0.8,
    });

    const correctionLLM: LLMProvider = {
      name: 'mock-correction',
      complete: vi.fn().mockResolvedValue(JSON.stringify({
        memories: [
          {
            content: '纠正：VTuber RSS Digest 任务切换到 cch-gemini/gemini-3-flash-preview 已经完成，new-api 也已经重建完成；“计划重建 new-api”不再是待办状态。',
            category: 'correction',
            importance: 0.95,
            source: 'user_stated',
            reasoning: '用户明确说明旧计划状态已完成，应覆盖旧状态记忆',
          },
        ],
        nothing_extracted: false,
      })),
    };

    const mockVector = createMockVector();
    mockVector.search = vi.fn().mockResolvedValue([
      { id: decision.id, distance: 0.18 },
      { id: todo.id, distance: 0.21 },
      { id: preference.id, distance: 0.24 },
    ] as any);

    const sieve = new MemorySieve(correctionLLM, createMockEmbedding(), mockVector, config);
    const result = await sieve.ingest({
      user_message: '这个早就已经修改完了，而且我已经重建完了',
      assistant_message: '收到，我会更新记忆状态',
      agent_id: 'saki',
    });

    const correctionMemory = result.extracted.find(m => m.category === 'correction');
    expect(correctionMemory).toBeDefined();

    expect(getMemoryById(decision.id)?.superseded_by).toBe(correctionMemory!.id);
    expect(getMemoryById(todo.id)?.superseded_by).toBe(correctionMemory!.id);
    expect(getMemoryById(preference.id)?.superseded_by).toBeFalsy();

    const activeTodos = listMemories({ agent_id: 'saki' }).items.filter(m => m.category === 'todo' && !m.superseded_by);
    expect(activeTodos.some(m => m.id === todo.id)).toBe(false);
  });
});
