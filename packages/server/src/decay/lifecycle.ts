import { getDb } from '../db/connection.js';
import {
  insertMemory, updateMemory, deleteMemory, insertLifecycleLog,
  getMemoriesNeedingAdjustment, getMemoryById, insertImportanceAdjustment,
  type Memory, type MemoryLayer,
} from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { generateId, parseDuration } from '../utils/helpers.js';
import type { LLMProvider } from '../llm/interface.js';
import type { EmbeddingProvider } from '../embedding/interface.js';
import type { VectorBackend } from '../vector/interface.js';
import type { CortexConfig } from '../utils/config.js';
import { PROFILE_SYNTHESIS_PROMPT } from '../core/prompts.js';

const log = createLogger('lifecycle');

// Base importance by category (how slowly it decays)
const BASE_IMPORTANCE: Record<string, number> = {
  identity:      1.0,
  constraint:    1.0,
  preference:    0.9,
  correction:    0.9,
  agent_persona: 0.9,
  skill:         0.85,
  relationship:  0.85,
  agent_relationship: 0.85,
  goal:          0.8,
  agent_user_habit: 0.8,
  policy:        0.75,
  agent_self_improvement: 0.75,
  decision:      0.7,
  entity:        0.6,
  project_state: 0.6,
  insight:       0.55,
  fact:          0.5,
  summary:       0.4,
  todo:          0.3,
  context:       0.2,
};

export interface AffectedMemory {
  id: string;
  content: string;
  category: string;
  importance: number;
  action: 'promote' | 'expire' | 'archive' | 'merge' | 'compress';
  score?: number;
  reason?: string;
}

export interface LifecycleReport {
  promoted: number;
  merged: number;
  archived: number;
  compressedToCore: number;
  expiredWorking: number;
  importanceAdjusted?: number;
  indexRebuilt: boolean;
  errors: string[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
  affectedMemories?: AffectedMemory[];
}

// In-memory profile cache: agentId -> { text, timestamp }
const profileCache = new Map<string, { text: string; timestamp: number }>();
const PROFILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Global lifecycle active flag — used by sieve to skip smart update during lifecycle
let _lifecycleActive = false;
export function isLifecycleActive(): boolean { return _lifecycleActive; }

export class LifecycleEngine {
  private running = false;

  constructor(
    private llm: LLMProvider,
    private embeddingProvider: EmbeddingProvider,
    private vectorBackend: VectorBackend,
    private config: CortexConfig,
  ) {}

