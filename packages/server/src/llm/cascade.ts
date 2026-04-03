import type { LLMProvider, LLMCompletionOpts, LLMCascadeConfig, LLMProviderConfig } from './interface.js';
import { OpenAILLMProvider } from './openai.js';
import { AnthropicLLMProvider } from './anthropic.js';
import { OllamaLLMProvider } from './ollama.js';
import { GoogleLLMProvider } from './google.js';
import { OpenRouterLLMProvider } from './openrouter.js';
import { DeepSeekLLMProvider } from './deepseek.js';
import { normalizeLLMRetryConfig } from './config-utils.js';
import { createLogger } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';

const log = createLogger('llm-cascade');

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface CascadeAttemptMeta {
  provider: string;
  attempt: number;
  totalAttempts: number;
}

/**
 * Cascade LLM provider — tries providers in order, falls back on failure.
 */
export class CascadeLLM implements LLMProvider {
  readonly name = 'cascade';
  private providers: LLMProvider[];
  private retryConfig: ReturnType<typeof normalizeLLMRetryConfig>;
  private lastAttemptMeta: CascadeAttemptMeta | null = null;

  constructor(providers: LLMProvider[], retry?: LLMCascadeConfig['retry']) {
    this.providers = providers;
    this.retryConfig = normalizeLLMRetryConfig(retry);
  }

  getLastAttemptMeta(): CascadeAttemptMeta | null {
    return this.lastAttemptMeta;
  }

  async complete(prompt: string, opts?: LLMCompletionOpts): Promise<string> {
    this.lastAttemptMeta = null;
    const purpose = opts?.purpose || 'unknown';
    const failures: string[] = [];
    let totalAttempts = 0;
    const primaryProvider = this.providers[0]?.name;

    for (const [providerIndex, provider] of this.providers.entries()) {
      let lastError: any = null;
      const maxAttempts = this.retryConfig.maxRetries + 1;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        totalAttempts++;
        try {
          const start = Date.now();
          const result = await provider.complete(prompt, opts);
          const latencyMs = Date.now() - start;
          metrics.inc('llm_calls_total', { provider: provider.name, purpose });
          metrics.observe('llm_latency_ms', latencyMs);
          this.lastAttemptMeta = { provider: provider.name, attempt, totalAttempts };

          const logMeta = {
            provider: provider.name,
            attempt,
            totalAttempts,
            purpose,
            latency_ms: latencyMs,
          };
          if (providerIndex > 0) {
            log.info(
              {
                ...logMeta,
                primary_provider: primaryProvider,
              },
              'LLM fallback provider succeeded',
            );
          } else if (attempt > 1) {
            log.info(logMeta, 'LLM provider succeeded after retry');
          } else {
            log.info(logMeta, 'LLM provider succeeded');
          }

          return result;
        } catch (e: any) {
          lastError = e;
          const message = e?.message || String(e);
          const willRetry = attempt < maxAttempts;

          if (willRetry) {
            const delayMs = this.retryConfig.baseDelayMs * (2 ** (attempt - 1));
            metrics.inc('llm_retry_attempts_total', { provider: provider.name, purpose });
            log.warn(
              { provider: provider.name, attempt, maxAttempts, delayMs, error: message, purpose },
              'LLM provider attempt failed, retrying',
            );
            await sleep(delayMs);
            continue;
          }

          failures.push(`${provider.name}: ${message}`);
          log.warn(
            { provider: provider.name, attempts: maxAttempts, error: message, purpose },
            'LLM provider failed, trying next',
          );
        }
      }

      if (lastError && provider !== this.providers[this.providers.length - 1]) {
        metrics.inc('llm_failovers_total', { provider: provider.name, purpose });
      }
    }

    const errorMessage = `All LLM providers failed after ${totalAttempts} attempts: ${failures.join(' | ')}`;
    log.error({ totalAttempts, failures }, 'All LLM providers failed');
    throw new Error(errorMessage);
  }
}

/** Null provider — returns empty string (used when LLM is disabled) */
export class NullLLMProvider implements LLMProvider {
  readonly name = 'none';
  async complete(): Promise<string> { return ''; }
}

export function createLLMProvider(config: LLMProviderConfig): LLMProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAILLMProvider({ ...config, providerName: config.provider });
    case 'anthropic':
      return new AnthropicLLMProvider(config);
    case 'google':
    case 'gemini':
      return new GoogleLLMProvider({ ...config, providerName: config.provider });
    case 'deepseek':
      return new DeepSeekLLMProvider(config);
    case 'dashscope':
      return new OpenAILLMProvider({
        ...config,
        apiKey: config.apiKey || process.env.DASHSCOPE_API_KEY || '',
        baseUrl: config.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        providerName: 'dashscope',
      });
    case 'openrouter':
      return new OpenRouterLLMProvider(config);
    case 'ollama':
      return new OllamaLLMProvider(config);
    case 'none':
      return new NullLLMProvider();
    default:
      // Treat unknown as OpenAI-compatible (OpenRouter, etc.)
      return new OpenAILLMProvider(config);
  }
}

export function createCascadeLLM(config: LLMCascadeConfig): CascadeLLM {
  const providers: LLMProvider[] = [];
  if (config.provider !== 'none' || !config.fallback || config.fallback.provider === 'none') {
    providers.push(createLLMProvider(config));
  }
  if (config.fallback && config.fallback.provider !== 'none') {
    providers.push(createLLMProvider(config.fallback));
  }
  return new CascadeLLM(providers, config.retry);
}
