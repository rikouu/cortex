import { searchFTS, type Memory, type MemoryLayer, bumpAccessCount } from '../db/index.js';
import { getDb } from '../db/connection.js';
import { createLogger } from '../utils/logger.js';
import { estimateTokens } from '../utils/helpers.js';
import type { VectorBackend } from '../vector/interface.js';
import type { EmbeddingProvider } from '../embedding/interface.js';
import type { CortexConfig } from '../utils/config.js';
import type { Reranker } from './reranker.js';

const log = createLogger('search');

export interface SearchResult {
  id: string;
  content: string;
  layer: MemoryLayer;
  category: string;
  importance: number;
  decay_score: number;
  access_count: number;
  created_at: string;
  textScore: number;
  vectorScore: number;
  fusedScore: number;
  layerWeight: number;
  recencyBoost: number;
  accessBoost: number;
  finalScore: number;
}

export interface SearchOptions {
  query: string;
  layers?: MemoryLayer[];
  categories?: string[];
  agent_id?: string;
  limit?: number;
  debug?: boolean;
  maxTokens?: number;
}

export interface SearchDebug {
  textResultCount: number;
  vectorResultCount: number;
  fusedCount: number;
  timings: {
    textMs: number;
    vectorMs: number;
    fusionMs: number;
    totalMs: number;
  };
}

const LAYER_WEIGHTS: Record<string, number> = {
  core: 1.0,
  working: 0.8,
  archive: 0.5,
};

export class HybridSearchEngine {
  private reranker?: Reranker;

  constructor(
    private vectorBackend: VectorBackend,
    private embeddingProvider: EmbeddingProvider,
    private config: CortexConfig['search'],
    reranker?: Reranker,
  ) {
    this.reranker = reranker;
  }

  async search(opts: SearchOptions): Promise<{ results: SearchResult[]; debug?: SearchDebug }> {
    const startTime = Date.now();
    const limit = opts.limit || 10;

    // 1. BM25 text search
    const textStart = Date.now();
    let textResults: (Memory & { rank: number })[] = [];
    try {
      textResults = searchFTS(opts.query, {
        layer: opts.layers?.[0],
        agent_id: opts.agent_id,
        limit: limit * 3,
      });
    } catch (e: any) {
      log.warn({ error: e.message }, 'FTS search failed');
    }
    const textMs = Date.now() - textStart;

    // 2. Vector semantic search
    const vectorStart = Date.now();
    let vectorResults: { id: string; distance: number }[] = [];
    try {
      const embedding = await this.embeddingProvider.embed(opts.query);
      if (embedding.length > 0) {
        vectorResults = await this.vectorBackend.search(embedding, limit * 3);
      }
    } catch (e: any) {
      log.warn({ error: e.message }, 'Vector search failed, using text-only');
    }
    const vectorMs = Date.now() - vectorStart;

    // 3. Fusion
    const fusionStart = Date.now();
    const results = this.fuse(textResults, vectorResults, opts);
    const fusionMs = Date.now() - fusionStart;

    // 4. Rerank + slice to limit
    let finalResults: SearchResult[];
    if (this.reranker && results.length > 0) {
      finalResults = await this.reranker.rerank(opts.query, results, limit);
    } else {
      finalResults = results.slice(0, limit);
    }

    // 5. Bump access counts
    if (finalResults.length > 0) {
      try {
        bumpAccessCount(finalResults.map(r => r.id), opts.query);
      } catch (e: any) {
        log.warn({ error: e.message }, 'Failed to bump access counts');
      }
    }

    const totalMs = Date.now() - startTime;
    const debug: SearchDebug | undefined = opts.debug ? {
      textResultCount: textResults.length,
      vectorResultCount: vectorResults.length,
      fusedCount: results.length,
      timings: { textMs, vectorMs, fusionMs, totalMs },
    } : undefined;

    return { results: finalResults, debug };
  }