  async run(dryRun = false, trigger: 'manual' | 'scheduled' | 'preview' = 'manual', agentId?: string): Promise<LifecycleReport> {
    if (this.running) {
      log.warn('Lifecycle already running, skipping');
      return {
        promoted: 0, merged: 0, archived: 0, compressedToCore: 0,
        expiredWorking: 0, indexRebuilt: false,
        errors: ['Skipped: lifecycle already running'],
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
      };
    }

    this.running = true;
    _lifecycleActive = true;
    const start = Date.now();
    const report: LifecycleReport = {
      promoted: 0,
      merged: 0,
      archived: 0,
      compressedToCore: 0,
      expiredWorking: 0,
      indexRebuilt: false,
      errors: [],
      startedAt: new Date().toISOString(),
      completedAt: '',
      durationMs: 0,
      affectedMemories: dryRun ? [] : undefined,
    };

    try {
      // Phase 1: Clean expired Working memories
      log.info('Phase 1: cleanExpiredWorking');
      report.expiredWorking = await this.cleanExpiredWorking(dryRun, report.affectedMemories, agentId);

      // Phase 2: Working -> Core promotion
      log.info('Phase 2: promoteToCore');
      report.promoted = await this.promoteToCore(dryRun, report.affectedMemories, agentId);

      // Phase 3: Core dedup and merge (skip in dry-run — O(N) embedding calls)
      if (!dryRun) {
        log.info('Phase 3: deduplicateCore');
        report.merged = await this.deduplicateCore(dryRun, agentId);
      } else {
        log.info('Phase 3: deduplicateCore (skipped in dry-run)');
      }

      // Phase 4: Core -> Archive demotion
      log.info('Phase 4: archiveStale');
      report.archived = await this.archiveStale(dryRun, report.affectedMemories, agentId);

      // Phase 5: Archive -> Core compression (never lose data)
      log.info('Phase 5: compressArchive');
      report.compressedToCore = await this.compressArchive(dryRun, agentId);

      // Phase 6: Update decay scores
      log.info('Phase 6: updateDecayScores');
      await this.updateDecayScores();

      // Phase 6b: Decay stale relation confidences
      log.info('Phase 6b: updateRelationDecay');
      await this.updateRelationDecay();

      // Phase 6c: Adjust importance from memory feedback (self-improvement)
      if (this.config.selfImprovement?.enabled !== false && !dryRun) {
        log.info('Phase 6c: adjustImportanceFromFeedback');
        try {
          const adjusted = await this.adjustImportanceFromFeedback(agentId);
          report.importanceAdjusted = adjusted;
        } catch (e: any) {
          log.warn({ error: e.message }, 'Self-improvement feedback adjustment failed');
          report.errors.push(`Phase 6c: ${e.message}`);
        }
      }

      // Phase 7: Synthesize user profiles (skip in dry-run)
      if (!dryRun) {
        try {
          await this.synthesizeProfiles(agentId);
        } catch (e: any) {
          log.warn({ error: e.message }, 'Profile synthesis failed during lifecycle run');
        }
      }

      // Phase 8: Clean old access logs (keep 30 days)
      log.info('Phase 8: cleanAccessLogs');
      try {
        const db = getDb();
        const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
        const result = db.prepare("DELETE FROM access_log WHERE accessed_at < ?").run(cutoff);
        if (result.changes > 0) {
          log.info({ deleted: result.changes }, 'Cleaned old access logs');
        }
        (report as any).accessLogsCleaned = result.changes;
      } catch (e: any) {
        log.warn({ error: e.message }, 'Access log cleanup failed');
      }

      report.indexRebuilt = true;
    } catch (e: any) {
      log.error({ error: e.message, stack: e.stack }, 'Lifecycle engine error');
      report.errors.push(e.message);
    } finally {
      this.running = false;
      _lifecycleActive = false;
    }

    report.completedAt = new Date().toISOString();
    report.durationMs = Date.now() - start;

    if (!dryRun) {
      insertLifecycleLog('lifecycle_run', [], { ...report, trigger, agent_id: agentId || 'all' } as any);
    }

    log.info(report, 'Lifecycle run completed');
    return report;
  }

  /** Preview what the next lifecycle run would do */
  async preview(agentId?: string): Promise<LifecycleReport> {
    return this.run(true, 'preview', agentId);
  }

  private async cleanExpiredWorking(dryRun: boolean, affected?: AffectedMemory[], agentId?: string): Promise<number> {
    const db = getDb();
    const agentFilter = agentId ? ' AND agent_id = ?' : '';
    const params = agentId ? [agentId] : [];
    const now = new Date().toISOString();
    const expired = db.prepare(
      `SELECT id, content, category, importance FROM memories WHERE layer = 'working' AND expires_at IS NOT NULL AND expires_at < ?${agentFilter}`
    ).all(now, ...params) as { id: string; content: string; category: string; importance: number }[];

    if (dryRun && affected) {
      for (const e of expired) {
        affected.push({ id: e.id, content: e.content, category: e.category, importance: e.importance, action: 'expire', reason: 'expired' });
      }
    }

    if (!dryRun && expired.length > 0) {
      const ids = expired.map(e => e.id);
      // Nullify/delete FK references before deleting to avoid FOREIGN KEY constraint errors
      const deleteAccessLog = db.prepare('DELETE FROM access_log WHERE memory_id = ?');
      const nullifyRelations = db.prepare('UPDATE relations SET source_memory_id = NULL WHERE source_memory_id = ?');
      const nullifyEvidence = db.prepare('UPDATE relation_evidence SET memory_id = NULL WHERE memory_id = ?');
      const stmt = db.prepare('DELETE FROM memories WHERE id = ?');
      db.transaction(() => {
        for (const id of ids) {
          deleteAccessLog.run(id);
          nullifyRelations.run(id);
          try { nullifyEvidence.run(id); } catch { /* table may not exist in older schemas */ }
          stmt.run(id);
        }
      })();
      await this.vectorBackend.delete(ids);
      insertLifecycleLog('expire_working', ids, { agent_id: agentId || 'all' });
    }

    return expired.length;
  }

