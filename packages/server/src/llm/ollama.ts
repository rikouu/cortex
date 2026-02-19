import type { LLMProvider, LLMCompletionOpts } from './interface.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('llm-ollama');

export class OllamaLLMProvider implements LLMProvider {
  readonly name = 'ollama';
  private model: string;
  private baseUrl: string;

  constructor(opts: { model?: string; baseUrl?: string }) {
    this.model = opts.model || 'qwen2.5:3b';
    this.baseUrl = opts.baseUrl || 'http://localhost:11434';
  }

  async complete(prompt: string, opts?: LLMCompletionOpts): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: opts?.systemPrompt ? `${opts.systemPrompt}\n\n${prompt}` : prompt,
        stream: false,
        options: {
          temperature: opts?.temperature ?? 0.3,
          num_predict: opts?.maxTokens || 500,
        },
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama API error ${res.status}: ${body}`);
    }

    const data = await res.json() as any;
    return data.response || '';
  }
}
