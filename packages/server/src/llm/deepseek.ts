import type { LLMProvider, LLMCompletionOpts } from './interface.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('llm-deepseek');

export class DeepSeekLLMProvider implements LLMProvider {
  readonly name = 'deepseek';
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(opts: { apiKey?: string; model?: string; baseUrl?: string }) {
    this.apiKey = opts.apiKey || process.env.DEEPSEEK_API_KEY || '';
    this.model = opts.model || 'deepseek-chat';
    this.baseUrl = opts.baseUrl || 'https://api.deepseek.com/v1';
  }

  async complete(prompt: string, opts?: LLMCompletionOpts): Promise<string> {
    if (!this.apiKey) throw new Error('DeepSeek API key not configured');

    const messages: any[] = [];
    if (opts?.systemPrompt) {
      messages.push({ role: 'system', content: opts.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
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
      throw new Error(`DeepSeek API error ${res.status}: ${body}`);
    }

    const data = await res.json() as any;
    return data.choices?.[0]?.message?.content || '';
  }
}
