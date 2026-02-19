import type { EmbeddingProvider } from './interface.js';
import { OpenAIEmbeddingProvider } from './openai.js';
import { OllamaEmbeddingProvider } from './ollama.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('embed-cascade');

export class NullEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'none';
  readonly dimensions = 0;
  async embed(): Promise<number[]> { return []; }
  async embedBatch(texts: string[]): Promise<number[][]> { return texts.map(() => []); }
}

export class CascadeEmbedding implements EmbeddingProvider {
  readonly name = 'cascade';
  readonly dimensions: number;
  private providers: EmbeddingProvider[];

  constructor(providers: EmbeddingProvider[]) {
    this.providers = providers;
    this.dimensions = providers[0]?.dimensions || 0;
  }

  async embed(text: string): Promise<number[]> {
    for (const provider of this.providers) {
      try {
        return await provider.embed(text);
      } catch (e: any) {
        log.warn({ provider: provider.name, error: e.message }, 'Embedding provider failed, trying next');
        continue;
      }
    }
    log.error('All embedding providers failed');
    return [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    for (const provider of this.providers) {
      try {
        return await provider.embedBatch(texts);
      } catch (e: any) {
        log.warn({ provider: provider.name, error: e.message }, 'Embedding batch failed, trying next');
        continue;
      }
    }
    return texts.map(() => []);
  }
}

export function createEmbeddingProvider(config: {
  provider: string;
  model?: string;
  dimensions?: number;
  apiKey?: string;
  baseUrl?: string;
}): EmbeddingProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAIEmbeddingProvider(config);
    case 'ollama':
      return new OllamaEmbeddingProvider(config);
    case 'none':
      return new NullEmbeddingProvider();
    default:
      return new OpenAIEmbeddingProvider(config);
  }
}

export function createCascadeEmbedding(
  primary: { provider: string; model?: string; dimensions?: number; apiKey?: string; baseUrl?: string },
  fallback?: { provider: string; model?: string; dimensions?: number; apiKey?: string; baseUrl?: string }
): CascadeEmbedding {
  const providers: EmbeddingProvider[] = [createEmbeddingProvider(primary)];
  if (fallback && fallback.provider !== 'none') {
    providers.push(createEmbeddingProvider(fallback));
  }
  return new CascadeEmbedding(providers);
}
