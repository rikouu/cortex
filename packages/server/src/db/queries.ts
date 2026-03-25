import Database from 'better-sqlite3';
import { getDb } from './connection.js';
import { generateId, normalizeEntity, escapeLikePattern } from '../utils/helpers.js';
import { tokenize, tokenizeQuery } from '../utils/tokenizer.js';

// ============ Memory Types ============

export type MemoryLayer = 'working' | 'core' | 'archive';
export type MemoryCategory =
  | 'identity' | 'preference' | 'decision' | 'fact' | 'entity'
  | 'correction' | 'todo' | 'context' | 'summary'
  // V2 新增
  | 'skill' | 'relationship' | 'goal' | 'insight' | 'project_state'
  // V3 新增
  | 'constraint' | 'policy'
  | 'agent_self_improvement' | 'agent_user_habit' | 'agent_relationship' | 'agent_persona';

export interface Memory {
  id: string;
  layer: MemoryLayer;
  category: MemoryCategory;
  content: string;
  source: string | null;
  agent_id: string;
  importance: number;
  confidence: number;
  decay_score: number;
  access_count: number;
  last_accessed: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  superseded_by: string | null;
  metadata: string | null;
  is_pinned: number;
  pairing_code: string | null;
}

export interface Relation {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  source_memory_id: string | null;
  agent_id: string;
  source: string;
  extraction_count: number;
  expired: number;
  created_at: string;
  updated_at: string;
}

export interface RelationEvidence {
  id: number;
  relation_id: string;
  memory_id: string | null;
  source: string;
  confidence: number;
  context: string | null;
  created_at: string;
}

export interface AccessLogEntry {
  id: number;
  memory_id: string;
  query: string | null;
  rank: number | null;
  was_useful: boolean | null;
  accessed_at: string;
}

export interface LifecycleLogEntry {
  id: number;
  action: string;
  memory_ids: string;
  details: string | null;
  executed_at: string;
}

// ============ Memory Queries ============

export function insertMemory(mem: Partial<Memory> & { pairing_code?: string | null; } & { layer: MemoryLayer; category: MemoryCategory; content: string }): Memory {
  const db = getDb();
  const id = mem.id || generateId();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO memories (
    pairing_code,id, layer, category, content, source, agent_id, importance, confidence, decay_score, expires_at, metadata, created_at, updated_at)
    VALUES (
    mem.pairing_code ?? null,?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    mem.layer,
    mem.category,
    mem.content,
    mem.source || null,
    mem.agent_id || 'default',
    mem.importance ?? 0.5,
    mem.confidence ?? 0.8,
    mem.decay_score ?? 1.0,
    mem.expires_at || null,
    mem.metadata || null,
    now,
    now,
  );

  // Sync FTS index (jieba-tokenized)
  syncFtsInsert(db, id, mem.content, mem.category);

  return getMemoryById(id)!;
}

// ============ FTS Sync (jieba tokenization) ============

function syncFtsInsert(db: Database.Database, id: string, content: string, category: string): void {
  // Get rowid from the inserted memory
  const row = db.prepare('SELECT rowid FROM memories WHERE id = ?').get(id) as { rowid: number } | undefined;
  if (!row) return;
  db.prepare('INSERT INTO memories_fts(rowid, content, category) VALUES (?, ?, ?)').run(
    row.rowid,
    tokenize(content),
    category,
  );
}

function syncFtsDelete(db: Database.Database, rowid: number, oldContent: string, oldCategory: string): void {
  // For standalone FTS5 table (no external content), use regular DELETE
  try {
    db.prepare("DELETE FROM memories_fts WHERE rowid = ?").run(rowid);
  } catch {
    // Fallback: try external content delete syntax for legacy tables
    try {
      db.prepare("INSERT INTO memories_fts(memories_fts, rowid, content, category) VALUES ('delete', ?, ?, ?)").run(
        rowid,
        tokenize(oldContent),
        oldCategory,
      );
    } catch {
      // Ignore - FTS entry may not exist
    }
  }
}

