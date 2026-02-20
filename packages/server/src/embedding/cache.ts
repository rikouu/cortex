import { createLogger } from '../utils/logger.js';
import type { EmbeddingProvider } from './interface.js';

const log = createLogger('embed-cache');

/**
 * LRU cache wrapper around an EmbeddingProvider.
 * Caches embeddings by text content hash to avoid redundant API calls.
 */
export class CachedEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  private cache: Map<string, { embedding: number[]; usedAt: number }>;
  private maxSize: number;

  constructor(private inner: EmbeddingProvider, maxSize = 1000) {
    this.name = `cached(${inner.name})`;
    this.dimensions = inner.dimensions;
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  private hashKey(text: string): string {
    // Simple FNV-1a hash for fast key generation
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(36) + ':' + text.length;
  }

  private evictIfNeeded(): void {
    if (this.cache.size <= this.maxSize) return;

    // Evict least recently used entries
    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => a[1].usedAt - b[1].usedAt);
    const toEvict = entries.slice(0, Math.floor(this.maxSize * 0.2));
    for (const [key] of toEvict) {
      this.cache.delete(key);
    }
    log.debug({ evicted: toEvict.length, remaining: this.cache.size }, 'Cache eviction');
  }

  async embed(text: string): Promise<number[]> {
    const key = this.hashKey(text);
    const cached = this.cache.get(key);
    if (cached) {
      cached.usedAt = Date.now();
      return cached.embedding;
    }

    const embedding = await this.inner.embed(text);
    this.evictIfNeeded();
    this.cache.set(key, { embedding, usedAt: Date.now() });
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: (number[] | null)[] = new Array(texts.length).fill(null);
    const uncached: { index: number; text: string }[] = [];

    // Check cache for each text
    for (let i = 0; i < texts.length; i++) {
      const key = this.hashKey(texts[i]!);
      const cached = this.cache.get(key);
      if (cached) {
        cached.usedAt = Date.now();
        results[i] = cached.embedding;
      } else {
        uncached.push({ index: i, text: texts[i]! });
      }
    }

    // Fetch uncached embeddings
    if (uncached.length > 0) {
      const newEmbeddings = await this.inner.embedBatch(uncached.map(u => u.text));
      this.evictIfNeeded();

      for (let j = 0; j < uncached.length; j++) {
        const { index, text } = uncached[j]!;
        const embedding = newEmbeddings[j]!;
        results[index] = embedding;
        this.cache.set(this.hashKey(text), { embedding, usedAt: Date.now() });
      }

      log.info({ cached: texts.length - uncached.length, fetched: uncached.length }, 'Batch embed with cache');
    }

    return results as number[][];
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
