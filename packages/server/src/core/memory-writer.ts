/**
 * MemoryWriter — shared memory persistence logic for Sieve and Flush.
 *
 * Handles:
 * - Three-tier dedup matching (exact → near-exact → similar → insert)
 * - Smart Update via LLM (keep / replace / merge)
 * - Vector indexing
 * - Cross-family awareness (agent_* vs user categories)
 */
import { createLogger } from '../utils/logger.js';
import { insertMemory, getMemoryById, updateMemory, type Memory, type MemoryCategory } from '../db/index.js';
import { parseDuration } from '../utils/helpers.js';
import { stripCodeFences } from '../utils/sanitize.js';
import type { LLMProvider } from '../llm/interface.js';
import type { EmbeddingProvider } from '../embedding/interface.js';
import type { VectorBackend } from '../vector/interface.js';
import type { CortexConfig } from '../utils/config.js';
import { SMART_UPDATE_SYSTEM_PROMPT } from './prompts.js';
import { insertExtractionFeedback } from '../db/index.js';

const log = createLogger('memory-writer');

/** Legacy fallback threshold when smartUpdate is disabled */
const LEGACY_DEDUP_THRESHOLD = 0.15;

export interface ExtractedMemory {
  content: string;
  category: MemoryCategory;
  importance: number;
  source: 'user_stated' | 'user_implied' | 'observed_pattern';
  reasoning: string;
}

export interface SimilarMemory {
  memory: Memory;
  distance: number;
}

export interface SmartUpdateDecision {
  action: 'keep' | 'replace' | 'merge';
  merged_content?: string;
  reasoning: string;
}

export interface ProcessResult {
  action: 'inserted' | 'skipped' | 'smart_updated';
  memory?: Memory;
}

export class MemoryWriter {
  constructor(
    private llm: LLMProvider,
    private embeddingProvider: EmbeddingProvider,
    private vectorBackend: VectorBackend,
    private config: CortexConfig,
  ) {}

  /**
   * Find similar memories via vector search.
   */
  async findSimilar(content: string, agentId: string, categories?: string[], topK = 3): Promise<SimilarMemory[]> {
    try {
      const embedding = await this.embeddingProvider.embed(content);
      if (embedding.length === 0) return [];

      const results = await this.vectorBackend.search(embedding, topK, { agent_id: agentId });
      const similar: SimilarMemory[] = [];
      for (const r of results) {
        const mem = getMemoryById(r.id);
        if (mem && !mem.superseded_by && !mem.is_pinned) {
          if (categories && categories.length > 0 && !categories.includes(mem.category)) continue;
          similar.push({ memory: mem, distance: r.distance });
        }
      }
      return similar;
    } catch {
      return [];
    }
  }

  /**
   * Ask LLM to decide: keep, replace, or merge (single pair).
   */
  async smartUpdateDecision(existing: Memory, newContent: string): Promise<SmartUpdateDecision> {
    const prompt = `EXISTING MEMORY:\n${existing.content}\n\nNEW MEMORY:\n${newContent}`;
    try {
      const raw = await this.llm.complete(prompt, {
        maxTokens: 300,
        temperature: 0.1,
        systemPrompt: SMART_UPDATE_SYSTEM_PROMPT,
      });

      return this.parseSmartUpdateResponse(raw);
    } catch (e: any) {
      log.warn({ error: e.message }, 'Smart update LLM call failed, defaulting to replace');
      return { action: 'replace', reasoning: 'LLM call failed' };
    }
  }