  private fuse(
    textResults: (Memory & { rank: number })[],
    vectorResults: { id: string; distance: number }[],
    opts: SearchOptions,
  ): SearchResult[] {
    const scoreMap = new Map<string, {
      memory?: Memory;
      textScore: number;
      vectorScore: number;
    }>();

    // Normalize text scores (FTS5 rank is negative, lower = better)
    const maxTextRank = textResults.length > 0 ? Math.max(...textResults.map(r => Math.abs(r.rank))) : 1;
    for (const r of textResults) {
      const normalized = 1 - Math.abs(r.rank) / (maxTextRank + 1);
      scoreMap.set(r.id, { memory: r, textScore: normalized, vectorScore: 0 });
    }

    // Normalize vector scores (distance, lower = better)
    const maxDist = vectorResults.length > 0 ? Math.max(...vectorResults.map(r => r.distance)) : 1;
    for (const r of vectorResults) {
      const normalized = 1 - r.distance / (maxDist + 0.001);
      const existing = scoreMap.get(r.id);
      if (existing) {
        existing.vectorScore = normalized;
      } else {
        // Need to fetch memory from DB
        const db = getDb();
        const memory = db.prepare('SELECT * FROM memories WHERE id = ?').get(r.id) as Memory | undefined;
        if (memory) {
          scoreMap.set(r.id, { memory, textScore: 0, vectorScore: normalized });
        }
      }
    }

    // Compute final scores
    const vw = this.config.vectorWeight;
    const tw = this.config.textWeight;
    const results: SearchResult[] = [];

    for (const [id, entry] of scoreMap) {
      if (!entry.memory) continue;
      const m = entry.memory;

      // Filter by layers/categories
      if (opts.layers && !opts.layers.includes(m.layer)) continue;
      if (opts.categories && !opts.categories.includes(m.category)) continue;
      if (opts.agent_id && m.agent_id !== opts.agent_id) continue;

      const layerWeight = LAYER_WEIGHTS[m.layer] || 0.5;

      // Recency boost (linear decay over 7 days)
      const daysSinceCreation = (Date.now() - new Date(m.created_at).getTime()) / 86_400_000;
      const recencyBoost = daysSinceCreation < 7
        ? 1.0 + 0.1 * (7 - daysSinceCreation) / 7
        : 1.0;

      // Access frequency boost
      const accessBoost = 1.0 + 0.05 * Math.min(m.access_count, this.config.accessBoostCap);

      const fusedScore = vw * entry.vectorScore + tw * entry.textScore;
      const finalScore = fusedScore * layerWeight * recencyBoost * accessBoost * m.decay_score;

      results.push({
        id,
        content: m.content,
        layer: m.layer,
        category: m.category,
        importance: m.importance,
        decay_score: m.decay_score,
        access_count: m.access_count,
        created_at: m.created_at,
        textScore: entry.textScore,
        vectorScore: entry.vectorScore,
        fusedScore,
        layerWeight,
        recencyBoost,
        accessBoost,
        finalScore,
      });
    }

    results.sort((a, b) => b.finalScore - a.finalScore);
    return results;
  }

  /**
   * Format search results for injection into agent context.
   */
  formatForInjection(results: SearchResult[], maxTokens: number): string {
    if (results.length === 0) return '';

    const lines: string[] = ['<cortex_memory>'];
    let tokens = estimateTokens(lines[0]!);

    const layerLabels: Record<string, string> = {
      core: '核心记忆',
      working: '近期对话',
      archive: '历史记忆',
    };

    for (const r of results) {
      const line = `[${layerLabels[r.layer] || r.layer}] ${r.content}`;
      const lineTokens = estimateTokens(line);
      if (tokens + lineTokens > maxTokens - 20) break;
      lines.push(line);
      tokens += lineTokens;
    }

    lines.push('</cortex_memory>');
    return lines.join('\n');
  }
}