  private async promoteToCore(dryRun: boolean, affected?: AffectedMemory[], agentId?: string): Promise<number> {
    const db = getDb();
    const threshold = this.config.lifecycle.promotionThreshold;
    const agentFilter = agentId ? ' AND agent_id = ?' : '';
    const params = agentId ? [agentId] : [];

    // Get Working memories older than 24h that haven't expired
    const now = new Date();
    const nowIso = now.toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 3600_000).toISOString();
    const candidates = db.prepare(`
      SELECT * FROM memories
      WHERE layer = 'working'
        AND created_at < ?
        AND (expires_at IS NULL OR expires_at > ?)
        AND superseded_by IS NULL${agentFilter}
    `).all(twentyFourHoursAgo, nowIso, ...params) as Memory[];

    let promoted = 0;
    for (const entry of candidates) {
      // High-importance memories (identity, correction, constraint) auto-promote
      // BUT skip if confidence is too low (e.g. feedback=bad)
      if (entry.importance >= 0.9 && entry.confidence >= 0.3) {
        if (dryRun && affected) {
          affected.push({ id: entry.id, content: entry.content, category: entry.category, importance: entry.importance, action: 'promote', score: 1.0, reason: 'high_importance_auto' });
        }
        if (!dryRun) {
          const newCategory = entry.category === 'context' ? 'fact' : entry.category;
          const needsCategoryChange = newCategory !== entry.category;
          if (needsCategoryChange) {
            // Category change requires insert+supersede to maintain category integrity
            const newId = generateId();
            insertMemory({
              id: newId, layer: 'core', category: newCategory,
              content: entry.content, importance: Math.max(entry.importance, threshold),
              confidence: entry.confidence, agent_id: entry.agent_id,
              source: 'lifecycle:auto-promotion',
            });
            updateMemory(entry.id, { superseded_by: newId });
            try {
              const emb = await this.embeddingProvider.embed(entry.content);
              if (emb.length > 0) await this.vectorBackend.upsert(newId, emb);
              await this.vectorBackend.delete([entry.id]);
            } catch { /* best effort */ }
            insertLifecycleLog('promote', [entry.id, newId], { score: 1.0, from: 'working', to: 'core', reason: 'high_importance_auto', agent_id: agentId || 'all' });
          } else {
            // Same content, same category → in-place layer update (preserves ID, access_count)
            // Update source to 'lifecycle:*' so deduplicateCore can find promoted entries
            updateMemory(entry.id, {
              layer: 'core' as MemoryLayer,
              importance: Math.max(entry.importance, threshold),
              source: 'lifecycle:auto-promotion',
            });
            insertLifecycleLog('promote', [entry.id], { score: 1.0, from: 'working', to: 'core', reason: 'high_importance_auto_inplace', agent_id: agentId || 'all' });
          }
        }
        promoted++;
        continue;
      }

      const score = this.computePromotionScore(entry);
      if (score >= threshold && entry.confidence >= 0.3) {
        if (dryRun && affected) {
          affected.push({ id: entry.id, content: entry.content, category: entry.category, importance: entry.importance, action: 'promote', score, reason: 'score_threshold' });
        }
        if (!dryRun) {
          const newCategory = entry.category === 'context' ? 'fact' : entry.category;
          const needsCategoryChange = newCategory !== entry.category;
          if (needsCategoryChange) {
            const newId = generateId();
            insertMemory({
              id: newId, layer: 'core', category: newCategory,
              content: entry.content, importance: Math.max(entry.importance, threshold),
              confidence: entry.confidence, agent_id: entry.agent_id,
              source: 'lifecycle:promotion',
            });
            updateMemory(entry.id, { superseded_by: newId });
            try {
              const emb = await this.embeddingProvider.embed(entry.content);
              if (emb.length > 0) await this.vectorBackend.upsert(newId, emb);
              await this.vectorBackend.delete([entry.id]);
            } catch { /* best effort */ }
            insertLifecycleLog('promote', [entry.id, newId], { score, from: 'working', to: 'core', agent_id: agentId || 'all' });
          } else {
            // In-place promotion: just update the layer
            // Update source to 'lifecycle:*' so deduplicateCore can find promoted entries
            updateMemory(entry.id, {
              layer: 'core' as MemoryLayer,
              importance: Math.max(entry.importance, threshold),
              source: 'lifecycle:promotion',
            });
            insertLifecycleLog('promote', [entry.id], { score, from: 'working', to: 'core', reason: 'inplace', agent_id: agentId || 'all' });
          }
        }
        promoted++;
      }
    }

