export interface LLMProvider {
  readonly name: string;
  complete(prompt: string, opts?: { maxTokens?: number; temperature?: number; systemPrompt?: string }): Promise<string>;
}

export interface LLMProviderConfig {
  provider: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface LLMRetryConfig {
  maxRetries?: number;
  baseDelayMs?: number;
}

export interface LLMCascadeConfig extends LLMProviderConfig {
  fallback?: LLMProviderConfig;
  retry?: LLMRetryConfig;
}

export interface LLMCompletionOpts {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  /** Tracking label for metrics (e.g. 'sieve', 'smart_update', 'flush') */
  purpose?: string;
}
