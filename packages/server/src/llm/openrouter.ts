import type { LLMProvider, LLMCompletionOpts } from './interface.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('llm-openrouter');

/**
 * OpenRouter LLM Provider — routes to any model via OpenRouter's unified API.
 * Uses OpenAI-compatible format.
 */
export class OpenRouterLLMProvider implements LLMProvider {
  readonly name = 'openrouter';
  private apiKey: string;
  private model: string;

  constructor(opts: { apiKey?: string; model?: string }) {
    this.apiKey = opts.apiKey || process.env.OPENROUTER_API_KEY || '';
    this.model = opts.model || 'anthropic/claude-haiku-4-5';
  }

  async complete(prompt: string, opts?: LLMCompletionOpts): Promise<string> {
    if (!this.apiKey) throw new Error('OpenRouter API key not configured');

    const messages: any[] = [];
    if (opts?.systemPrompt) {
      messages.push({ role: 'system', content: opts.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://github.com/rikouu/cortex',
        'X-Title': 'Cortex Memory Service',
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: opts?.maxTokens || 500,
        temperature: opts?.temperature ?? 0.3,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenRouter API error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as any;
    return data.choices?.[0]?.message?.content || '';
  }
}