    return promoted;
  }

  private computePromotionScore(entry: Memory): number {
    const baseImportance = BASE_IMPORTANCE[entry.category] || 0.5;
    const accessFactor = Math.log(1 + entry.access_count) / Math.log(1 + 10);
    const importanceFactor = entry.importance;

    return (baseImportance * 0.3 + accessFactor * 0.4 + importanceFactor * 0.3);
  }

  private async deduplicateCore(dryRun: boolean, agentId?: string): Promise<number> {
    const db = getDb();
    const agentFilter = agentId ? ' AND agent_id = ?' : '';
    const params = agentId ? [agentId] : [];

    // Only dedup core memories that were recently promoted or created.
    // Ingest-time dedup already handles most duplicates; lifecycle dedup catches
    // cross-session duplicates that slipped through (e.g. promoted from working).
    // source LIKE 'lifecycle:%' finds newly promoted entries (cleared after dedup).
    // 4h window catches new direct inserts. Use ISO format for created_at comparison
    // since created_at is stored as ISO strings (with T separator).
    const fourHoursAgo = new Date(Date.now() - 4 * 3600_000).toISOString();
    const coreEntries = db.prepare(
      `SELECT * FROM memories WHERE layer = 'core' AND superseded_by IS NULL
        AND (source LIKE 'lifecycle:%' OR created_at > ?)${agentFilter}
        ORDER BY created_at DESC`
    ).all(fourHoursAgo, ...params) as Memory[];

    if (coreEntries.length < 1) return 0;

    log.info({ candidates: coreEntries.length }, 'deduplicateCore: scanning recent/promoted entries');

    let merged = 0;
    const superseded = new Set<string>();
    const { exactDupThreshold } = this.config.sieve;
    // Use a slightly wider threshold for lifecycle dedup (1.5x exact dup)
    const lifecycleDupThreshold = exactDupThreshold * 1.5;

    for (const entry of coreEntries) {
      if (entry.is_pinned) continue;
      if (superseded.has(entry.id)) continue;

      try {
        const embedding = await this.embeddingProvider.embed(entry.content);
        if (embedding.length === 0) continue;

        const similar = await this.vectorBackend.search(embedding, 5, { agent_id: entry.agent_id });
        for (const hit of similar) {
          if (hit.id === entry.id) continue;
          if (superseded.has(hit.id)) continue;
          if (hit.distance >= lifecycleDupThreshold) break; // sorted by distance

          const existing = db.prepare(
            "SELECT * FROM memories WHERE id = ? AND layer = 'core' AND superseded_by IS NULL"
          ).get(hit.id) as Memory | undefined;
          if (!existing || existing.is_pinned) continue;
          if (existing.agent_id !== entry.agent_id) continue;

          // entry is newer (ORDER BY DESC), keep entry, supersede existing
          if (!dryRun) {
            updateMemory(existing.id, { superseded_by: entry.id });
            try { await this.vectorBackend.delete([existing.id]); } catch { /* best effort */ }
            insertLifecycleLog('merge', [existing.id, entry.id], {
              kept: entry.id,
              removed: existing.id,
              distance: hit.distance,
              agent_id: agentId || 'all',
            });
          }
          superseded.add(existing.id);
          merged++;
        }
      } catch { /* best effort — skip this entry */ }
    }

    // Clear lifecycle: source marker on checked entries so they're not rescanned
    // in subsequent lifecycle runs. Only clear non-superseded ones.
    if (!dryRun) {
      const clearStmt = db.prepare(
        "UPDATE memories SET source = 'core:deduped' WHERE id = ? AND superseded_by IS NULL"
      );
      db.transaction(() => {
        for (const entry of coreEntries) {
          if (!superseded.has(entry.id) && entry.source?.startsWith('lifecycle:')) {
            clearStmt.run(entry.id);
          }
        }
      })();
    }

    return merged;
  }