  /**
   * Batch smart update: decide keep/replace/merge for multiple (existing, new) pairs in one LLM call.
   * Falls back to individual calls if batch parsing fails.
   */
  async batchSmartUpdateDecision(
    pairs: Array<{ existing: Memory; newContent: string }>,
  ): Promise<SmartUpdateDecision[]> {
    if (pairs.length === 0) return [];
    if (pairs.length === 1) {
      return [await this.smartUpdateDecision(pairs[0]!.existing, pairs[0]!.newContent)];
    }

    const pairBlocks = pairs.map((p, i) =>
      `--- PAIR ${i} ---\nEXISTING MEMORY:\n${p.existing.content}\n\nNEW MEMORY:\n${p.newContent}`,
    ).join('\n\n');

    const batchPrompt = `You have ${pairs.length} pairs of (existing, new) memories to evaluate.\nFor each pair, decide: keep, replace, or merge.\n\n${pairBlocks}`;

    const batchSystem = `${SMART_UPDATE_SYSTEM_PROMPT}\n\nYou are given multiple pairs. Output a JSON array with one decision per pair, in order:\n[{"action": "keep|replace|merge", "merged_content": "...", "reasoning": "..."}, ...]`;

    try {
      const raw = await this.llm.complete(batchPrompt, {
        maxTokens: 200 * pairs.length,
        temperature: 0.1,
        systemPrompt: batchSystem,
      });

      const trimmed = stripCodeFences(raw);
      let arr: any[];
      try {
        arr = JSON.parse(trimmed);
      } catch {
        const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
        if (jsonMatch) arr = JSON.parse(jsonMatch[0]);
        else throw new Error('No JSON array found');
      }

      if (!Array.isArray(arr) || arr.length !== pairs.length) {
        throw new Error(`Expected ${pairs.length} decisions, got ${Array.isArray(arr) ? arr.length : 'non-array'}`);
      }

      return arr.map((obj: any) => {
        const action = ['keep', 'replace', 'merge'].includes(obj?.action) ? obj.action : 'replace';
        return {
          action: action as SmartUpdateDecision['action'],
          merged_content: obj?.merged_content,
          reasoning: obj?.reasoning || '',
        };
      });
    } catch (e: any) {
      log.warn({ error: e.message, count: pairs.length }, 'Batch smart update failed, falling back to individual calls');
      const results: SmartUpdateDecision[] = [];
      for (const pair of pairs) {
        results.push(await this.smartUpdateDecision(pair.existing, pair.newContent));
      }
      return results;
    }
  }

  private parseSmartUpdateResponse(raw: string): SmartUpdateDecision {
    const trimmed = stripCodeFences(raw);
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      const jsonMatch = trimmed.match(/\{[\s\S]*"action"[\s\S]*\}/);
      if (jsonMatch) obj = JSON.parse(jsonMatch[0]);
      else return { action: 'replace', reasoning: 'Failed to parse LLM response, defaulting to replace' };
    }

