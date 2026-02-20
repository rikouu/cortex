import { getDb } from '../db/connection.js';
import { insertMemory, updateMemory, deleteMemory, insertLifecycleLog, type Memory, type MemoryLayer } from '../db/index.js';
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
  preference:    0.9,
  correction:    0.9,
  skill:         0.85,
  relationship:  0.85,
  goal:          0.8,
  decision:      0.7,
  entity:        0.6,
  project_state: 0.6,
  insight:       0.55,
  fact:          0.5,
  summary:       0.4,
  todo:          0.3,
  context:       0.2,
};

export interface LifecycleReport {
  promoted: number;
  merged: number;
  archived: number;
  compressedToCore: number;
  expiredWorking: number;
  indexRebuilt: boolean;
  errors: string[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

// In-memory profile cache: agentId -> { text, timestamp }
const profileCache = new Map<string, { text: string; timestamp: number }>();
const PROFILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class LifecycleEngine {
  constructor(
    private llm: LLMProvider,
    private embeddingProvider: EmbeddingProvider,
    private vectorBackend: VectorBackend,
    private config: CortexConfig,
  ) {}

  async run(dryRun = false): Promise<LifecycleReport> {
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
    };

    try {
      // Phase 1: Clean expired Working memories
      report.expiredWorking = await this.cleanExpiredWorking(dryRun);

      // Phase 2: Working -> Core promotion
      report.promoted = await this.promoteToCore(dryRun);

      // Phase 3: Core dedup and merge
      report.merged = await this.deduplicateCore(dryRun);

      // Phase 4: Core -> Archive demotion
      report.archived = await this.archiveStale(dryRun);

      // Phase 5: Archive -> Core compression (never lose data)
      report.compressedToCore = await this.compressArchive(dryRun);

      // Phase 6: Update decay scores
      await this.updateDecayScores();

      // Phase 7: Synthesize user profiles for all agents
      try {
        await this.synthesizeAllProfiles();
      } catch (e: any) {
        log.warn({ error: e.message }, 'Profile synthesis failed during lifecycle run');
      }

      report.indexRebuilt = true;
    } catch (e: any) {
      log.error({ error: e.message }, 'Lifecycle engine error');
      report.errors.push(e.message);
    }

    report.completedAt = new Date().toISOString();
    report.durationMs = Date.now() - start;

    if (!dryRun) {
      insertLifecycleLog('lifecycle_run', [], report as any);
    }

    log.info(report, 'Lifecycle run completed');
    return report;
  }

  /** Preview what the next lifecycle run would do */
  async preview(): Promise<LifecycleReport> {
    return this.run(true);
  }

  private async cleanExpiredWorking(dryRun: boolean): Promise<number> {
    const db = getDb();
    const expired = db.prepare(
      "SELECT id FROM memories WHERE layer = 'working' AND expires_at IS NOT NULL AND expires_at < datetime('now')"
    ).all() as { id: string }[];

    if (!dryRun && expired.length > 0) {
      const ids = expired.map(e => e.id);
      const stmt = db.prepare('DELETE FROM memories WHERE id = ?');
      db.transaction(() => { for (const id of ids) stmt.run(id); })();
      await this.vectorBackend.delete(ids);
      insertLifecycleLog('expire_working', ids);
    }

    return expired.length;
  }

  private async promoteToCore(dryRun: boolean): Promise<number> {
    const db = getDb();
    const threshold = this.config.lifecycle.promotionThreshold;

    // Get Working memories older than 24h that haven't expired
    const candidates = db.prepare(`
      SELECT * FROM memories
      WHERE layer = 'working'
        AND created_at < datetime('now', '-24 hours')
        AND (expires_at IS NULL OR expires_at > datetime('now'))
        AND superseded_by IS NULL
    `).all() as Memory[];

    let promoted = 0;
    for (const entry of candidates) {
      const score = this.computePromotionScore(entry);
      if (score >= threshold) {
        if (!dryRun) {
          const newId = generateId();
          insertMemory({
            id: newId,
            layer: 'core',
            category: entry.category === 'context' ? 'fact' : entry.category,
            content: entry.content,
            importance: Math.max(entry.importance, 0.6),
            confidence: entry.confidence,
            agent_id: entry.agent_id,
            source: 'lifecycle:promotion',
          });
          updateMemory(entry.id, { superseded_by: newId });

          // Re-index vector
          try {
            const emb = await this.embeddingProvider.embed(entry.content);
            if (emb.length > 0) await this.vectorBackend.upsert(newId, emb);
          } catch { /* best effort */ }

          insertLifecycleLog('promote', [entry.id, newId], { score, from: 'working', to: 'core' });
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

  private async deduplicateCore(dryRun: boolean): Promise<number> {
    const db = getDb();
    const coreEntries = db.prepare(
      "SELECT * FROM memories WHERE layer = 'core' AND superseded_by IS NULL ORDER BY created_at DESC"
    ).all() as Memory[];

    if (coreEntries.length < 2) return 0;

    let merged = 0;

    // Simple text-similarity dedup (cosine on embeddings when available, otherwise content overlap)
    const seen = new Map<string, Memory>();

    for (const entry of coreEntries) {
      // Check for near-duplicate content (simple substring check)
      let isDuplicate = false;
      for (const [, existing] of seen) {
        if (existing.agent_id !== entry.agent_id) continue;
        const similarity = this.textSimilarity(entry.content, existing.content);
        if (similarity > 0.85) {
          // Keep the newer one (it's first due to ORDER BY DESC)
          if (!dryRun) {
            updateMemory(entry.id, { superseded_by: existing.id });
            try { await this.vectorBackend.delete([entry.id]); } catch { /* best effort */ }
            insertLifecycleLog('merge', [entry.id, existing.id], {
              kept: existing.id,
              removed: entry.id,
              similarity,
            });
          }
          merged++;
          isDuplicate = true;
          break;
        }
      }
      if (!isDuplicate) {
        seen.set(entry.id, entry);
      }
    }

    return merged;
  }

  private textSimilarity(a: string, b: string): number {
    // Jaccard similarity on character trigrams
    const trigramsA = new Set<string>();
    const trigramsB = new Set<string>();
    for (let i = 0; i <= a.length - 3; i++) trigramsA.add(a.slice(i, i + 3));
    for (let i = 0; i <= b.length - 3; i++) trigramsB.add(b.slice(i, i + 3));

    if (trigramsA.size === 0 || trigramsB.size === 0) return 0;

    let intersection = 0;
    for (const t of trigramsA) {
      if (trigramsB.has(t)) intersection++;
    }
    return intersection / (trigramsA.size + trigramsB.size - intersection);
  }

  private async archiveStale(dryRun: boolean): Promise<number> {
    const db = getDb();
    const threshold = this.config.lifecycle.archiveThreshold;

    const coreEntries = db.prepare(
      "SELECT * FROM memories WHERE layer = 'core' AND superseded_by IS NULL"
    ).all() as Memory[];

    let archived = 0;
    for (const entry of coreEntries) {
      if (entry.decay_score < threshold) {
        if (!dryRun) {
          const archiveTtlMs = parseDuration(this.config.layers.archive.ttl);
          updateMemory(entry.id, {
            layer: 'archive',
            expires_at: new Date(Date.now() + archiveTtlMs).toISOString(),
          });
          insertLifecycleLog('archive', [entry.id], { decay_score: entry.decay_score });
        }
        archived++;
      }
    }

    return archived;
  }

  private async compressArchive(dryRun: boolean): Promise<number> {
    if (!this.config.layers.archive.compressBackToCore) return 0;

    const db = getDb();
    const expired = db.prepare(`
      SELECT * FROM memories
      WHERE layer = 'archive'
        AND expires_at IS NOT NULL
        AND expires_at < datetime('now')
        AND superseded_by IS NULL
    `).all() as Memory[];

    if (expired.length === 0) return 0;

    if (!dryRun) {
      // Compress expired archives into a super-summary
      const contents = expired.map(e => `- ${e.content}`).join('\n');

      let superSummary: string;
      try {
        superSummary = await this.llm.complete(
          [
            'Compress these archived memories into a brief super-summary (2-5 sentences).',
            'Preserve key facts and decisions. Output in the same language.',
            '',
            contents.slice(0, 3000),
          ].join('\n'),
          { maxTokens: 200, temperature: 0.2 },
        );
      } catch {
        superSummary = `Archived ${expired.length} memories from ${expired[0]?.created_at?.slice(0, 7) || 'unknown period'}.`;
      }

      // Write super-summary back to Core
      const newId = generateId();
      insertMemory({
        id: newId,
        layer: 'core',
        category: 'summary',
        content: superSummary.trim(),
        importance: 0.6,
        confidence: 0.7,
        agent_id: expired[0]?.agent_id || 'default',
        source: 'lifecycle:compression',
        metadata: JSON.stringify({
          compressed_from: expired.length,
          original_ids: expired.map(e => e.id),
        }),
      });

      try {
        const emb = await this.embeddingProvider.embed(superSummary);
        if (emb.length > 0) await this.vectorBackend.upsert(newId, emb);
      } catch { /* best effort */ }

      // Mark originals as superseded
      const stmt = db.prepare('UPDATE memories SET superseded_by = ? WHERE id = ?');
      db.transaction(() => {
        for (const e of expired) stmt.run(newId, e.id);
      })();

      insertLifecycleLog('compress', expired.map(e => e.id), {
        super_summary_id: newId,
        compressed_count: expired.length,
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

        const decayScore = Math.min(1.0, baseImp * accessFreq + recencyFactor * m.importance);
        stmt.run(Math.max(0, decayScore), m.id);
      }
    })();
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
   * Synthesize profiles for all agents after lifecycle run.
   */
  async synthesizeAllProfiles(): Promise<void> {
    const db = getDb();
    const agents = db.prepare('SELECT DISTINCT id FROM agents').all() as { id: string }[];

    for (const agent of agents) {
      try {
        await this.synthesizeProfile(agent.id);
      } catch (e: any) {
        log.warn({ agent_id: agent.id, error: e.message }, 'Failed to synthesize profile for agent');
      }
    }
  }
}
