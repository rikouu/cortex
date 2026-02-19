import { createLogger } from '../utils/logger.js';
import type { VectorBackend, VectorSearchResult, VectorFilter } from './interface.js';

const log = createLogger('qdrant');

/**
 * Qdrant vector backend — for high-performance production deployments.
 */
export class QdrantBackend implements VectorBackend {
  readonly name = 'qdrant';
  private url: string;
  private collection: string;
  private apiKey?: string;
  private dimensions = 1536;

  constructor(opts: { url: string; collection: string; apiKey?: string }) {
    this.url = opts.url.replace(/\/$/, '');
    this.collection = opts.collection;
    this.apiKey = opts.apiKey;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['api-key'] = this.apiKey;
    return h;
  }

  async initialize(dimensions: number): Promise<void> {
    this.dimensions = dimensions;

    // Check if collection exists
    try {
      const res = await fetch(`${this.url}/collections/${this.collection}`, { headers: this.headers() });
      if (res.ok) {
        log.info({ collection: this.collection }, 'Qdrant collection exists');
        return;
      }
    } catch { /* collection doesn't exist */ }

    // Create collection
    const res = await fetch(`${this.url}/collections/${this.collection}`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify({
        vectors: {
          size: dimensions,
          distance: 'Cosine',
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to create Qdrant collection: ${body}`);
    }

    log.info({ collection: this.collection, dimensions }, 'Qdrant collection created');
  }

  async upsert(id: string, embedding: number[], metadata?: Record<string, any>): Promise<void> {
    const res = await fetch(`${this.url}/collections/${this.collection}/points`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify({
        points: [{
          id,
          vector: embedding,
          payload: metadata || {},
        }],
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Qdrant upsert failed: ${body}`);
    }
  }

  async search(query: number[], topK: number, filter?: VectorFilter): Promise<VectorSearchResult[]> {
    const body: any = {
      vector: query,
      limit: topK,
      with_payload: true,
    };

    if (filter) {
      const must: any[] = [];
      if (filter.layer) {
        const layers = Array.isArray(filter.layer) ? filter.layer : [filter.layer];
        must.push({ key: 'layer', match: { any: layers } });
      }
      if (filter.agent_id) {
        must.push({ key: 'agent_id', match: { value: filter.agent_id } });
      }
      if (must.length > 0) body.filter = { must };
    }

    const res = await fetch(`${this.url}/collections/${this.collection}/points/search`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Qdrant search failed: ${errBody}`);
    }

    const data = await res.json() as any;
    return (data.result || []).map((r: any) => ({
      id: r.id,
      distance: 1 - r.score, // Qdrant returns similarity, we need distance
      metadata: r.payload,
    }));
  }

  async delete(ids: string[]): Promise<void> {
    const res = await fetch(`${this.url}/collections/${this.collection}/points/delete`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ points: ids }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Qdrant delete failed: ${body}`);
    }
  }

  async count(): Promise<number> {
    const res = await fetch(`${this.url}/collections/${this.collection}`, { headers: this.headers() });
    if (!res.ok) return 0;
    const data = await res.json() as any;
    return data.result?.points_count || 0;
  }

  async close(): Promise<void> {
    // HTTP client, nothing to close
  }
}