  private async archiveStale(dryRun: boolean, affected?: AffectedMemory[], agentId?: string): Promise<number> {
    const db = getDb();
    const threshold = this.config.lifecycle.archiveThreshold;
    const agentFilter = agentId ? ' AND agent_id = ?' : '';
    const params = agentId ? [agentId] : [];

    const coreEntries = db.prepare(
      `SELECT * FROM memories WHERE layer = 'core' AND superseded_by IS NULL AND is_pinned = 0${agentFilter}`
    ).all(...params) as Memory[];

    let archived = 0;
    for (const entry of coreEntries) {
      if (entry.decay_score < threshold) {
        if (dryRun && affected) {
          affected.push({ id: entry.id, content: entry.content, category: entry.category, importance: entry.importance, action: 'archive', score: entry.decay_score, reason: 'low_decay' });
        }
        if (!dryRun) {
          const archiveTtlMs = parseDuration(this.config.layers.archive.ttl);
          updateMemory(entry.id, {
            layer: 'archive',
            expires_at: new Date(Date.now() + archiveTtlMs).toISOString(),
          });
          insertLifecycleLog('archive', [entry.id], { decay_score: entry.decay_score, agent_id: agentId || 'all' });
        }
        archived++;
      }
    }

    return archived;
  }

  private async compressArchive(dryRun: boolean, agentId?: string): Promise<number> {
    if (!this.config.layers.archive.compressBackToCore) return 0;

    const db = getDb();
    const agentFilter = agentId ? ' AND agent_id = ?' : '';
    const params = agentId ? [agentId] : [];
    const nowIso = new Date().toISOString();
    const expired = db.prepare(`
      SELECT * FROM memories
      WHERE layer = 'archive'
        AND expires_at IS NOT NULL
        AND expires_at < ?
        AND superseded_by IS NULL${agentFilter}
    `).all(nowIso, ...params) as Memory[];

    if (expired.length === 0) return 0;

    if (!dryRun) {
      // Group by agent_id + category to prevent cross-agent memory mixing
      const groups = new Map<string, Memory[]>();
      for (const e of expired) {
        const key = `${e.agent_id}::${e.category}`;
        const list = groups.get(key) || [];
        list.push(e);
        groups.set(key, list);
      }

      const allOriginalIds: string[] = [];

      for (const [groupKey, items] of groups) {
        const category = items[0]!.category;
        const groupAgentId = items[0]!.agent_id;

        // Single item: just move back to core without LLM compression
        if (items.length === 1) {
          const item = items[0]!;
          const newId = generateId();
          insertMemory({
            id: newId,
            layer: 'core',
            category: item.category,
            content: item.content,
            importance: Math.max(item.importance, BASE_IMPORTANCE[category] || 0.5),
            confidence: item.confidence,
            agent_id: groupAgentId,
            source: 'lifecycle:compression',
            metadata: JSON.stringify({ compressed_from: 1, original_ids: [item.id] }),
          });
          try {
            const emb = await this.embeddingProvider.embed(item.content);
            if (emb.length > 0) await this.vectorBackend.upsert(newId, emb);
          } catch { /* best effort */ }
          db.prepare('UPDATE memories SET superseded_by = ? WHERE id = ?').run(newId, item.id);
          try { await this.vectorBackend.delete([item.id]); } catch { /* best effort */ }
          allOriginalIds.push(item.id);
          continue;
        }

        // Multiple items: LLM compress per agent+category group
        const contents = items.map(e => `- ${e.content}`).join('\n');
        let compressed: string;
        try {
          compressed = await this.llm.complete(
            `Compress these ${category} memories into 1-3 concise sentences. Preserve all key facts. Same language as input.\n\n${contents.slice(0, 3000)}`,
            { maxTokens: 200, temperature: 0.2 },
          );
        } catch {
          compressed = items.map(e => e.content).join('; ');
        }

        const newId = generateId();
        insertMemory({
          id: newId,
          layer: 'core',
          category: category as any,
          content: compressed.trim(),
          importance: BASE_IMPORTANCE[category] || 0.6,
          confidence: 0.7,
          agent_id: groupAgentId,
          source: 'lifecycle:compression',
          metadata: JSON.stringify({ compressed_from: items.length, original_ids: items.map(e => e.id) }),
        });

        try {
          const emb = await this.embeddingProvider.embed(compressed);
          if (emb.length > 0) await this.vectorBackend.upsert(newId, emb);
        } catch { /* best effort */ }

        const stmt = db.prepare('UPDATE memories SET superseded_by = ? WHERE id = ?');
        const deleteIds: string[] = [];
        db.transaction(() => {
          for (const e of items) {
            stmt.run(newId, e.id);
            deleteIds.push(e.id);
          }
        })();
        try { await this.vectorBackend.delete(deleteIds); } catch { /* best effort */ }
        allOriginalIds.push(...deleteIds);
      }

      insertLifecycleLog('compress', allOriginalIds, {
        compressed_count: expired.length,
        groups: groups.size,
        agent_id: agentId || 'all',
      });
    }

    return expired.length;
  }

