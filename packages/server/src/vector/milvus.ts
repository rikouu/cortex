import { createLogger } from '../utils/logger.js';
import type { VectorBackend, VectorSearchResult, VectorFilter } from './interface.js';

const log = createLogger('milvus');

/**
 * Milvus vector backend — for large-scale deployments.
 */
export class MilvusBackend implements VectorBackend {
  readonly name = 'milvus';
  private uri: string;
  private collection: string;
  private dimensions = 1536;

  constructor(opts: { uri: string; collection: string }) {
    this.uri = opts.uri.replace(/\/$/, '');
    this.collection = opts.collection;
  }

  async initialize(dimensions: number): Promise<void> {
    this.dimensions = dimensions;

    // Check/create collection via Milvus REST API
    try {
      const res = await fetch(`${this.uri}/v2/vectordb/collections/describe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collectionName: this.collection }),
      });

      if (res.ok) {
        const data = await res.json() as any;
        if (data.code === 0) {
          log.info({ collection: this.collection }, 'Milvus collection exists');
          return;
        }
      }
    } catch { /* doesn't exist */ }

    // Create collection
    const res = await fetch(`${this.uri}/v2/vectordb/collections/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collectionName: this.collection,
        dimension: dimensions,
        metricType: 'COSINE',
        primaryFieldName: 'id',
        vectorFieldName: 'embedding',
        idType: 'VarChar',
        params: { max_length: 64 },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to create Milvus collection: ${body}`);
    }

    log.info({ collection: this.collection, dimensions }, 'Milvus collection created');
  }

  async upsert(id: string, embedding: number[], metadata?: Record<string, any>): Promise<void> {
    const res = await fetch(`${this.uri}/v2/vectordb/entities/upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collectionName: this.collection,
        data: [{ id, embedding, ...(metadata || {}) }],
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Milvus upsert failed: ${body}`);
    }
  }

  async search(query: number[], topK: number, filter?: VectorFilter): Promise<VectorSearchResult[]> {
    const body: any = {
      collectionName: this.collection,
      data: [query],
      limit: topK,
      outputFields: ['id'],
    };

    if (filter) {
      const conditions: string[] = [];
      if (filter.layer) {
        const layers = Array.isArray(filter.layer) ? filter.layer : [filter.layer];
        conditions.push(`layer in [${layers.map(l => `"${l}"`).join(',')}]`);
      }
      if (filter.agent_id) {
        conditions.push(`agent_id == "${filter.agent_id}"`);
      }
      if (conditions.length > 0) body.filter = conditions.join(' && ');
    }

    const res = await fetch(`${this.uri}/v2/vectordb/entities/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Milvus search failed: ${errBody}`);
    }

    const data = await res.json() as any;
    return (data.data || []).map((r: any) => ({
      id: r.id,
      distance: 1 - (r.distance || 0),
      metadata: r,
    }));
  }

  async delete(ids: string[]): Promise<void> {
    const res = await fetch(`${this.uri}/v2/vectordb/entities/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collectionName: this.collection,
        filter: `id in [${ids.map(id => `"${id}"`).join(',')}]`,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Milvus delete failed: ${body}`);
    }
  }

  async count(): Promise<number> {
    try {
      const res = await fetch(`${this.uri}/v2/vectordb/collections/describe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collectionName: this.collection }),
      });
      const data = await res.json() as any;
      return data.data?.rowCount || 0;
    } catch {
      return 0;
    }
  }

  async close(): Promise<void> {
    // HTTP client, nothing to close
  }
}
