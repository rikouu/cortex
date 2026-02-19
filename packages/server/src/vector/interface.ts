/**
 * VectorBackend interface — all implementations share this contract.
 */
export interface VectorSearchResult {
  id: string;
  distance: number;
  metadata?: Record<string, any>;
}

export interface VectorFilter {
  layer?: string | string[];
  agent_id?: string;
}

export interface VectorBackend {
  readonly name: string;

  /** Initialize backend (create tables/collections if needed) */
  initialize(dimensions: number): Promise<void>;

  /** Insert or update a vector */
  upsert(id: string, embedding: number[], metadata?: Record<string, any>): Promise<void>;

  /** Search for similar vectors */
  search(query: number[], topK: number, filter?: VectorFilter): Promise<VectorSearchResult[]>;

  /** Delete vectors by ID */
  delete(ids: string[]): Promise<void>;

  /** Count total vectors */
  count(): Promise<number>;

  /** Close/cleanup */
  close(): Promise<void>;
}