function syncFtsUpdate(db: Database.Database, id: string, newContent: string, newCategory: string): void {
  const row = db.prepare('SELECT rowid, content, category FROM memories WHERE id = ?').get(id) as any;
  if (!row) return;
  // Delete old entry, insert new
  syncFtsDelete(db, row.rowid, row.content, row.category);
  db.prepare('INSERT INTO memories_fts(rowid, content, category) VALUES (?, ?, ?)').run(
    row.rowid,
    tokenize(newContent),
    newCategory,
  );
}

export function getMemoryById(id: string): Memory | null {
  const db = getDb();
  return db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Memory | null;
}

export function listMemories(opts: {
  layer?: MemoryLayer;
  category?: MemoryCategory;
  agent_id?: string;
  pairing_code?: string | null;
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
  include_superseded?: boolean;
  has_versions?: boolean;
}): { items: Memory[]; total: number } {
  const db = getDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (opts.layer) { conditions.push('layer = ?'); params.push(opts.layer); }
  if (opts.category) { conditions.push('category = ?'); params.push(opts.category); }
  if (opts.agent_id) { conditions.push('(agent_id = ? OR agent_id IS NULL OR agent_id = \'\')'); params.push(opts.agent_id); }
  if (!opts.include_superseded) { conditions.push('superseded_by IS NULL'); }
  if (opts.has_versions) {
    // Memories that have been superseded OR that supersede others
    conditions.push('(superseded_by IS NOT NULL OR id IN (SELECT superseded_by FROM memories WHERE superseded_by IS NOT NULL))');
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderBy = opts.orderBy || 'created_at';
  const orderDir = opts.orderDir || 'desc';
  const limit = opts.limit || 50;
  const offset = opts.offset || 0;

  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM memories ${where}`).get(...params) as any).cnt;
  const items = db.prepare(
    `SELECT * FROM memories ${where} ORDER BY ${orderBy} ${orderDir} LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as Memory[];

  return { items, total };
}

export function updateMemory(id: string, updates: Partial<Pick<Memory, 'layer' | 'category' | 'content' | 'importance' | 'confidence' | 'decay_score' | 'expires_at' | 'superseded_by' | 'metadata' | 'is_pinned' | 'source'>>): Memory | null {
  const db = getDb();
  const sets: string[] = [];
  const params: any[] = [];

  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) {
      sets.push(`${key} = ?`);
      params.push(val);
    }
  }

  if (sets.length === 0) return getMemoryById(id);

  // Snapshot old content/category for FTS sync
  const old = db.prepare('SELECT rowid, content, category FROM memories WHERE id = ?').get(id) as any;

  sets.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);

  db.prepare(`UPDATE memories SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  // Sync FTS if content or category changed
  if (old && (updates.content || updates.category)) {
    syncFtsDelete(db, old.rowid, old.content, old.category);
    const updated = db.prepare('SELECT content, category FROM memories WHERE id = ?').get(id) as any;
    if (updated) {
      db.prepare('INSERT INTO memories_fts(rowid, content, category) VALUES (?, ?, ?)').run(
        old.rowid,
        tokenize(updated.content),
        updated.category,
      );
    }
  }

  return getMemoryById(id);
}

export function deleteMemory(id: string): boolean {
  const db = getDb();

  // Snapshot for FTS sync before delete
  const old = db.prepare('SELECT rowid, content, category FROM memories WHERE id = ?').get(id) as any;

  // Clean up FK references before deleting the memory
  db.prepare('DELETE FROM access_log WHERE memory_id = ?').run(id);
  db.prepare('DELETE FROM relation_evidence WHERE memory_id = ?').run(id);
  db.prepare('UPDATE relations SET source_memory_id = NULL WHERE source_memory_id = ?').run(id);
  // Clear superseded_by references pointing to this memory
  db.prepare('UPDATE memories SET superseded_by = NULL WHERE superseded_by = ?').run(id);
  const result = db.prepare('DELETE FROM memories WHERE id = ?').run(id);

  // Sync FTS
  if (old && result.changes > 0) {
    syncFtsDelete(db, old.rowid, old.content, old.category);
  }

  return result.changes > 0;
}

export function bumpAccessCount(memoryIds: string[], query?: string): void {
  const db = getDb();
  const now = new Date().toISOString();

  const updateStmt = db.prepare(
    'UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?'
  );
  const logStmt = db.prepare(
    'INSERT INTO access_log (memory_id, query, rank, accessed_at) VALUES (?, ?, ?, ?)'
  );

  const tx = db.transaction(() => {
    for (let i = 0; i < memoryIds.length; i++) {
      updateStmt.run(now, memoryIds[i]);
      logStmt.run(memoryIds[i], query || null, i + 1, now);
    }
  });
  tx();
}

// ============ FTS5 Search ============

/**
 * Sanitize a query string for FTS5 MATCH.
 * Strips all FTS5 operators and special characters that could cause syntax errors.
 * With trigram tokenizer, bare terms are implicitly ANDed.
 */
function sanitizeFTSQuery(query: string): string {
  const cleaned = query
    // Strip FTS5 special characters that cause syntax errors (ASCII)
    .replace(/["\*\(\)\{\}\[\]\+\~\^\:\;\!\?\<\>\=\&\|\\\/@#\$%`',._-]/g, ' ')
    // Strip CJK and fullwidth punctuation (Chinese/Japanese commas, periods, quotes, brackets, etc.)
    .replace(/[\u3000-\u303F\uFF00-\uFF60\u2000-\u206F\u2E00-\u2E7F\u00A0-\u00BF\u2018-\u201F\u2026\u2014\u2013]/g, ' ')
    // Strip FTS5 boolean keywords (case-insensitive, whole words only)
    .replace(/\b(AND|OR|NOT|NEAR)\b/gi, ' ')
    // Strip leading hyphens from words (FTS5 NOT operator)
    .replace(/(?:^|\s)-+(\w)/g, ' $1')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || cleaned.length < 2) return '';

  // Truncate to reasonable length (avoid huge queries from metadata)
  return cleaned.slice(0, 500);
}

