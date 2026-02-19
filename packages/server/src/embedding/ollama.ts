import type { EmbeddingProvider } from './interface.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('embed-ollama');

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  readonly dimensions: number;
  private model: string;
  private baseUrl: string;

  constructor(opts: { model?: string; dimensions?: number; baseUrl?: string }) {
    this.model = opts.model || 'bge-m3';
    this.dimensions = opts.dimensions || 1024;
    this.baseUrl = opts.baseUrl || 'http://localhost:11434';
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: text }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama Embedding error ${res.status}: ${body}`);
    }

    const data = await res.json() as any;
    return data.embeddings?.[0] || [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Ollama doesn't support batch natively, do sequential
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }
}