  private async updateDecayScores(): Promise<void> {
    const db = getDb();
    const lambda = this.config.lifecycle.decayLambda;

    // Update all active memories' decay scores
    const memories = db.prepare(
      "SELECT id, category, importance, access_count, last_accessed, created_at FROM memories WHERE superseded_by IS NULL"
    ).all() as Pick<Memory, 'id' | 'category' | 'importance' | 'access_count' | 'last_accessed' | 'created_at'>[];

    const now = Date.now();
    const stmt = db.prepare('UPDATE memories SET decay_score = ? WHERE id = ?');

    db.transaction(() => {
      for (const m of memories) {
        const baseImp = BASE_IMPORTANCE[m.category] || 0.5;
        const maxAccess = 20;
        const accessFreq = Math.log(1 + m.access_count) / Math.log(1 + maxAccess);

        const lastAccessed = m.last_accessed ? new Date(m.last_accessed).getTime() : new Date(m.created_at).getTime();
        const daysSinceAccess = (now - lastAccessed) / 86_400_000;
        const recencyFactor = Math.exp(-lambda * daysSinceAccess);

        // Floor guarantee: high baseImp categories (identity, constraint) always retain 0.3+ even with zero access
        const decayScore = Math.min(1.0, baseImp * 0.3 + baseImp * accessFreq * 0.3 + recencyFactor * m.importance * 0.4);
        stmt.run(Math.max(0, decayScore), m.id);
      }
    })();
  }

  /**
   * Decay confidence of relations that haven't been re-confirmed recently.
   * 30-day grace period: only decay relations older than 30 days since last update.
   * Uses exponential decay: decayed = max(0.1, confidence * exp(-lambda * (days - 30)))
   */
  private async updateRelationDecay(): Promise<void> {
    const db = getDb();
    const lambda = this.config.lifecycle.decayLambda;

    const relations = db.prepare(
      "SELECT id, confidence, updated_at FROM relations WHERE expired = 0"
    ).all() as { id: string; confidence: number; updated_at: string }[];

    const now = Date.now();
    const GRACE_DAYS = 30;
    const stmt = db.prepare('UPDATE relations SET confidence = ? WHERE id = ?');

    db.transaction(() => {
      for (const rel of relations) {
        const updatedAt = new Date(rel.updated_at).getTime();
        const daysSinceUpdate = (now - updatedAt) / 86_400_000;

        if (daysSinceUpdate <= GRACE_DAYS) continue;

        const excessDays = daysSinceUpdate - GRACE_DAYS;
        const decayed = Math.max(0.1, rel.confidence * Math.exp(-lambda * excessDays));

        if (Math.abs(decayed - rel.confidence) > 0.001) {
          stmt.run(decayed, rel.id);
        }
      }
    })();
  }

