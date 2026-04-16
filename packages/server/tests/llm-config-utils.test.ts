import { describe, expect, it } from 'vitest';
import { mergeLLMConfig, preserveLLMApiKeys } from '../src/llm/config-utils.js';
import type { LLMCascadeConfig } from '../src/llm/interface.js';

describe('LLM config utils', () => {
  it('does not inherit provider-specific fields when switching providers', () => {
    const base: LLMCascadeConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'openai-key',
      baseUrl: 'https://openai.example/v1',
      timeoutMs: 1200,
      fallback: {
        provider: 'openrouter',
        model: 'meta-llama/llama-3.1-8b-instruct',
        apiKey: 'fallback-key',
        baseUrl: 'https://openrouter.example/api/v1',
        timeoutMs: 2400,
      },
      retry: {
        maxRetries: 2,
        baseDelayMs: 200,
      },
    };

    const merged = mergeLLMConfig(base, {
      provider: 'anthropic',
      timeoutMs: 1500,
      fallback: {
        provider: 'google',
        model: 'gemini-2.0-flash',
      },
    });

    expect(merged.provider).toBe('anthropic');
    expect(merged.model).toBeUndefined();
    expect(merged.apiKey).toBeUndefined();
    expect(merged.baseUrl).toBeUndefined();
    expect(merged.timeoutMs).toBe(1500);
    expect(merged.retry).toEqual({ maxRetries: 2, baseDelayMs: 200 });

    expect(merged.fallback).toEqual({
      provider: 'google',
      model: 'gemini-2.0-flash',
    });
  });

  it('preserves api keys only when provider is unchanged', () => {
    const sameProviderIncoming = {
      provider: 'openai',
      fallback: {
        provider: 'anthropic',
      },
    };
    const differentProviderIncoming = {
      provider: 'anthropic',
      fallback: {
        provider: 'google',
      },
    };
    const existing = {
      provider: 'openai',
      apiKey: 'openai-key',
      fallback: {
        provider: 'anthropic',
        apiKey: 'anthropic-key',
      },
    };

    preserveLLMApiKeys(sameProviderIncoming, existing);
    preserveLLMApiKeys(differentProviderIncoming, existing);

    expect(sameProviderIncoming).toEqual({
      provider: 'openai',
      apiKey: 'openai-key',
      fallback: {
        provider: 'anthropic',
        apiKey: 'anthropic-key',
      },
    });
    expect(differentProviderIncoming).toEqual({
      provider: 'anthropic',
      fallback: {
        provider: 'google',
      },
    });
  });
});
