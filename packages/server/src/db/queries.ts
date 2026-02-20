import Database from 'better-sqlite3';
import { getDb } from './connection.js';
import { generateId } from '../utils/helpers.js';

// ============ Memory Types ============

export type MemoryLayer = 'working' | 'core' | 'archive';
export type MemoryCategory =
  | 'identity' | 'preference' | 'decision' | 'fact' | 'entity'
  | 'correction' | 'todo' | 'context' | 'summary'
  // V2 新增
  | 'skill' | 'relationship' | 'goal' | 'insight' | 'project_state';

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
}

export interface Relation {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  source_memory_id: string | null;
  created_at: string;
  updated_at: string;
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
}): { items: Memory[]; total: number } {
  const db = getDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (opts.layer) { conditions.push('layer = ?'); params.push(opts.layer); }
  if (opts.category) { conditions.push('category = ?'); params.push(opts.category); }
  if (opts.agent_id) { conditions.push('agent_id = ?'); params.push(opts.agent_id); }

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

export function updateMemory(id: string, updates: Partial<Pick<Memory, 'layer' | 'category' | 'content' | 'importance' | 'confidence' | 'decay_score' | 'expires_at' | 'superseded_by' | 'metadata'>>): Memory | null {
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

export function searchFTS(query: string, opts?: { layer?: MemoryLayer; limit?: number; agent_id?: string }): (Memory & { rank: number })[] {
  const db = getDb();
  const conditions = ['memories_fts MATCH ?'];
  const params: any[] = [query];

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
    INSERT INTO relations (id, subject, predicate, object, confidence, source_memory_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, rel.subject, rel.predicate, rel.object, rel.confidence, rel.source_memory_id || null, now, now);

  return db.prepare('SELECT * FROM relations WHERE id = ?').get(id) as Relation;
}

export function listRelations(opts?: { subject?: string; object?: string; limit?: number }): Relation[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (opts?.subject) { conditions.push('subject = ?'); params.push(opts.subject); }
  if (opts?.object) { conditions.push('object = ?'); params.push(opts.object); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM relations ${where} LIMIT ?`).all(...params, opts?.limit || 100) as Relation[];
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