  /**
   * Phase 6c: Self-improvement — adjust memory importance based on feedback signals.
   *
   * For each memory with enough feedback in the configured window:
   * 1. Compute weighted average of feedback signals (explicit weighted more than implicit)
   * 2. Compute delta (clamped to maxDelta)
   * 3. Skip pinned memories
   * 4. Skip if delta is below minDelta threshold (noise filter)
   * 5. Apply adjustment and log to importance_adjustments audit table
   *
   * Signal weights: helpful=+1, not_helpful=-1, outdated=-0.5, wrong=-1
   */
  private async adjustImportanceFromFeedback(agentId?: string): Promise<number> {
    const selfConfig = this.config.selfImprovement;
    const windowDays = selfConfig?.windowSize ?? 30;
    const minFeedbacks = selfConfig?.minFeedbacks ?? 3;
    const maxDelta = selfConfig?.maxDelta ?? 0.15;
    const implicitWeight = selfConfig?.implicitWeight ?? 0.3;
    const explicitWeight = selfConfig?.explicitWeight ?? 1.0;
    const minDelta = selfConfig?.minDelta ?? 0.01;

    // Signal score mapping
    const SIGNAL_SCORE: Record<string, number> = {
      helpful: 1.0,
      not_helpful: -1.0,
      outdated: -0.5,
      wrong: -1.0,
    };

    const candidates = getMemoriesNeedingAdjustment({
      agent_id: agentId,
      minFeedbacks,
      windowDays,
    });

    if (candidates.length === 0) return 0;

    let adjusted = 0;
    const db = getDb();

    for (const candidate of candidates) {
      const memory = getMemoryById(candidate.memory_id);
      if (!memory) continue;

      // Skip pinned memories
      if (memory.is_pinned) continue;

      // Get individual feedback entries for this memory to compute weighted score
      const feedbacks = db.prepare(`
        SELECT id, signal, source FROM memory_feedback
        WHERE memory_id = ? AND created_at > ?
      `).all(candidate.memory_id, new Date(Date.now() - windowDays * 86400_000).toISOString()) as { id: string; signal: string; source: string }[];

      if (feedbacks.length < minFeedbacks) continue;

      // Compute weighted average score
      let weightedSum = 0;
      let totalWeight = 0;
      const feedbackIds: string[] = [];

      for (const fb of feedbacks) {
        const signalScore = SIGNAL_SCORE[fb.signal] ?? 0;
        const weight = fb.source === 'implicit' ? implicitWeight : explicitWeight;
        weightedSum += signalScore * weight;
        totalWeight += weight;
        feedbackIds.push(fb.id);
      }

      if (totalWeight === 0) continue;

      const avgScore = weightedSum / totalWeight; // Range: -1 to +1

      // Map average score to delta: positive score → increase importance, negative → decrease
      let delta = avgScore * maxDelta;

      // Clamp delta
      delta = Math.max(-maxDelta, Math.min(maxDelta, delta));

      // Skip noise — if the change is too small, don't bother
      if (Math.abs(delta) < minDelta) continue;

      const oldImportance = memory.importance;
      const newImportance = Math.max(0.05, Math.min(1.0, oldImportance + delta));

      // Skip if effective change is negligible
      if (Math.abs(newImportance - oldImportance) < 0.001) continue;

      // Apply the adjustment
      updateMemory(memory.id, { importance: newImportance });

      // Record in audit log
      insertImportanceAdjustment({
        memory_id: memory.id,
        agent_id: memory.agent_id,
        old_importance: oldImportance,
        new_importance: newImportance,
        delta: newImportance - oldImportance,
        reason: `feedback_weighted_avg: ${avgScore.toFixed(3)} (${feedbacks.length} feedbacks)`,
        feedback_ids: feedbackIds.length > 0 ? feedbackIds : undefined,
      });

      insertLifecycleLog('importance_adjustment', [memory.id], {
        old_importance: oldImportance,
        new_importance: newImportance,
        delta: newImportance - oldImportance,
        feedback_count: feedbacks.length,
        avg_score: avgScore,
        agent_id: memory.agent_id,
      });

      adjusted++;
    }

    if (adjusted > 0) {
      log.info({ adjusted, candidates: candidates.length }, 'Self-improvement: adjusted memory importance from feedback');
    }

    return adjusted;
  }