    const action = ['keep', 'replace', 'merge'].includes(obj.action) ? obj.action : 'replace';
    return {
      action: action as SmartUpdateDecision['action'],
      merged_content: obj.merged_content,
      reasoning: obj.reasoning || '',
    };
  }

  /**
   * Execute a smart update: replace or merge, superseding the old memory.
   */
  async executeSmartUpdate(
    decision: SmartUpdateDecision,
    existing: Memory,
    extraction: ExtractedMemory,
    agentId: string,
    sessionId?: string,
    confidenceOverride?: number,
    sourcePrefix = 'sieve',
  ): Promise<Memory> {
    const content = decision.action === 'merge' && decision.merged_content
      ? decision.merged_content
      : extraction.content;

    const layer = extraction.importance >= 0.8 ? 'core' : 'working';
    const ttlMs = parseDuration(this.config.layers.working.ttl);
    const expiresAt = layer === 'working' ? new Date(Date.now() + ttlMs).toISOString() : undefined;

    const metadata: Record<string, any> = {
      extraction_source: extraction.source,
      reasoning: extraction.reasoning,
      smart_update_type: decision.action,
      update_reasoning: decision.reasoning,
      supersedes: existing.id,
    };

    const newMem = insertMemory({
      layer,
      category: extraction.category,
      content,
      importance: extraction.importance,
      confidence: confidenceOverride ?? 0.8,
      agent_id: agentId,
      source: sessionId ? `${sourcePrefix}:${sessionId}` : sourcePrefix,
      expires_at: expiresAt,
      metadata: JSON.stringify(metadata),
    });

    updateMemory(existing.id, { superseded_by: newMem.id });
    await this.indexVector(newMem.id, content);

    // Auto-log feedback when a correction replaces an existing memory
    if (extraction.category === 'correction') {
      try {
        insertExtractionFeedback({
          memory_id: existing.id,
          agent_id: agentId,
          feedback: 'corrected',
          original_content: existing.content,
          corrected_content: content,
          category: existing.category,
          source_channel: 'auto:correction',
        });
      } catch { /* best-effort */ }
    }

    log.info({
      action: decision.action,
      old_id: existing.id,
      new_id: newMem.id,
      reasoning: decision.reasoning,
    }, 'Smart update executed');

    return newMem;
  }

  /**
   * Unified entry point for processing a new memory extraction.
   *
   * Three-tier matching with near-exact optimization:
   *   distance < exactDupThreshold         → exact duplicate, skip
   *   distance < exactDupThreshold * 1.5   → near-exact, auto-replace (no LLM)
   *   distance < similarityThreshold       → semantic overlap, LLM decides
   *   distance >= similarityThreshold      → unrelated, normal insert
   */
  async processNewMemory(
    extraction: ExtractedMemory,
    agentId: string,
    sessionId?: string,
    confidenceOverride?: number,
    sourcePrefix = 'sieve',
  ): Promise<ProcessResult> {
    const { smartUpdate, exactDupThreshold, similarityThreshold } = this.config.sieve;

    // Corrections get a wider similarity window (1.5x)
    const effectiveThreshold = extraction.category === 'correction'
      ? Math.min(similarityThreshold * 1.5, 0.6)
      : similarityThreshold;

    // Corrections search within related categories
    const correctionCategories = extraction.category === 'correction'
      ? ['identity', 'fact', 'preference', 'decision', 'entity', 'skill', 'relationship', 'goal', 'project_state', 'correction']
      : undefined;

    // Corrections get wider search (top 10) to find the target memory
    const topK = extraction.category === 'correction' ? 10 : 3;
    const similar = await this.findSimilar(extraction.content, agentId, correctionCategories, topK);

    if (!smartUpdate) {
      // Legacy behavior
      if (similar.length > 0 && similar[0]!.distance < LEGACY_DEDUP_THRESHOLD) {
        return { action: 'skipped' };
      }
      const mem = this.insertNewMemory(extraction, agentId, sessionId, confidenceOverride, sourcePrefix);
      await this.indexVector(mem.id, extraction.content);
      return { action: 'inserted', memory: mem };
    }

    // Three-tier + near-exact matching
    if (similar.length > 0) {
      const closest = similar[0]!;

      // Cross-family check
      const newIsAgent = extraction.category.startsWith('agent_');
      const existingIsAgent = closest.memory.category.startsWith('agent_');
      const crossFamily = newIsAgent !== existingIsAgent;

      if (!crossFamily) {
        // Tier 1: exact duplicate → skip
        if (closest.distance < exactDupThreshold) {
          log.info({ distance: closest.distance, existing_id: closest.memory.id }, 'Exact duplicate, skipping');
          return { action: 'skipped' };
        }

        // Tier 1.5: near-exact → auto-replace without LLM call
        const nearExactThreshold = exactDupThreshold * 1.5;
        if (closest.distance < nearExactThreshold) {
          log.info({ distance: closest.distance, existing_id: closest.memory.id }, 'Near-exact match, auto-replacing');
          const newMem = await this.executeSmartUpdate(
            { action: 'replace', reasoning: 'Near-exact match, auto-replaced without LLM' },
            closest.memory, extraction, agentId, sessionId, confidenceOverride, sourcePrefix,
          );
          return { action: 'smart_updated', memory: newMem };
        }

        // Tier 2: semantic overlap → LLM decides
        if (closest.distance < effectiveThreshold) {
          const decision = await this.smartUpdateDecision(closest.memory, extraction.content);
          if (decision.action === 'keep') {
            log.info({ existing_id: closest.memory.id, reasoning: decision.reasoning }, 'Smart update: keep existing');
            return { action: 'skipped' };
          }
          const newMem = await this.executeSmartUpdate(
            decision, closest.memory, extraction, agentId, sessionId, confidenceOverride, sourcePrefix,
          );
          return { action: 'smart_updated', memory: newMem };
        }
      }
    }

    // Tier 3: unrelated → normal insert
    const mem = this.insertNewMemory(extraction, agentId, sessionId, confidenceOverride, sourcePrefix);
    await this.indexVector(mem.id, extraction.content);
    return { action: 'inserted', memory: mem };
  }

  /**
   * Process multiple extractions, batching smart update LLM calls when possible.
   * Collects all pairs needing LLM decisions, sends them in one batch call,
   * then executes the decisions.
   */
  async processNewMemoryBatch(
    extractions: ExtractedMemory[],
    agentId: string,
    sessionId?: string,
    confidenceOverride?: number,
    sourcePrefix = 'sieve',
  ): Promise<ProcessResult[]> {
    if (extractions.length === 0) return [];

    const { smartUpdate, exactDupThreshold, similarityThreshold } = this.config.sieve;

    // Phase 1: find similar for each extraction, classify into tiers
    interface PendingItem {
      index: number;
      extraction: ExtractedMemory;
      similar: SimilarMemory[];
      tier: 'skip' | 'near_exact' | 'needs_llm' | 'insert';
      closest?: SimilarMemory;
    }

    // Phase 1: parallel findSimilar for all extractions
    const similarResults = await Promise.all(
      extractions.map(ext => {
        const cats = ext.category === 'correction'
          ? ['identity', 'fact', 'preference', 'decision', 'entity', 'skill', 'relationship', 'goal', 'project_state', 'correction']
          : undefined;
        // Corrections get wider search (top 10) to find the target memory
        const topK = ext.category === 'correction' ? 10 : 3;
        return this.findSimilar(ext.content, agentId, cats, topK);
      }),
    );

    const pending: PendingItem[] = [];
    for (let i = 0; i < extractions.length; i++) {
      const extraction = extractions[i]!;
      const similar = similarResults[i]!;
      const effectiveThreshold = extraction.category === 'correction'
        ? Math.min(similarityThreshold * 1.5, 0.6)
        : similarityThreshold;

      if (!smartUpdate) {
        if (similar.length > 0 && similar[0]!.distance < 0.15) {
          pending.push({ index: i, extraction, similar, tier: 'skip' });
        } else {
          pending.push({ index: i, extraction, similar, tier: 'insert' });
        }
        continue;
      }

      if (similar.length > 0) {
        const closest = similar[0]!;
        const newIsAgent = extraction.category.startsWith('agent_');
        const existingIsAgent = closest.memory.category.startsWith('agent_');
        const crossFamily = newIsAgent !== existingIsAgent;

        if (!crossFamily) {
          if (closest.distance < exactDupThreshold) {
            pending.push({ index: i, extraction, similar, tier: 'skip', closest });
          } else if (closest.distance < exactDupThreshold * 1.5) {
            pending.push({ index: i, extraction, similar, tier: 'near_exact', closest });
          } else if (closest.distance < effectiveThreshold) {
            pending.push({ index: i, extraction, similar, tier: 'needs_llm', closest });
          } else {
            pending.push({ index: i, extraction, similar, tier: 'insert' });
          }
        } else {
          pending.push({ index: i, extraction, similar, tier: 'insert' });
        }
      } else {
        pending.push({ index: i, extraction, similar, tier: 'insert' });
      }
    }

    // Phase 2: batch LLM call for all items needing smart update
    const llmItems = pending.filter(p => p.tier === 'needs_llm');
    let llmDecisions: SmartUpdateDecision[] = [];
    if (llmItems.length > 0) {
      llmDecisions = await this.batchSmartUpdateDecision(
        llmItems.map(p => ({ existing: p.closest!.memory, newContent: p.extraction.content })),
      );
    }

    // Phase 3: execute all decisions
    const results: ProcessResult[] = new Array(extractions.length);
    let llmIdx = 0;

    for (const item of pending) {
      switch (item.tier) {
        case 'skip':
          results[item.index] = { action: 'skipped' };
          break;

        case 'near_exact': {
          const newMem = await this.executeSmartUpdate(
            { action: 'replace', reasoning: 'Near-exact match, auto-replaced without LLM' },
            item.closest!.memory, item.extraction, agentId, sessionId, confidenceOverride, sourcePrefix,
          );
          results[item.index] = { action: 'smart_updated', memory: newMem };
          break;
        }

        case 'needs_llm': {
          const decision = llmDecisions[llmIdx++]!;
          if (decision.action === 'keep') {
            results[item.index] = { action: 'skipped' };
          } else {
            const newMem = await this.executeSmartUpdate(
              decision, item.closest!.memory, item.extraction, agentId, sessionId, confidenceOverride, sourcePrefix,
            );
            results[item.index] = { action: 'smart_updated', memory: newMem };
          }
          break;
        }

        case 'insert': {
          const mem = this.insertNewMemory(item.extraction, agentId, sessionId, confidenceOverride, sourcePrefix);
          await this.indexVector(mem.id, item.extraction.content);
          results[item.index] = { action: 'inserted', memory: mem };
          break;
        }
      }
    }

    return results;
  }

  /**
   * Insert a new memory.
   */
  insertNewMemory(
    extraction: ExtractedMemory,
    agentId: string,
    sessionId?: string,
    confidenceOverride?: number,
    sourcePrefix = 'sieve',
  ): Memory {
    const layer = extraction.importance >= 0.8 ? 'core' : 'working';
    const ttlMs = parseDuration(this.config.layers.working.ttl);
    const expiresAt = layer === 'working' ? new Date(Date.now() + ttlMs).toISOString() : undefined;

    return insertMemory({
      layer,
      category: extraction.category,
      content: extraction.content,
      importance: extraction.importance,
      confidence: confidenceOverride ?? 0.8,
      agent_id: agentId,
      source: sessionId ? `${sourcePrefix}:${sessionId}` : sourcePrefix,
      expires_at: expiresAt,
      metadata: JSON.stringify({ extraction_source: extraction.source, reasoning: extraction.reasoning }),
    });
  }

  /**
   * Index a memory's vector embedding.
   */
  async indexVector(id: string, content: string): Promise<void> {
    try {
      const embedding = await this.embeddingProvider.embed(content);
      if (embedding.length > 0) {
        await this.vectorBackend.upsert(id, embedding);
      }
    } catch (e: any) {
      log.warn({ id, error: e.message }, 'Vector indexing failed, text-only');
    }
  }
}
