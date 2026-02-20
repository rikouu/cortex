import type { EmbeddingProvider } from './interface.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('embed-google');

export class GoogleEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'google';
  readonly dimensions: number;
  private apiKey: string;
  private model: string;

  constructor(opts: { apiKey?: string; model?: string; dimensions?: number }) {
    this.apiKey = opts.apiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
    this.model = opts.model || 'text-embedding-004';
    this.dimensions = opts.dimensions || 768;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0]!;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) throw new Error('Google API key not configured');

    // Google embedding API processes one at a time (batch via multiple requests)
    const results: number[][] = [];
    for (const text of texts) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: `models/${this.model}`,
            content: { parts: [{ text }] },
            outputDimensionality: this.dimensions,
          }),
          signal: AbortSignal.timeout(15000),
        },
      );

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Google Embedding error ${res.status}: ${body}`);
      }

      const data = (await res.json()) as any;
      results.push(data.embedding?.values || []);
    }

    return results;
  }
}
