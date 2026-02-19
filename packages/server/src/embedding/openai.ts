import type { EmbeddingProvider } from './interface.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('embed-openai');

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly dimensions: number;
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(opts: { apiKey?: string; model?: string; dimensions?: number; baseUrl?: string }) {
    this.apiKey = opts.apiKey || process.env.OPENAI_API_KEY || '';
    this.model = opts.model || 'text-embedding-3-small';
    this.dimensions = opts.dimensions || 1536;
    this.baseUrl = opts.baseUrl || 'https://api.openai.com/v1';
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0]!;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) throw new Error('OpenAI API key not configured');

    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: this.dimensions,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI Embedding error ${res.status}: ${body}`);
    }

    const data = await res.json() as any;
    return data.data.map((d: any) => d.embedding);
  }
}
