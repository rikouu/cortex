import { afterEach, describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: {
    child: vi.fn(() => loggerMocks),
  },
  createLogger: vi.fn(() => loggerMocks),
  setLogLevel: vi.fn(),
  getLogLevel: vi.fn(),
  getLogBuffer: vi.fn(),
}));

import { CascadeLLM } from '../src/llm/cascade.js';
import { OpenAILLMProvider } from '../src/llm/openai.js';
import type { LLMProvider } from '../src/llm/interface.js';

function createMockProvider(name: string, responses: Array<string | Error>): LLMProvider & { complete: ReturnType<typeof vi.fn> } {
  let index = 0;
  return {
    name,
    complete: vi.fn(async () => {
      const next = responses[Math.min(index, responses.length - 1)]!;
      index++;
      if (next instanceof Error) throw next;
      return next;
    }),
  };
}

describe('CascadeLLM', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('logs direct primary success at info level', async () => {
    const provider = createMockProvider('primary', ['ok']);

    const cascade = new CascadeLLM([provider], { maxRetries: 2, baseDelayMs: 0 });
    await expect(cascade.complete('hello', { purpose: 'unit_test' })).resolves.toBe('ok');

    expect(loggerMocks.info).toHaveBeenCalledTimes(1);
    expect(loggerMocks.info).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'primary',
        attempt: 1,
        totalAttempts: 1,
        purpose: 'unit_test',
        latency_ms: expect.any(Number),
      }),
      'LLM provider succeeded',
    );
  });

  it('retries the same provider before failing over', async () => {
    const provider = createMockProvider('primary', [
      new Error('transient-1'),
      new Error('transient-2'),
      'ok',
    ]);

    const cascade = new CascadeLLM([provider], { maxRetries: 2, baseDelayMs: 0 });
    await expect(cascade.complete('hello', { purpose: 'unit_test' })).resolves.toBe('ok');
    expect(provider.complete).toHaveBeenCalledTimes(3);
    expect(cascade.getLastAttemptMeta()).toEqual({
      provider: 'primary',
      attempt: 3,
      totalAttempts: 3,
    });
    expect(loggerMocks.info).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'primary',
        attempt: 3,
        totalAttempts: 3,
        purpose: 'unit_test',
        latency_ms: expect.any(Number),
      }),
      'LLM provider succeeded after retry',
    );
  });

  it('fails over to the fallback provider after exhausting retries', async () => {
    const primary = createMockProvider('primary', [
      new Error('primary-down-1'),
      new Error('primary-down-2'),
    ]);
    const fallback = createMockProvider('fallback', ['fallback-ok']);

    const cascade = new CascadeLLM([primary, fallback], { maxRetries: 1, baseDelayMs: 0 });
    await expect(cascade.complete('hello', { purpose: 'unit_test' })).resolves.toBe('fallback-ok');
    expect(primary.complete).toHaveBeenCalledTimes(2);
    expect(fallback.complete).toHaveBeenCalledTimes(1);
    expect(cascade.getLastAttemptMeta()).toEqual({
      provider: 'fallback',
      attempt: 1,
      totalAttempts: 3,
    });
    expect(loggerMocks.info).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'fallback',
        primary_provider: 'primary',
        attempt: 1,
        totalAttempts: 3,
        purpose: 'unit_test',
        latency_ms: expect.any(Number),
      }),
      'LLM fallback provider succeeded',
    );
  });

  it('uses the configured provider timeout instead of the hard-coded default', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal;
        signal.addEventListener('abort', () => reject(signal.reason || new Error('aborted')), { once: true });
      });
    });
    vi.stubGlobal('fetch', fetchMock as any);

    const provider = new OpenAILLMProvider({ apiKey: 'test-key', timeoutMs: 5 });
    await expect(provider.complete('hello')).rejects.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
