export type { VectorBackend, VectorSearchResult, VectorFilter } from './interface.js';
export { SqliteVecBackend } from './sqlite-vec.js';
export { QdrantBackend } from './qdrant.js';
export { MilvusBackend } from './milvus.js';

import type { VectorBackend } from './interface.js';
import { SqliteVecBackend } from './sqlite-vec.js';
import { QdrantBackend } from './qdrant.js';
import { MilvusBackend } from './milvus.js';

export function createVectorBackend(config: { provider: string; qdrant?: { url: string; collection: string; apiKey?: string }; milvus?: { uri: string; collection: string } }): VectorBackend {
  switch (config.provider) {
    case 'qdrant':
      if (!config.qdrant) throw new Error('Qdrant config required');
      return new QdrantBackend(config.qdrant);
    case 'milvus':
      if (!config.milvus) throw new Error('Milvus config required');
      return new MilvusBackend(config.milvus);
    case 'sqlite-vec':
    default:
      return new SqliteVecBackend();
  }
}