  /**
   * Synthesize a compact user profile from Core memories.
   * Called after lifecycle runs, and cached for 24h.
   */
  async synthesizeProfile(agentId: string): Promise<string> {
    // Check cache first
    const cached = profileCache.get(agentId);
    if (cached && (Date.now() - cached.timestamp) < PROFILE_CACHE_TTL_MS) {
      return cached.text;
    }

    const db = getDb();

    // Query top 30 Core memories (non context/summary), ordered by importance
    const coreMemories = db.prepare(`
      SELECT category, content, importance FROM memories
      WHERE agent_id = ? AND layer = 'core' AND superseded_by IS NULL
        AND category NOT IN ('context', 'summary')
      ORDER BY importance DESC
      LIMIT 30
    `).all(agentId) as { category: string; content: string; importance: number }[];

    if (coreMemories.length === 0) {
      return '';
    }

    // Group by category
    const grouped = new Map<string, string[]>();
    for (const m of coreMemories) {
      const list = grouped.get(m.category) || [];
      list.push(m.content);
      grouped.set(m.category, list);
    }

    // Build input for LLM
    const lines: string[] = [];
    for (const [category, items] of grouped) {
      lines.push(`## ${category}`);
      for (const item of items) {
        lines.push(`- ${item}`);
      }
      lines.push('');
    }
    const input = lines.join('\n');

    let profile: string;
    try {
      profile = await this.llm.complete(input, {
        maxTokens: 400,
        temperature: 0.2,
        systemPrompt: PROFILE_SYNTHESIS_PROMPT,
      });
      profile = profile.trim();
    } catch (e: any) {
      log.warn({ error: e.message }, 'Profile synthesis LLM failed, using fallback');
      // Fallback: simple concatenation
      const fallbackLines: string[] = ['[用户画像]'];
      for (const [category, items] of grouped) {
        fallbackLines.push(`- ${category}: ${items.slice(0, 3).join('; ')}`);
      }
      profile = fallbackLines.join('\n');
    }

    // Store in agents.metadata
    try {
      const agent = db.prepare('SELECT metadata FROM agents WHERE id = ?').get(agentId) as { metadata: string | null } | undefined;
      let meta: Record<string, any> = {};
      if (agent?.metadata) {
        try { meta = JSON.parse(agent.metadata); } catch { /* ignore */ }
      }
      meta.profile = profile;
      meta.profile_updated_at = new Date().toISOString();

      db.prepare('UPDATE agents SET metadata = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(JSON.stringify(meta), agentId);
    } catch (e: any) {
      log.warn({ error: e.message }, 'Failed to store profile in agents table');
    }

    // Update cache
    profileCache.set(agentId, { text: profile, timestamp: Date.now() });

    log.info({ agent_id: agentId, profile_length: profile.length }, 'Profile synthesized');
    return profile;
  }

  /**
   * Synthesize profiles after lifecycle run.
   * If agentId is provided, only synthesize for that agent.
   * Otherwise, synthesize for all agents.
   */
  async synthesizeProfiles(agentId?: string): Promise<void> {
    const db = getDb();
    const agents = agentId
      ? [{ id: agentId }]
      : (db.prepare('SELECT DISTINCT id FROM agents').all() as { id: string }[]);

    for (const agent of agents) {
      try {
        await this.synthesizeProfile(agent.id);
      } catch (e: any) {
        log.warn({ agent_id: agent.id, error: e.message }, 'Failed to synthesize profile for agent');
      }
    }
  }
}