export function searchFTS(query: string, opts?: { layer?: MemoryLayer; limit?: number; agent_id?: string; pairing_code?: string | null }): (Memory & { rank: number })[] {
  // Tokenize query with jieba for CJK word matching
  const sanitized = sanitizeFTSQuery(tokenizeQuery(query));
  if (!sanitized) return [];

  const db = getDb();
  const conditions = ['memories_fts MATCH ?'];
  const params: any[] = [sanitized];

  if (opts?.layer) { conditions.push('m.layer = ?'); params.push(opts.layer); }
  // agent_id filter: null/empty agent_id memories are shared (match any agent)
  if (opts?.agent_id) { conditions.push('(m.agent_id = ? OR m.agent_id IS NULL OR m.agent_id = \'\')'); params.push(opts.agent_id); }

  conditions.push('(m.expires_at IS NULL OR m.expires_at > ?)');
  params.push(new Date().toISOString());
  conditions.push('m.superseded_by IS NULL');

  const limit = opts?.limit || 20;

  const sql = `
    SELECT m.*, fts.rank
    FROM memories m
    JOIN memories_fts fts ON fts.rowid = m.rowid
    WHERE ${conditions.join(' AND ')}
    ORDER BY fts.rank
    LIMIT ?
  `;

  return db.prepare(sql).all(...params, limit) as (Memory & { rank: number })[];
}

// ============ Relations ============

