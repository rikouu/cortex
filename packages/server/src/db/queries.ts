import Database from 'better-sqlite3';
import { getDb } from './connection.js';
import { generateId } from '../utils/helpers.js';

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

export function insertMemory(mem: Partial<Memory> & { layer: MemoryLayer; category: MemoryCategory; content: string }): Memory {
  const db = getDb();
  const id = mem.id || generateId();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO memories (id, layer, category, content, source, agent_id, importance, confidence, decay_score, expires_at, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

  return getMemoryById(id)!;
}

export function getMemoryById(id: string): Memory | null {
  const db = getDb();
  return db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Memory | null;
}

export function listMemories(opts: {
  layer?: MemoryLayer;
  category?: MemoryCategory;
  agent_id?: string;
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
  include_superseded?: boolean;
}): { items: Memory[]; total: number } {
  const db = getDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (opts.layer) { conditions.push('layer = ?'); params.push(opts.layer); }
  if (opts.category) { conditions.push('category = ?'); params.push(opts.category); }
  if (opts.agent_id) { conditions.push('agent_id = ?'); params.push(opts.agent_id); }
  if (!opts.include_superseded) { conditions.push('superseded_by IS NULL'); }

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

export function updateMemory(id: string, updates: Partial<Pick<Memory, 'layer' | 'category' | 'content' | 'importance' | 'confidence' | 'decay_score' | 'expires_at' | 'superseded_by' | 'metadata' | 'is_pinned'>>): Memory | null {
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

  sets.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);

  db.prepare(`UPDATE memories SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getMemoryById(id);
}

export function deleteMemory(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM memories WHERE id = ?').run(id);
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

export function searchFTS(query: string, opts?: { layer?: MemoryLayer; limit?: number; agent_id?: string }): (Memory & { rank: number })[] {
  const sanitized = sanitizeFTSQuery(query);
  if (!sanitized) return [];

  const db = getDb();
  const conditions = ['memories_fts MATCH ?'];
  const params: any[] = [sanitized];

  if (opts?.layer) { conditions.push('m.layer = ?'); params.push(opts.layer); }
  if (opts?.agent_id) { conditions.push('m.agent_id = ?'); params.push(opts.agent_id); }

  conditions.push('(m.expires_at IS NULL OR m.expires_at > datetime(\'now\'))');
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

  db.prepare(`
    INSERT INTO relations (id, subject, predicate, object, confidence, source_memory_id, agent_id, source, extraction_count, expired, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, rel.subject, rel.predicate, rel.object, rel.confidence, rel.source_memory_id || null, rel.agent_id || 'default', rel.source || 'manual', rel.extraction_count ?? 1, rel.expired ?? 0, now, now);

  return db.prepare('SELECT * FROM relations WHERE id = ?').get(id) as Relation;
}

export function upsertRelation(rel: Omit<Relation, 'id' | 'created_at' | 'updated_at' | 'extraction_count'> & { extraction_count?: number }): Relation & { action: 'created' | 'updated' } {
  const db = getDb();
  const agentId = rel.agent_id || 'default';
  const now = new Date().toISOString();

  // Check for existing relation with same subject+predicate+object+agent_id
  const existing = db.prepare(
    'SELECT * FROM relations WHERE subject = ? AND predicate = ? AND object = ? AND agent_id = ?'
  ).get(rel.subject, rel.predicate, rel.object, agentId) as Relation | undefined;

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

  // Insert new
  const id = generateId();
  const expired = rel.expired ?? 0;
  db.prepare(`
    INSERT INTO relations (id, subject, predicate, object, confidence, source_memory_id, agent_id, source, extraction_count, expired, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, rel.subject, rel.predicate, rel.object, rel.confidence, rel.source_memory_id || null, agentId, rel.source || 'manual', 1, expired, now, now);

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

  if (opts?.subject) { conditions.push('subject = ?'); params.push(opts.subject); }
  if (opts?.object) { conditions.push('object = ?'); params.push(opts.object); }
  if (opts?.agent_id) { conditions.push('agent_id = ?'); params.push(opts.agent_id); }
  if (!opts?.include_expired) { conditions.push('expired = 0'); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM relations ${where} ORDER BY updated_at DESC LIMIT ?`).all(...params, opts?.limit || 100) as Relation[];
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

export function getLifecycleLogs(limit = 50): LifecycleLogEntry[] {
  const db = getDb();
  return db.prepare('SELECT * FROM lifecycle_log ORDER BY executed_at DESC LIMIT ?').all(limit) as LifecycleLogEntry[];
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
