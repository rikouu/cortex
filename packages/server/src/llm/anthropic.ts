import type { LLMProvider, LLMCompletionOpts } from './interface.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('llm-anthropic');

export class AnthropicLLMProvider implements LLMProvider {
  readonly name = 'anthropic';
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(opts: { apiKey?: string; model?: string; baseUrl?: string; timeoutMs?: number }) {
    this.apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.model = opts.model || 'claude-haiku-4-5';
    this.baseUrl = (opts.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs || 30000;
  }

  async complete(prompt: string, opts?: LLMCompletionOpts): Promise<string> {
    if (!this.apiKey) throw new Error('Anthropic API key not configured');

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: opts?.maxTokens || 500,
        // Use structured system message with cache_control for prompt caching
        system: opts?.systemPrompt
          ? [{ type: 'text', text: opts.systemPrompt, cache_control: { type: 'ephemeral' } }]
          : undefined,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${body}`);
    }

    const data = await res.json() as any;
    return data.content?.[0]?.text || '';
  }
}