export function insertRelation(rel: Omit<Relation, 'id' | 'created_at' | 'updated_at'>): Relation {
  const db = getDb();
  const id = generateId();
  const now = new Date().toISOString();
  const subject = normalizeEntity(rel.subject);
  const predicate = normalizeEntity(rel.predicate);
  const object = normalizeEntity(rel.object);

  db.prepare(`
    INSERT INTO relations (id, subject, predicate, object, confidence, source_memory_id, agent_id, source, extraction_count, expired, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, subject, predicate, object, rel.confidence, rel.source_memory_id || null, rel.agent_id || 'default', rel.source || 'manual', rel.extraction_count ?? 1, rel.expired ?? 0, now, now);

  return db.prepare('SELECT * FROM relations WHERE id = ?').get(id) as Relation;
}

export function upsertRelation(rel: Omit<Relation, 'id' | 'created_at' | 'updated_at' | 'extraction_count'> & { extraction_count?: number }): Relation & { action: 'created' | 'updated' } {
  const db = getDb();
  const agentId = rel.agent_id || 'default';
  const now = new Date().toISOString();
  const subject = normalizeEntity(rel.subject);
  const predicate = normalizeEntity(rel.predicate);
  const object = normalizeEntity(rel.object);

  // Check for existing relation with same normalized subject+predicate+object+agent_id
  const existing = db.prepare(
    'SELECT * FROM relations WHERE subject = ? AND predicate = ? AND object = ? AND agent_id = ?'
  ).get(subject, predicate, object, agentId) as Relation | undefined;

  if (existing) {
    // EMA confidence update: new = 0.3 * incoming + 0.7 * existing
    const newConfidence = 0.3 * rel.confidence + 0.7 * existing.confidence;
    const expired = rel.expired ?? existing.expired;
    db.prepare(
      'UPDATE relations SET confidence = ?, source_memory_id = COALESCE(?, source_memory_id), source = ?, extraction_count = extraction_count + 1, expired = ?, updated_at = ? WHERE id = ?'
    ).run(newConfidence, rel.source_memory_id || null, rel.source || existing.source, expired, now, existing.id);

    // Record evidence
    db.prepare(
      'INSERT INTO relation_evidence (relation_id, memory_id, source, confidence) VALUES (?, ?, ?, ?)'
    ).run(existing.id, rel.source_memory_id || null, rel.source || 'manual', rel.confidence);

    const updated = db.prepare('SELECT * FROM relations WHERE id = ?').get(existing.id) as Relation;
    return { ...updated, action: 'updated' };
  }

  // Insert new with normalized entity names
  const id = generateId();
  const expired = rel.expired ?? 0;
  db.prepare(`
    INSERT INTO relations (id, subject, predicate, object, confidence, source_memory_id, agent_id, source, extraction_count, expired, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, subject, predicate, object, rel.confidence, rel.source_memory_id || null, agentId, rel.source || 'manual', 1, expired, now, now);

  // Record initial evidence
  db.prepare(
    'INSERT INTO relation_evidence (relation_id, memory_id, source, confidence) VALUES (?, ?, ?, ?)'
  ).run(id, rel.source_memory_id || null, rel.source || 'manual', rel.confidence);

  const created = db.prepare('SELECT * FROM relations WHERE id = ?').get(id) as Relation;
  return { ...created, action: 'created' };
}

export function listRelations(opts?: { subject?: string; object?: string; agent_id?: string; limit?: number; include_expired?: boolean }): Relation[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (opts?.subject) { conditions.push('subject = ?'); params.push(normalizeEntity(opts.subject)); }
  if (opts?.object) { conditions.push('object = ?'); params.push(normalizeEntity(opts.object)); }
  if (opts?.agent_id) { conditions.push('agent_id = ?'); params.push(opts.agent_id); }
  if (!opts?.include_expired) { conditions.push('expired = 0'); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM relations ${where} ORDER BY updated_at DESC LIMIT ?`).all(...params, opts?.limit || 100) as Relation[];
}

export function findRelatedRelations(entities: string[], agentId?: string): Relation[] {
  if (entities.length === 0) return [];
  const db = getDb();

  const normalized = [...new Set(entities.map(e => normalizeEntity(e)).filter(e => e.length >= 2))];
  if (normalized.length === 0) return [];

  const conditions: string[] = ['expired = 0'];
  const params: any[] = [];

  if (agentId) {
    conditions.push('agent_id = ?');
    params.push(agentId);
  }

  const likeClauses = normalized.map(() => '(subject LIKE ? ESCAPE \'\\\' OR object LIKE ? ESCAPE \'\\\')');
  conditions.push(`(${likeClauses.join(' OR ')})`);
  for (const e of normalized) {
    const escaped = escapeLikePattern(e);
    params.push(`%${escaped}%`, `%${escaped}%`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  return db.prepare(
    `SELECT * FROM relations ${where} ORDER BY confidence DESC LIMIT 10`
  ).all(...params) as Relation[];
}

export function getRelationEvidence(relationId: string): RelationEvidence[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM relation_evidence WHERE relation_id = ? ORDER BY created_at DESC'
  ).all(relationId) as RelationEvidence[];
}

export function deleteRelation(id: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM relations WHERE id = ?').run(id).changes > 0;
}

// ============ Lifecycle Log ============

export function insertLifecycleLog(action: string, memoryIds: string[], details?: Record<string, any>): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO lifecycle_log (action, memory_ids, details) VALUES (?, ?, ?)'
  ).run(action, JSON.stringify(memoryIds), details ? JSON.stringify(details) : null);
}

export function getLifecycleLogs(limit = 50, offset = 0): LifecycleLogEntry[] {
  const db = getDb();
  return db.prepare('SELECT * FROM lifecycle_log ORDER BY executed_at DESC LIMIT ? OFFSET ?').all(limit, offset) as LifecycleLogEntry[];
}

export function countLifecycleLogs(): number {
  const db = getDb();
  return (db.prepare('SELECT COUNT(*) as c FROM lifecycle_log').get() as any).c;
}

// ============ Version Chain ============

/**
 * Get the full version chain for a memory.
 * Walks backward (via superseded_by) to find the oldest ancestor,
 * then walks forward to build the complete chain (old → new).
 * Returns at most 50 entries.
 */
export function getMemoryVersionChain(id: string): Memory[] {
  const db = getDb();
  const MAX_CHAIN = 50;

  // Start from the given memory
  const origin = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Memory | null;
  if (!origin) return [];

  // Walk backward: find ancestors where superseded_by points to us
  const visited = new Set<string>([origin.id]);
  const ancestors: Memory[] = [];
  let currentId = origin.id;

  while (ancestors.length < MAX_CHAIN) {
    const parent = db.prepare('SELECT * FROM memories WHERE superseded_by = ?').get(currentId) as Memory | null;
    if (!parent || visited.has(parent.id)) break;
    visited.add(parent.id);
    ancestors.unshift(parent);
    currentId = parent.id;
  }

  // Walk forward from origin via superseded_by
  const descendants: Memory[] = [];
  currentId = origin.superseded_by as string;

  while (currentId && descendants.length < MAX_CHAIN) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const next = db.prepare('SELECT * FROM memories WHERE id = ?').get(currentId) as Memory | null;
    if (!next) break;
    descendants.push(next);
    currentId = next.superseded_by as string;
  }

  // Build chain: ancestors + origin + descendants (old → new)
  const chain = [...ancestors, origin, ...descendants];
  return chain.slice(0, MAX_CHAIN);
}

// ============ Stats ============

export function getStats(agentId?: string): Record<string, any> {
  const db = getDb();
  const agentFilter = agentId ? ' WHERE agent_id = ?' : '';
  const params = agentId ? [agentId] : [];

  const totalMemories = (db.prepare(`SELECT COUNT(*) as cnt FROM memories${agentFilter}`).get(...params) as any).cnt;

  const layerCounts = db.prepare(
    `SELECT layer, COUNT(*) as cnt FROM memories${agentFilter} GROUP BY layer`
  ).all(...params) as { layer: string; cnt: number }[];

  const categoryCounts = db.prepare(
    `SELECT category, COUNT(*) as cnt FROM memories${agentFilter} GROUP BY category`
  ).all(...params) as { category: string; cnt: number }[];

  const totalRelations = (db.prepare('SELECT COUNT(*) as cnt FROM relations').get() as any).cnt;
  const totalAccessLogs = (db.prepare('SELECT COUNT(*) as cnt FROM access_log').get() as any).cnt;

  return {
    total_memories: totalMemories,
    layers: Object.fromEntries(layerCounts.map(r => [r.layer, r.cnt])),
    categories: Object.fromEntries(categoryCounts.map(r => [r.category, r.cnt])),
    total_relations: totalRelations,
    total_access_logs: totalAccessLogs,
  };
}

// ── Extraction Feedback ──

export interface ExtractionFeedback {
  id: string;
  memory_id: string;
  agent_id: string;
  feedback: 'good' | 'bad' | 'corrected';
  original_content: string | null;
  corrected_content: string | null;
  category: string | null;
  source_channel: string | null;
  created_at: string;
}

export function insertExtractionFeedback(fb: {
  memory_id: string;
  agent_id?: string;
  feedback: 'good' | 'bad' | 'corrected';
  original_content?: string;
  corrected_content?: string;
  category?: string;
  source_channel?: string;
}): ExtractionFeedback {
  const db = getDb();
  const id = generateId();
  db.prepare(`
    INSERT INTO extraction_feedback (id, memory_id, agent_id, feedback, original_content, corrected_content, category, source_channel)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, fb.memory_id, fb.agent_id || 'default', fb.feedback, fb.original_content || null, fb.corrected_content || null, fb.category || null, fb.source_channel || null);

  return db.prepare('SELECT * FROM extraction_feedback WHERE id = ?').get(id) as ExtractionFeedback;
}

export function getExtractionFeedbackStats(agentId?: string): {
  total: number;
  good: number;
  bad: number;
  corrected: number;
  accuracy_rate: number;
} {
  const db = getDb();
  const filter = agentId ? ' WHERE agent_id = ?' : '';
  const params = agentId ? [agentId] : [];

  const rows = db.prepare(
    `SELECT feedback, COUNT(*) as cnt FROM extraction_feedback${filter} GROUP BY feedback`
  ).all(...params) as { feedback: string; cnt: number }[];

  const counts = { good: 0, bad: 0, corrected: 0 };
  for (const r of rows) {
    if (r.feedback in counts) (counts as any)[r.feedback] = r.cnt;
  }
  const total = counts.good + counts.bad + counts.corrected;
  const accuracy_rate = total > 0 ? counts.good / total : 1;

  return { total, ...counts, accuracy_rate };
}

/**
 * Get per-category feedback bad rate for dynamic importance adjustment.
 * Only considers feedback from the last 30 days.
 */
export function getCategoryFeedbackStats(agentId: string): Record<string, { total: number; badRate: number }> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT category, COUNT(*) as total,
           SUM(CASE WHEN feedback = 'bad' THEN 1 ELSE 0 END) as bad_count
    FROM extraction_feedback
    WHERE agent_id = ? AND category IS NOT NULL
      AND created_at > ?
    GROUP BY category
  `).all(agentId, new Date(Date.now() - 30 * 86400_000).toISOString()) as { category: string; total: number; bad_count: number }[];

  const stats: Record<string, { total: number; badRate: number }> = {};
  for (const row of rows) {
    stats[row.category] = {
      total: row.total,
      badRate: row.total > 0 ? row.bad_count / row.total : 0,
    };
  }
  return stats;
}

// ── Memory Feedback (Self-Improvement) ──

export type FeedbackSignal = 'helpful' | 'not_helpful' | 'outdated' | 'wrong';
export type FeedbackSource = 'explicit' | 'implicit';

export interface MemoryFeedback {
  id: string;
  memory_id: string;
  agent_id: string;
  recall_id: string | null;
  signal: FeedbackSignal;
  comment: string | null;
  source: FeedbackSource;
  created_at: string;
}

export interface ImportanceAdjustment {
  id: string;
  memory_id: string;
  agent_id: string;
  old_importance: number;
  new_importance: number;
  delta: number;
  reason: string;
  feedback_ids: string | null;
  created_at: string;
}

export function insertMemoryFeedback(fb: {
  memory_id: string;
  agent_id?: string;
  recall_id?: string;
  signal: FeedbackSignal;
  comment?: string;
  source?: FeedbackSource;
}): MemoryFeedback {
  const db = getDb();
  const id = generateId();
  db.prepare(`
    INSERT INTO memory_feedback (id, memory_id, agent_id, recall_id, signal, comment, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, fb.memory_id, fb.agent_id || 'default', fb.recall_id || null, fb.signal, fb.comment || null, fb.source || 'explicit');

  return db.prepare('SELECT * FROM memory_feedback WHERE id = ?').get(id) as MemoryFeedback;
}

