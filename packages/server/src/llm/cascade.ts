import type { LLMProvider, LLMCompletionOpts } from './interface.js';
import { OpenAILLMProvider } from './openai.js';
import { AnthropicLLMProvider } from './anthropic.js';
import { OllamaLLMProvider } from './ollama.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('llm-cascade');

/**
 * Cascade LLM provider — tries providers in order, falls back on failure.
 */
export class CascadeLLM implements LLMProvider {
  readonly name = 'cascade';
  private providers: LLMProvider[];

  constructor(providers: LLMProvider[]) {
    this.providers = providers;
  }

  async complete(prompt: string, opts?: LLMCompletionOpts): Promise<string> {
    for (const provider of this.providers) {
      try {
        const result = await provider.complete(prompt, opts);
        return result;
      } catch (e: any) {
        log.warn({ provider: provider.name, error: e.message }, 'LLM provider failed, trying next');
        continue;
      }
    }
    log.error('All LLM providers failed');
    throw new Error('All LLM providers failed');
  }
}

/** Null provider — returns empty string (used when LLM is disabled) */
export class NullLLMProvider implements LLMProvider {
  readonly name = 'none';
  async complete(): Promise<string> { return ''; }
}

export function createLLMProvider(config: { provider: string; model?: string; apiKey?: string; baseUrl?: string }): LLMProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAILLMProvider(config);
    case 'anthropic':
      return new AnthropicLLMProvider(config);
    case 'ollama':
      return new OllamaLLMProvider(config);
    case 'none':
      return new NullLLMProvider();
    default:
      // Treat unknown as OpenAI-compatible (OpenRouter, etc.)
      return new OpenAILLMProvider(config);
  }
}

export function createCascadeLLM(
  primary: { provider: string; model?: string; apiKey?: string; baseUrl?: string },
  fallback?: { provider: string; model?: string; apiKey?: string; baseUrl?: string }
): CascadeLLM {
  const providers: LLMProvider[] = [createLLMProvider(primary)];
  if (fallback && fallback.provider !== 'none') {
    providers.push(createLLMProvider(fallback));
  }
  return new CascadeLLM(providers);
}
