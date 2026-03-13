import { createLogger } from '../utils/logger.js';
import { HybridSearchEngine, type SearchResult } from '../search/index.js';
import { isSmallTalk } from '../signals/index.js';
import { expandQuery } from '../search/query-expansion.js';
import { stripInjectedContent } from '../utils/sanitize.js';
import type { Reranker } from '../search/reranker.js';
import type { CortexConfig } from '../utils/config.js';
import type { LLMProvider } from '../llm/interface.js';
import { findRelatedRelations, listMemories } from '../db/queries.js';
import { extractEntityTokens } from '../utils/helpers.js';
import { getDriver, traverseRelations, listRelations as neo4jListRelations } from '../db/neo4j.js';

const log = createLogger('gate');

export interface RecallRequest {
  query: string;
  agent_id?: string;
  max_tokens?: number;
  layers?: ('working' | 'core' | 'archive')[];
  skip_filters?: boolean;
}

export interface RecallResponse {
  context: string;
  memories: SearchResult[];
  meta: {
    query: string;
    total_found: number;
    injected_count: number;
    relations_count: number;
    skipped: boolean;
    reason?: string;
    latency_ms: number;
  };
}

export class MemoryGate {
  private rerankerWeight: number;

  constructor(
    private searchEngine: HybridSearchEngine,
    private config: CortexConfig['gate'],
    private llm?: LLMProvider,
    private reranker?: Reranker,
    rerankerWeight?: number,
  ) {
    this.rerankerWeight = rerankerWeight ?? 0.5;
  }

