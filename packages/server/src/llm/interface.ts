export interface LLMProvider {
  readonly name: string;
  complete(prompt: string, opts?: { maxTokens?: number; temperature?: number; systemPrompt?: string }): Promise<string>;
}

export interface LLMCompletionOpts {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  /** Tracking label for metrics (e.g. 'sieve', 'smart_update', 'flush') */
  purpose?: string;
}
