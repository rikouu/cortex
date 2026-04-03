import type { LLMProvider, LLMCompletionOpts } from './interface.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('llm-google');

export class GoogleLLMProvider implements LLMProvider {
  readonly name: string;
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(opts: { apiKey?: string; model?: string; baseUrl?: string; timeoutMs?: number; providerName?: string }) {
    this.name = opts.providerName || 'google';
    this.apiKey = opts.apiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
    this.model = opts.model || 'gemini-2.0-flash';
    this.baseUrl = (opts.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs || 30000;
  }

  async complete(prompt: string, opts?: LLMCompletionOpts): Promise<string> {
    if (!this.apiKey) throw new Error('Google API key not configured');

    const systemInstruction = opts?.systemPrompt
      ? { parts: [{ text: opts.systemPrompt }] }
      : undefined;

    const res = await fetch(
      `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction,
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: opts?.maxTokens || 500,
            temperature: opts?.temperature ?? 0.3,
          },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Google API error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as any;
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
}
