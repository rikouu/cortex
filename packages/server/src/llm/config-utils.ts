import type { LLMCascadeConfig, LLMProviderConfig, LLMRetryConfig } from './interface.js';

export const DEFAULT_LLM_RETRY = Object.freeze({
  maxRetries: 2,
  baseDelayMs: 200,
});

export interface EffectiveLLMRetryConfig {
  maxRetries: number;
  baseDelayMs: number;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function normalizeLLMRetryConfig(retry?: LLMRetryConfig): EffectiveLLMRetryConfig {
  return {
    maxRetries: clampInt(retry?.maxRetries ?? DEFAULT_LLM_RETRY.maxRetries, 0, 10),
    baseDelayMs: clampInt(retry?.baseDelayMs ?? DEFAULT_LLM_RETRY.baseDelayMs, 0, 5_000),
  };
}

function getRetryInput(config?: Partial<LLMCascadeConfig> | null): LLMRetryConfig | undefined {
  if (!config) return undefined;
  const retry = {
    ...(config.retry ?? {}),
    ...((config as any).maxRetries !== undefined ? { maxRetries: (config as any).maxRetries } : {}),
    ...((config as any).baseDelayMs !== undefined ? { baseDelayMs: (config as any).baseDelayMs } : {}),
  };
  return Object.keys(retry).length > 0 ? retry : undefined;
}

function cloneProviderConfig(config: LLMProviderConfig): LLMProviderConfig {
  return { ...config };
}

function createProviderConfig(
  provider: string,
  config?: Partial<LLMProviderConfig> | null,
): LLMProviderConfig {
  return {
    provider,
    ...(config?.model !== undefined ? { model: config.model } : {}),
    ...(config?.apiKey !== undefined ? { apiKey: config.apiKey } : {}),
    ...(config?.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
    ...(config?.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
  };
}

function mergeProviderConfig(
  base: LLMProviderConfig,
  override?: Partial<LLMProviderConfig> | null,
): LLMProviderConfig {
  if (!override) {
    return cloneProviderConfig(base);
  }

  if (override.provider === undefined || override.provider === base.provider) {
    return {
      ...base,
      ...override,
      provider: base.provider,
    };
  }

  return createProviderConfig(override.provider, override);
}

export function mergeLLMConfig(
  base: LLMCascadeConfig,
  override?: Partial<LLMCascadeConfig> | null,
): LLMCascadeConfig {
  if (!override) {
    return {
      ...base,
      fallback: base.fallback ? { ...base.fallback } : undefined,
      retry: base.retry ? { ...base.retry } : undefined,
    };
  }

  const mergedProvider = mergeProviderConfig(base, override);
  const merged: LLMCascadeConfig = {
    ...mergedProvider,
    retry: getRetryInput(override) === undefined
      ? (base.retry ? { ...base.retry } : undefined)
      : { ...(base.retry ?? {}), ...getRetryInput(override) },
  };

  if (override.fallback === undefined) {
    merged.fallback = base.fallback ? { ...base.fallback } : undefined;
  } else if (override.fallback === null) {
    merged.fallback = undefined;
  } else if (override.fallback.provider === 'none') {
    merged.fallback = {
      provider: 'none',
      model: override.fallback.model ?? '',
      baseUrl: override.fallback.baseUrl ?? '',
      timeoutMs: override.fallback.timeoutMs,
      ...(override.fallback.apiKey ? { apiKey: override.fallback.apiKey } : {}),
    };
  } else {
    merged.fallback = base.fallback
      ? mergeProviderConfig(base.fallback, override.fallback)
      : createProviderConfig(override.fallback.provider, override.fallback);
  }

  return merged;
}

export function hasLLMConfigOverride(override?: Partial<LLMCascadeConfig> | null): boolean {
  if (!override) return false;
  return Object.keys(override).length > 0;
}

function sanitizeProviderConfig(config?: Partial<LLMProviderConfig> | null): Record<string, any> | undefined {
  if (!config) return undefined;
  return {
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    hasApiKey: config.provider === 'none' ? false : !!config.apiKey,
  };
}

export function sanitizeLLMConfig(config?: Partial<LLMCascadeConfig> | null): Record<string, any> | undefined {
  if (!config) return undefined;
  return {
    ...sanitizeProviderConfig(config),
    fallback: sanitizeProviderConfig(config.fallback),
    retry: normalizeLLMRetryConfig(getRetryInput(config)),
  };
}

export function preserveLLMApiKeys(incoming?: any, existing?: any): void {
  if (!incoming || !existing) return;

  const canPreservePrimaryKey = incoming.provider === undefined || incoming.provider === existing.provider;
  if (canPreservePrimaryKey && incoming.provider !== 'none' && incoming.apiKey === undefined && existing.apiKey) {
    incoming.apiKey = existing.apiKey;
  }

  const canPreserveFallbackKey =
    incoming.fallback?.provider === undefined || incoming.fallback?.provider === existing.fallback?.provider;
  if (
    incoming.fallback &&
    existing.fallback &&
    canPreserveFallbackKey &&
    incoming.fallback.provider !== 'none' &&
    incoming.fallback.apiKey === undefined &&
    existing.fallback.apiKey
  ) {
    incoming.fallback.apiKey = existing.fallback.apiKey;
  }
}