  async recall(req: RecallRequest): Promise<RecallResponse> {
    const start = Date.now();
    const query = stripInjectedContent(req.query);

    // Skip small talk (unless skip_filters is set, e.g. Dashboard search test)
    if (this.config.skipSmallTalk && !req.skip_filters && isSmallTalk(query)) {
      return {
        context: '',
        memories: [],
        meta: {
          query: req.query,
          total_found: 0,
          injected_count: 0,
          relations_count: 0,
          skipped: true,
          reason: 'small_talk',
          latency_ms: Date.now() - start,
        },
      };
    }

    const relationBudget = this.config.relationBudget ?? 100;
    const relationInjection = this.config.relationInjection !== false;
    const memoryBudget = req.max_tokens || this.config.maxInjectionTokens;

    // Parallel: search original query AND expand simultaneously
    // Before: expansion(2s) → embed+search(1.5s) × N → rerank (serial, ~7s)
    // After:  expansion(2s) ──┐
    //         embed+search(1.5s) ─┤→ merge → rerank (~4-5s)
    //                          variant searches(1.5s parallel) ─┘
    const searchOpts = {
      layers: req.layers,
      agent_id: req.agent_id,
      limit: this.config.searchLimit || 30,
    };

    // Start original query search immediately (no waiting for expansion)
    const originalSearchPromise = this.searchEngine.search({ query, ...searchOpts });

    // Expansion runs in parallel with original search
    const variantResultsPromise: Promise<SearchResult[]> = (this.config.queryExpansion?.enabled && this.llm)
      ? Promise.race([
          expandQuery(query, this.llm, this.config.queryExpansion),
          new Promise<string[]>((_, reject) =>
            setTimeout(() => reject(new Error('Query expansion timeout')), 5000)
          ),
        ])
        .then(async (queries) => {
          // Filter out original query, search all variants in parallel
          const variants = queries.filter(q => q !== query);
          if (variants.length === 0) return [];
          const variantSearches = await Promise.all(
            variants.map(q => this.searchEngine.search({ query: q, ...searchOpts }))
          );
          return variantSearches.flatMap(s => s.results);
        })
        .catch((e: any) => {
          log.warn({ error: e.message }, 'Query expansion timed out or failed');
          return [] as SearchResult[];
        })
      : Promise.resolve([]);

    const [originalResult, variantResults] = await Promise.all([
      originalSearchPromise,
      variantResultsPromise,
    ]);

    // Merge results: original first, then variants
    const resultMap = new Map<string, SearchResult>();
    const hitCount = new Map<string, number>();
    for (const r of originalResult.results) {
      hitCount.set(r.id, 1);
      resultMap.set(r.id, r);
    }
    for (const r of variantResults) {
      hitCount.set(r.id, (hitCount.get(r.id) ?? 0) + 1);
      const existing = resultMap.get(r.id);
      if (!existing || r.rawVectorSim > existing.rawVectorSim || (r.rawVectorSim === existing.rawVectorSim && r.finalScore > existing.finalScore)) {
        resultMap.set(r.id, r);
      }
    }

    // When multiple query variants are merged, keep the best per-variant scores as-is.
    // Each variant's search results were already normalized in hybrid.ts.
    // The merge uses rawVectorSim for comparison (see above), so the best variant's
    // normalized scores win naturally. No re-normalization needed here.
    const merged = Array.from(resultMap.values());

    // Boost score for memories hit by multiple query variants (diminishing returns)
    // Also boost constraint memories with high importance to increase selection probability
    let results = merged
      .map(r => {
        const hits = hitCount.get(r.id) ?? 1;
        // ln(1)=0, ln(2)≈0.69, ln(3)≈1.10, ln(5)≈1.61 → boost caps naturally
        let boost = hits > 1 ? 1 + 0.08 * Math.log(hits) : 1;
        // Constraint category boost: important constraints get priority in search results
        if (r.category === 'constraint' && r.importance >= 0.7) {
          boost *= 1.5;
        }
        return { ...r, finalScore: r.finalScore * boost };
      })
      .sort((a, b) => b.finalScore - a.finalScore);

    // Pre-filter: only send results with meaningful search signal to reranker
    // Use rawVectorSim (pre-normalization) to avoid false negatives from normalization
    const signalResults = results.filter(r => r.rawVectorSim > 0 || r.vectorScore > 0 || r.textScore > 0);
    const zeroSignal = results.filter(r => r.rawVectorSim === 0 && r.vectorScore === 0 && r.textScore === 0);
    if (signalResults.length === 0 && results.length > 0) {
      log.info({ total: results.length, signal: 0, zero: zeroSignal.length }, 'All results filtered as zero-signal');
    }

    if (this.reranker && signalResults.length > 0) {
      // Normalize original scores to 0-1 range for fair fusion
      const maxOriginal = Math.max(...signalResults.map(r => r.finalScore)) || 1;
      const originalScores = new Map(signalResults.map(r => [r.id, r.finalScore / maxOriginal]));

      try {
        const reranked = await Promise.race([
          this.reranker.rerank(query, signalResults, 15),
          new Promise<SearchResult[]>((_, reject) =>
            setTimeout(() => reject(new Error('Reranker timeout')), 8000)
          ),
        ]);
        const rw = this.rerankerWeight;
        const ow = 1 - rw;

        // Fuse reranker score with original score
        results = reranked.map(r => ({
          ...r,
          finalScore: rw * r.finalScore + ow * (originalScores.get(r.id) ?? 0),
        })).sort((a, b) => b.finalScore - a.finalScore);

        // Only append zero-signal results if we have very few signal results
        // This prevents noise padding while allowing fallback for sparse queries
        if (results.length < 3 && zeroSignal.length > 0) {
          const padding = Math.min(3 - results.length, zeroSignal.length);
          for (let i = 0; i < padding; i++) {
            results.push({ ...zeroSignal[i]!, finalScore: 0 });
          }
        }
      } catch (e: any) {
        log.warn({ error: e.message }, 'Reranker timed out or failed, using original order');
        results = results.slice(0, 15);
      }
    } else if (signalResults.length === 0 && zeroSignal.length > 0) {
      // No signal at all — return empty (don't inject random noise)
      results = [];
    } else {
      results = results.slice(0, 15);
    }

    // Score cliff filter: drop results that are dramatically worse than the top
    // Three checks (any one triggers cutoff):
    //   1. Absolute: score < cliffAbsolute of #1 (too far from best match)
    //   2. Gap: score < cliffGap of previous result (sudden drop)
    //   3. Floor: score < cliffFloor (no meaningful signal)
    const cliffAbsolute = this.config.cliffAbsolute ?? 0.4;
    const cliffGap = this.config.cliffGap ?? 0.6;
    const cliffFloor = this.config.cliffFloor ?? 0.05;
    if (results.length > 1) {
      const topScore = results[0]!.finalScore;
      if (topScore > 0) {
        const cliff = Math.max(topScore * cliffAbsolute, cliffFloor);
        let cutoff = results.length;
        for (let i = 1; i < results.length; i++) {
          if (results[i]!.finalScore < cliff) {
            cutoff = i;
            break;
          }
          // Gap detection: if this result is less than cliffGap of previous, it's a cliff
          if (results[i]!.finalScore < results[i - 1]!.finalScore * cliffGap) {
            cutoff = i;
            break;
          }
        }
        if (cutoff < results.length) {
          log.info({ before: results.length, after: cutoff, topScore: topScore.toFixed(3), cutoffScore: results[cutoff - 1]?.finalScore.toFixed(3) }, 'Score cliff filter applied');
          results = results.slice(0, cutoff);
        }
      }
    }

    // --- Fixed injection: agent_persona (independent token budget) ---
    // These define who the agent IS and are always injected regardless of query.
    // Uses fixedInjectionTokens budget, separate from search result budget.
    const fixedBudget = this.config.fixedInjectionTokens ?? 500;
    const fixedResults: SearchResult[] = [];
    const existingIds = new Set(results.map(r => r.id));

    const { items: personaMemories } = listMemories({
      agent_id: req.agent_id,
      category: 'agent_persona' as any,
      limit: 50,
      orderBy: 'importance',
      orderDir: 'desc',
    });
    for (const pm of personaMemories) {
      if (existingIds.has(pm.id)) {
        // Already in search results — move to fixed bucket to use fixed budget
        results = results.filter(r => r.id !== pm.id);
      }
      existingIds.add(pm.id);
      fixedResults.push({
        id: pm.id, content: pm.content, layer: pm.layer, category: pm.category,
        importance: pm.importance, decay_score: pm.decay_score,
        access_count: pm.access_count, created_at: pm.created_at,
        textScore: 0, vectorScore: 0, rawVectorSim: 0, fusedScore: 0,
        layerWeight: 1, recencyBoost: 1, accessBoost: 1,
        finalScore: 0,
      });
    }

    // Constraints are NOT force-injected. If a constraint is relevant to the query,
    // it will survive the cliff filter naturally in search results.
    // Only agent_persona uses fixed injection (always-inject with independent budget).

    // Format: fixed injection (persona) + search results use independent budgets
    const fixedContext = fixedResults.length > 0
      ? this.searchEngine.formatForInjection(fixedResults, fixedBudget)
      : '';
    const searchContext = this.searchEngine.formatForInjection(results, memoryBudget);

    // Merge: fixed block first, then search block
    // Both use <cortex_memory> tags internally, merge into one block
    let context = '';
    if (fixedContext && searchContext) {
      // Strip closing tag from fixed, opening tag from search, merge
      const fixedBody = fixedContext.replace('</cortex_memory>', '').trimEnd();
      const searchBody = searchContext.replace('<cortex_memory>', '').trimStart();
      context = `${fixedBody}\n${searchBody}`;
    } else {
      context = fixedContext || searchContext;
    }
    const injectedCount = context ? context.split('\n').filter(l => l.startsWith('[')).length : 0;

    // Inject relevant relations (Neo4j multi-hop or SQLite fallback)
    let relationsCount = 0;
    if (relationInjection) {
      try {
      // Extract entities from query only
      const queryEntities = [...new Set(extractEntityTokens(query))];

      // Separate "context keywords" from "entity subjects" in the query.
      // For "天哥的服务器": entities=["天哥","服务器"], but "天哥" is a subject entity
      // and "服务器" is context describing what we want about 天哥.
      // We use context keywords to filter relations by topic relevance.
      // Chinese stop particles that should not be context keywords:
      const stopWords = new Set(['的', '了', '在', '是', '有', '我', '你', '他', '她', '它', '们', '吗', '吧', '呢', '啊', '哦', '嗯', '这', '那', '什么', '怎么', '哪', '哪里', '为什么', 'the', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'what', 'how', 'where', 'who', 'which']);

      if (queryEntities.length > 0) {
        const useNeo4j = !!getDriver();

        // Collect all candidate relation lines with their raw text for filtering
        type RelCandidate = { line: string; text: string };
        const candidates: RelCandidate[] = [];

        if (useNeo4j) {
          // Traverse top 3 query entities
          for (const entity of queryEntities.slice(0, 3)) {
            try {
              const traversed = await traverseRelations(entity, {
                maxHops: 2,
                minConfidence: 0.6,
                limit: 8,
                agentId: req.agent_id,
              });
              for (const t of traversed) {
                if (t.hops <= 2) {
                  const pathText = t.path.slice(1).join(' → ');
                  candidates.push({
                    line: `${entity} → ${pathText} (${t.hops}hop)`,
                    text: `${entity} ${pathText}`,
                  });
                }
              }
            } catch (e: any) {
              log.debug({ entity, error: e.message }, 'Traverse failed for entity');
            }
          }

          // Direct relations
          try {
            const directRels = await neo4jListRelations({
              agentId: req.agent_id,
              limit: 15,
              includeExpired: false,
            });
            const entityRels = directRels.filter(r =>
              queryEntities.some(e =>
                r.subject.toLowerCase().includes(e.toLowerCase()) ||
                r.object.toLowerCase().includes(e.toLowerCase())
              )
            );
            for (const r of entityRels) {
              const line = `${r.subject} --${r.predicate}--> ${r.object} (${r.confidence.toFixed(2)})`;
              if (!candidates.some(c => c.line === line)) {
                candidates.push({
                  line,
                  text: `${r.subject} ${r.predicate} ${r.object}`,
                });
              }
            }
          } catch (e: any) {
            log.debug({ error: e.message }, 'Failed to fetch direct relations');
          }
        } else {
          // SQLite fallback
          const relations = findRelatedRelations(queryEntities, req.agent_id);
          for (const r of relations) {
            candidates.push({
              line: `${r.subject} --${r.predicate}--> ${r.object} (${r.confidence.toFixed(2)})`,
              text: `${r.subject} ${r.predicate} ${r.object}`,
            });
          }
        }

        // Context-keyword relevance filter:
        // If query has context keywords beyond entity names (e.g. "服务器" in "天哥的服务器"),
        // only keep relations whose text matches at least one context keyword.
        // If query IS just entity names (e.g. "天哥"), show top relations unfiltered.
        const contextKeywords = queryEntities.filter(t => !stopWords.has(t));
        // Determine which tokens are "subject entities" (appear as relation subjects)
        // vs "context keywords" (describe the topic we care about)
        const subjectEntities = new Set<string>();
        const topicKeywords: string[] = [];
        for (const kw of contextKeywords) {
          const isSubject = candidates.some(c =>
            c.text.toLowerCase().startsWith(kw.toLowerCase()) ||
            c.text.toLowerCase().includes(kw.toLowerCase() + ' ')
          );
          if (isSubject && candidates.filter(c => c.text.toLowerCase().includes(kw.toLowerCase())).length > 3) {
            // This entity appears as subject in many relations — it's a broad entity
            subjectEntities.add(kw);
          } else {
            topicKeywords.push(kw);
          }
        }

        let filtered: string[];
        if (topicKeywords.length > 0 && candidates.length > 0) {
          // Has topic context — filter relations by topic relevance
          filtered = candidates
            .filter(c => topicKeywords.some(kw =>
              c.text.toLowerCase().includes(kw.toLowerCase())
            ))
            .map(c => c.line);
          log.debug({ topicKeywords, subjectEntities: [...subjectEntities], before: candidates.length, after: filtered.length }, 'Relation topic filter');
        } else {
          // Pure entity query — show all (capped)
          filtered = candidates.map(c => c.line);
        }

        const cappedLines = filtered.slice(0, 5);
        if (cappedLines.length > 0) {
          relationsCount = cappedLines.length;
          const relBlock = `<cortex_relations>\n${cappedLines.join('\n')}\n</cortex_relations>`;
          context = context ? `${context}\n${relBlock}` : relBlock;
          log.debug({ count: cappedLines.length, source: useNeo4j ? 'neo4j' : 'sqlite' }, 'Relations injected');
        }
      }
      } catch (e: any) {
        log.warn({ error: e.message }, 'Relation injection failed entirely, returning search-only results');
        // relationsCount stays 0, context stays as-is
      }
    }

    const latency = Date.now() - start;
    log.info({ query: query.slice(0, 50), results: results.length, injected: injectedCount, relations: relationsCount, latency_ms: latency }, 'Recall completed');

    return {
      context,
      memories: results,
      meta: {
        query,
        total_found: results.length,
        injected_count: injectedCount,
        relations_count: relationsCount,
        skipped: false,
        latency_ms: latency,
      },
    };
  }
}
