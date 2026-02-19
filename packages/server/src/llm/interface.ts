export interface LLMProvider {
  readonly name: string;
  complete(prompt: string, opts?: { maxTokens?: number; temperature?: number; systemPrompt?: string }): Promise<string>;
}

export interface LLMCompletionOpts {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}