export function getMemoryFeedbacks(memoryId: string, opts?: { limit?: number; offset?: number }): { items: MemoryFeedback[]; total: number } {
  const db = getDb();
  const limit = opts?.limit || 50;
  const offset = opts?.offset || 0;

  const total = (db.prepare('SELECT COUNT(*) as cnt FROM memory_feedback WHERE memory_id = ?').get(memoryId) as any).cnt;
  const items = db.prepare(
    'SELECT * FROM memory_feedback WHERE memory_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(memoryId, limit, offset) as MemoryFeedback[];

  return { items, total };
}

export function getMemoryFeedbackStats(memoryId: string): {
  total: number;
  helpful: number;
  not_helpful: number;
  outdated: number;
  wrong: number;
  helpfulness_rate: number;
} {
  const db = getDb();
  const rows = db.prepare(
    'SELECT signal, COUNT(*) as cnt FROM memory_feedback WHERE memory_id = ? GROUP BY signal'
  ).all(memoryId) as { signal: string; cnt: number }[];

  const counts = { helpful: 0, not_helpful: 0, outdated: 0, wrong: 0 };
  for (const r of rows) {
    if (r.signal in counts) (counts as any)[r.signal] = r.cnt;
  }
  const total = counts.helpful + counts.not_helpful + counts.outdated + counts.wrong;
  const helpfulness_rate = total > 0 ? counts.helpful / total : 1;

  return { total, ...counts, helpfulness_rate };
}

export function insertImportanceAdjustment(adj: {
  memory_id: string;
  agent_id?: string;
  old_importance: number;
  new_importance: number;
  delta: number;
  reason: string;
  feedback_ids?: string[];
}): ImportanceAdjustment {
  const db = getDb();
  const id = generateId();
  db.prepare(`
    INSERT INTO importance_adjustments (id, memory_id, agent_id, old_importance, new_importance, delta, reason, feedback_ids)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, adj.memory_id, adj.agent_id || 'default', adj.old_importance, adj.new_importance, adj.delta, adj.reason, adj.feedback_ids ? JSON.stringify(adj.feedback_ids) : null);

  return db.prepare('SELECT * FROM importance_adjustments WHERE id = ?').get(id) as ImportanceAdjustment;
}

export function getImportanceAdjustments(memoryId: string, opts?: { limit?: number }): ImportanceAdjustment[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM importance_adjustments WHERE memory_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(memoryId, opts?.limit || 50) as ImportanceAdjustment[];
}

export function getRecentAdjustments(opts?: { agent_id?: string; limit?: number; since?: string }): ImportanceAdjustment[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (opts?.agent_id) { conditions.push('agent_id = ?'); params.push(opts.agent_id); }
  if (opts?.since) { conditions.push('created_at > ?'); params.push(opts.since); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(
    `SELECT * FROM importance_adjustments ${where} ORDER BY created_at DESC LIMIT ?`
  ).all(...params, opts?.limit || 100) as ImportanceAdjustment[];
}

/**
 * Get memories that have enough feedback to potentially warrant an importance adjustment.
 * Returns memories with at least `minFeedbacks` feedback entries within `windowDays`.
 */
export function getMemoriesNeedingAdjustment(opts: {
  agent_id?: string;
  minFeedbacks: number;
  windowDays: number;
}): { memory_id: string; agent_id: string; helpful: number; not_helpful: number; outdated: number; wrong: number; total: number }[] {
  const db = getDb();
  const cutoff = new Date(Date.now() - opts.windowDays * 86400_000).toISOString();
  const conditions = ['mf.created_at > ?'];
  const params: any[] = [cutoff];

  if (opts.agent_id) { conditions.push('mf.agent_id = ?'); params.push(opts.agent_id); }

  const where = conditions.join(' AND ');
  return db.prepare(`
    SELECT
      mf.memory_id,
      mf.agent_id,
      SUM(CASE WHEN mf.signal = 'helpful' THEN 1 ELSE 0 END) as helpful,
      SUM(CASE WHEN mf.signal = 'not_helpful' THEN 1 ELSE 0 END) as not_helpful,
      SUM(CASE WHEN mf.signal = 'outdated' THEN 1 ELSE 0 END) as outdated,
      SUM(CASE WHEN mf.signal = 'wrong' THEN 1 ELSE 0 END) as wrong,
      COUNT(*) as total
    FROM memory_feedback mf
    JOIN memories m ON m.id = mf.memory_id AND m.superseded_by IS NULL
    WHERE ${where}
    GROUP BY mf.memory_id, mf.agent_id
    HAVING COUNT(*) >= ?
  `).all(...params, opts.minFeedbacks) as any[];
}

/**
 * Get a high-level overview of feedback across all memories for an agent.
 */
export function getFeedbackOverview(agentId?: string): {
  total_feedbacks: number;
  total_memories_with_feedback: number;
  signal_distribution: Record<string, number>;
  recent_adjustments: number;
  avg_delta: number;
} {
  const db = getDb();
  const agentFilter = agentId ? ' WHERE agent_id = ?' : '';
  const params = agentId ? [agentId] : [];

  const totalFeedbacks = (db.prepare(`SELECT COUNT(*) as cnt FROM memory_feedback${agentFilter}`).get(...params) as any).cnt;
  const totalMemories = (db.prepare(`SELECT COUNT(DISTINCT memory_id) as cnt FROM memory_feedback${agentFilter}`).get(...params) as any).cnt;

  const signals = db.prepare(
    `SELECT signal, COUNT(*) as cnt FROM memory_feedback${agentFilter} GROUP BY signal`
  ).all(...params) as { signal: string; cnt: number }[];
  const signal_distribution: Record<string, number> = {};
  for (const s of signals) { signal_distribution[s.signal] = s.cnt; }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
  const adjFilter = agentId ? ' WHERE agent_id = ? AND created_at > ?' : ' WHERE created_at > ?';
  const adjParams = agentId ? [agentId, thirtyDaysAgo] : [thirtyDaysAgo];
  const adjStats = db.prepare(
    `SELECT COUNT(*) as cnt, COALESCE(AVG(ABS(delta)), 0) as avg_delta FROM importance_adjustments${adjFilter}`
  ).get(...adjParams) as any;

  return {
    total_feedbacks: totalFeedbacks,
    total_memories_with_feedback: totalMemories,
    signal_distribution,
    recent_adjustments: adjStats.cnt,
    avg_delta: adjStats.avg_delta,
  };
}
