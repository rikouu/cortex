import { searchFTS, type Memory, type MemoryLayer, bumpAccessCount } from '../db/index.js';
import { getDb } from '../db/connection.js';
import { createLogger } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';
import { estimateTokens } from '../utils/helpers.js';
import type { VectorBackend } from '../vector/interface.js';
import type { EmbeddingProvider } from '../embedding/interface.js';
import type { CortexConfig } from '../utils/config.js';
const log = createLogger('search');

export interface SearchResult {
  id: string;
  content: string;
  layer: MemoryLayer;
  category: string;
  agent_id: string;
  importance: number;
  decay_score: number;
  access_count: number;
  created_at: string;
  textScore: number;
  vectorScore: number;
  rawVectorSim: number; // original cosine similarity before normalization (model-dependent)
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
  pairing_code?: string | null;
  limit?: number;
  debug?: boolean;
  maxTokens?: number;
  /** Pre-computed embedding vector — skips embed() call when provided */
  embedding?: number[];
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
  constructor(
    private vectorBackend: VectorBackend,
    private embeddingProvider: EmbeddingProvider,
    private config: CortexConfig['search'],
  ) {}

  /** Batch-embed multiple texts in a single API call (for parallel query expansion) */
  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.embeddingProvider.embedBatch(texts);
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
        pairing_code: opts.pairing_code,
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
      const embedding = opts.embedding ?? await this.embeddingProvider.embed(opts.query);
      if (embedding.length > 0) {
        vectorResults = await this.vectorBackend.search(embedding, limit * 3, opts.agent_id ? { agent_id: opts.agent_id } : undefined);
      }
    } catch (e: any) {
      log.warn({ error: e.message }, 'Vector search failed, using text-only');
    }
    const vectorMs = Date.now() - vectorStart;

    // 3. Fusion
    const fusionStart = Date.now();
    const results = this.fuse(textResults, vectorResults, opts);
    const fusionMs = Date.now() - fusionStart;

    // 4. Filter near-zero scores and slice to limit
    // Results with finalScore < 0.001 are essentially noise (no meaningful text or vector match).
    // Keep them only if we'd have fewer than 3 results (sparse corpus fallback).
    const meaningful = results.filter(r => r.finalScore >= 0.001);
    const finalResults = (meaningful.length >= 3 ? meaningful : results).slice(0, limit);

    // 5. Bump access counts
    if (finalResults.length > 0) {
      try {
        bumpAccessCount(finalResults.map(r => r.id), opts.query);
      } catch (e: any) {
        log.warn({ error: e.message }, 'Failed to bump access counts');
      }
    }

    const totalMs = Date.now() - startTime;

    // Metrics
    metrics.inc('recall_total');
    metrics.observe('recall_latency_ms', totalMs);
    metrics.observe('search_results_count', finalResults.length);

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
      vectorScore: number;  // now: cosine similarity (0-1), not RRF rank
    }>();

    const RRF_K = 60; // RRF constant for text (BM25) ranking

    // Text results: use RRF rank score (appropriate for BM25 ranked lists)
    for (let i = 0; i < textResults.length; i++) {
      const r = textResults[i]!;
      const rrfScore = 1 / (RRF_K + i);
      scoreMap.set(r.id, { memory: r, textScore: rrfScore, vectorScore: 0 });
    }

    // Vector results: use cosine similarity (1 - distance) instead of RRF rank
    // Different embedding models have different similarity ranges:
    //   text-embedding-3-small: 0.0-0.3 typical, 0.4+ = highly relevant
    //   text-embedding-3-large: 0.0-0.5 typical, 0.6+ = highly relevant
    //   nomic-embed-text: 0.2-0.8 typical range
    // Strategy: absolute threshold filters junk, then adaptive normalization
    // stretches the actual range to 0-1 for model-agnostic scoring.
    const minSimilarity = this.config.minSimilarity ?? 0.01; // Fix 2: absolute floor
    const missingIds: string[] = [];
    const vectorScores = new Map<string, number>();
    const rawVectorSims = new Map<string, number>(); // track pre-normalization sims

    // Phase 1: Compute raw cosine similarities, apply absolute threshold
    // sqlite-vec (vec0) returns L2 (Euclidean) distance, not cosine distance.
    // For normalized embeddings: L2² = 2*(1 - cosine_sim), so cosine_sim = 1 - L2²/2
    // Qdrant/Milvus already return cosine distance (1 - cosine_sim) via their adapters.
    // Detect by checking if distances > 1 (cosine distance is always 0-2, but L2 for
    // normalized vectors typically clusters around 0.8-1.4, while cosine distance 0-0.5)
    const isL2Distance = vectorResults.length > 0 && vectorResults[0]!.distance > 1;
    const rawSims: { id: string; sim: number }[] = [];
    for (const r of vectorResults) {
      const cosineSim = isL2Distance
        ? Math.max(0, 1 - (r.distance * r.distance) / 2)  // L2 → cosine
        : Math.max(0, 1 - r.distance);                     // cosine distance → cosine sim
      if (cosineSim < minSimilarity) continue;
      rawSims.push({ id: r.id, sim: cosineSim });
    }

    // Phase 2: Adaptive normalization — model-agnostic
    // Uses the spread between best and median (not worst) to be robust
    // If best match is barely better than worst → all scores low (nothing relevant)
    const bestSim = rawSims.length > 0 ? rawSims[0]!.sim : 0;
    const medianIdx = Math.floor(rawSims.length / 2);
    const medianSim = rawSims.length > 2 ? rawSims[medianIdx]!.sim : (rawSims[rawSims.length - 1]?.sim ?? 0);
    const spread = bestSim - medianSim; // how much better is top vs typical

    // Quality gate: if the best result isn't meaningfully better than median,
    // the query has no good matches — suppress all vector scores
    const SPREAD_THRESHOLD = rawSims.length < 5 ? 0.001 : 0.005; // relax for small corpus
    const hasGoodMatches = spread > SPREAD_THRESHOLD;

    for (const r of rawSims) {
      let normalizedSim: number;
      if (!hasGoodMatches) {
        // No result stands out — scale all down to near-zero
        normalizedSim = r.sim * 0.1; // preserve ordering but with minimal weight
      } else {
        // Stretch [medianSim, bestSim] → [0, 1]
        normalizedSim = Math.max(0, Math.min(1, (r.sim - medianSim) / spread));
      }

      const existing = scoreMap.get(r.id);
      if (existing) {
        existing.vectorScore = normalizedSim;
        (existing as any).rawVectorSim = r.sim;
      } else {
        missingIds.push(r.id);
        vectorScores.set(r.id, normalizedSim);
        rawVectorSims.set(r.id, r.sim);
      }
    }

    // Batch fetch all missing memories in one query
    if (missingIds.length > 0) {
      const db = getDb();
      const placeholders = missingIds.map(() => '?').join(',');
      const memories = db.prepare(
        `SELECT * FROM memories WHERE id IN (${placeholders}) AND superseded_by IS NULL`
      ).all(...missingIds) as Memory[];

      for (const memory of memories) {
        scoreMap.set(memory.id, {
          memory,
          textScore: 0,
          vectorScore: vectorScores.get(memory.id) || 0,
        });
      }
    }

    // Compute final scores — relevance-first ranking
    const vw = this.config.vectorWeight;
    const tw = this.config.textWeight;
    const results: SearchResult[] = [];

    for (const [id, entry] of scoreMap) {
      if (!entry.memory) continue;
      const m = entry.memory;

      if (opts.layers && !opts.layers.includes(m.layer)) continue;
      if (opts.categories && !opts.categories.includes(m.category)) continue;
      // agent_id filter: null/undefined agent_id memories are shared (match any agent)
      if (opts.agent_id && m.agent_id && m.agent_id !== opts.agent_id) continue;
      // pairing_code filter: when specified, only show memories from same namespace
      if (opts.pairing_code !== undefined && (m as any).pairing_code !== (opts.pairing_code || null)) continue;

      const layerWeight = LAYER_WEIGHTS[m.layer] || 0.5;

      // Recency boost: reduced from 0.1 to 0.03 (Fix 6: don't overpower relevance)
      let recencyBase = new Date(m.created_at).getTime();
      try {
        if (m.metadata) {
          const meta = JSON.parse(m.metadata);
          if (meta.last_confirmed_at) {
            recencyBase = new Date(meta.last_confirmed_at).getTime();
          }
        }
      } catch { /* use created_at */ }
      const daysSinceConfirmed = (Date.now() - recencyBase) / 86_400_000;
      const recencyBoost = 1.0 + 0.03 * Math.exp(-daysSinceConfirmed / 14);

      // Access frequency boost: reduced from 0.05 to 0.02 (Fix 6)
      const accessBoost = 1.0 + 0.02 * Math.min(m.access_count, this.config.accessBoostCap);

      // Fix 7: importance does NOT affect search ranking
      // (importance is used later for injection priority, not search)
      const fusedScore = vw * entry.vectorScore + tw * entry.textScore;
      const finalScore = fusedScore * layerWeight * recencyBoost * accessBoost * m.decay_score;

      results.push({
        id,
        content: m.content,
        layer: m.layer,
        category: m.category,
        agent_id: m.agent_id,
        importance: m.importance,
        decay_score: m.decay_score,
        access_count: m.access_count,
        created_at: m.created_at,
        textScore: entry.textScore,
        vectorScore: entry.vectorScore,
        rawVectorSim: (entry as any).rawVectorSim ?? rawVectorSims.get(id) ?? 0,
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
   * Priority categories (constraint, agent_persona) are injected first to ensure
   * critical rules and persona are never truncated.
   */
  formatForInjection(results: SearchResult[], maxTokens: number): string {
    if (results.length === 0) return '';

    // Separate priority categories from regular results
    const PRIORITY_CATEGORIES = new Set(['constraint', 'agent_persona', 'correction', 'policy']);
    const priorityResults = results.filter(r => PRIORITY_CATEGORIES.has(r.category));
    const regularResults = results.filter(r => !PRIORITY_CATEGORIES.has(r.category));

    const lines: string[] = ['<cortex_memory>'];
    let tokens = estimateTokens(lines[0]!);
    const injectedIds = new Set<string>();
    const seenPrefixes = new Set<string>(); // content dedup

    const layerLabels: Record<string, string> = {
      core: '核心记忆',
      working: '近期对话',
      archive: '历史记忆',
    };

    const categoryLabels: Record<string, string> = {
      constraint: '约束',
      agent_persona: '人设',
      correction: '纠正',
      policy: '策略',
    };

    // Phase 1: Inject priority categories first
    for (const r of priorityResults) {
      const prefix = r.content.slice(0, 40).toLowerCase();
      if (seenPrefixes.has(prefix)) continue;
      const label = categoryLabels[r.category] || layerLabels[r.layer] || r.layer;
      const line = `[${label}] ${r.content}`;
      const lineTokens = estimateTokens(line);
      if (tokens + lineTokens > maxTokens - 20) break;
      lines.push(line);
      tokens += lineTokens;
      injectedIds.add(r.id);
      seenPrefixes.add(prefix);
    }

    // Phase 2: Fill remaining budget with regular results
    for (const r of regularResults) {
      if (injectedIds.has(r.id)) continue;
      const prefix = r.content.slice(0, 40).toLowerCase();
      if (seenPrefixes.has(prefix)) continue;
      const line = `[${layerLabels[r.layer] || r.layer}] ${r.content}`;
      const lineTokens = estimateTokens(line);
      if (tokens + lineTokens > maxTokens - 20) break;
      lines.push(line);
      tokens += lineTokens;
      seenPrefixes.add(prefix);
    }

    lines.push('</cortex_memory>');
    return lines.join('\n');
  }
}
