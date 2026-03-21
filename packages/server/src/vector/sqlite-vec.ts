import { getDb } from '../db/connection.js';
import { createLogger } from '../utils/logger.js';
import type { VectorBackend, VectorSearchResult, VectorFilter } from './interface.js';
import { createRequire } from 'node:module';

const log = createLogger('sqlite-vec');
const require = createRequire(import.meta.url);

/**
 * SQLite vec0 vector backend — zero external dependencies.
 * Falls back to a simple JS cosine similarity search if vec0 extension not available.
 */
export class SqliteVecBackend implements VectorBackend {
  readonly name = 'sqlite-vec';
  private dimensions = 1536;
  private useVec0 = false;

  async initialize(dimensions: number): Promise<void> {
    this.dimensions = dimensions;
    const db = getDb();

    // Try loading sqlite-vec extension via npm package
    try {
      const sqliteVec = require('sqlite-vec');
      sqliteVec.load(db);
      this.useVec0 = true;
      log.info('sqlite-vec extension loaded via npm package');
    } catch (e1: any) {
      // Fallback: try bare loadExtension('vec0')
      try {
        db.loadExtension('vec0');
        this.useVec0 = true;
        log.info('sqlite-vec extension loaded from system path');
      } catch {
        log.warn('sqlite-vec extension not available, using fallback cosine similarity table');
        this.useVec0 = false;
      }
    }

    if (this.useVec0) {
      try {
        // Check if existing vec table has different dimensions — if so, rebuild it
        try {
          const info = db.prepare("SELECT * FROM memories_vec_info WHERE key = 'dimensions'").get() as any;
          if (info && Number(info.value) !== dimensions) {
            log.info({ old: Number(info.value), new: dimensions }, 'Embedding dimensions changed, rebuilding vec0 table');
            // Drop shadow tables first, then the virtual table
            for (const t of ['memories_vec_vector_chunks00', 'memories_vec_rowids', 'memories_vec_chunks', 'memories_vec_info']) {
              try { db.exec(`DROP TABLE IF EXISTS ${t}`); } catch { /* ignore */ }
            }
            try { db.exec('DROP TABLE IF EXISTS memories_vec'); } catch { /* vec0 virtual tables may need special handling */ }
          }
        } catch { /* table doesn't exist yet, that's fine */ }

        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(
            memory_id TEXT PRIMARY KEY,
            embedding FLOAT[${dimensions}]
          );
        `);
        log.info({ dimensions }, 'vec0 virtual table ready');
      } catch (e: any) {
        if (!e.message?.includes('already exists')) {
          log.warn({ error: e.message }, 'Failed to create vec0 table, using fallback');
          this.useVec0 = false;
        }
      }
    }

    if (!this.useVec0) {
      // Fallback: plain table with JSON blob for embeddings
      db.exec(`
        CREATE TABLE IF NOT EXISTS memories_vec_fallback (
          memory_id TEXT PRIMARY KEY,
          embedding TEXT NOT NULL,
          metadata TEXT
        );
      `);
      log.info('Using fallback vector table (cosine similarity in JS)');
    }
  }

  async upsert(id: string, embedding: number[], metadata?: Record<string, any>): Promise<void> {
    const db = getDb();

    if (this.useVec0) {
      // Delete existing then insert (vec0 doesn't support UPSERT)
      try {
        db.prepare('DELETE FROM memories_vec WHERE memory_id = ?').run(id);
        db.prepare('INSERT INTO memories_vec (memory_id, embedding) VALUES (?, ?)').run(
          id, JSON.stringify(embedding)
        );
      } catch (e: any) {
        log.error({ id, error: e.message }, 'vec0 upsert failed');
      }
    } else {
      db.prepare(`
        INSERT OR REPLACE INTO memories_vec_fallback (memory_id, embedding, metadata)
        VALUES (?, ?, ?)
      `).run(id, JSON.stringify(embedding), metadata ? JSON.stringify(metadata) : null);
    }
  }

  async search(query: number[], topK: number, filter?: VectorFilter): Promise<VectorSearchResult[]> {
    const db = getDb();

    if (this.useVec0) {
      try {
        if (filter?.agent_id) {
          // vec0 virtual table doesn't support WHERE on non-vector columns.
          // Over-fetch then filter by agent_id via batch lookup.
          const overFetch = topK * 5;
          const rows = db.prepare(`
            SELECT memory_id as id, distance
            FROM memories_vec
            WHERE embedding MATCH ?
            ORDER BY distance
            LIMIT ?
          `).all(JSON.stringify(query), overFetch) as VectorSearchResult[];

          const ids = rows.map(r => r.id);
          if (ids.length > 0) {
            const placeholders = ids.map(() => '?').join(',');
            const validIds = new Set(
              (db.prepare(
                `SELECT id FROM memories WHERE id IN (${placeholders}) AND (agent_id = ? OR agent_id IS NULL OR agent_id = '') AND superseded_by IS NULL`
              ).all(...ids, filter.agent_id) as { id: string }[]).map(r => r.id)
            );
            return rows.filter(r => validIds.has(r.id)).slice(0, topK);
          }
          return [];
        }

        const rows = db.prepare(`
          SELECT memory_id as id, distance
          FROM memories_vec
          WHERE embedding MATCH ?
          ORDER BY distance
          LIMIT ?
        `).all(JSON.stringify(query), topK) as VectorSearchResult[];
        return rows;
      } catch (e: any) {
        log.error({ error: e.message }, 'vec0 search failed, falling back');
      }
    }

    // Fallback: cosine similarity in JS with optional agent_id filter
    let sql = 'SELECT f.memory_id, f.embedding FROM memories_vec_fallback f';
    const params: any[] = [];
    if (filter?.agent_id) {
      sql += ' JOIN memories m ON m.id = f.memory_id WHERE (m.agent_id = ? OR m.agent_id IS NULL OR m.agent_id = \'\') AND m.superseded_by IS NULL';
      params.push(filter.agent_id);
    }
    const all = db.prepare(sql).all(...params) as {
      memory_id: string;
      embedding: string;
    }[];

    const results = all.map(row => {
      const emb = JSON.parse(row.embedding) as number[];
      const dist = 1 - cosineSimilarity(query, emb);
      return { id: row.memory_id, distance: dist };
    });

    results.sort((a, b) => a.distance - b.distance);
    return results.slice(0, topK);
  }

  async delete(ids: string[]): Promise<void> {
    const db = getDb();
    const table = this.useVec0 ? 'memories_vec' : 'memories_vec_fallback';
    const stmt = db.prepare(`DELETE FROM ${table} WHERE memory_id = ?`);
    const tx = db.transaction(() => {
      for (const id of ids) stmt.run(id);
    });
    tx();
  }

  async count(): Promise<number> {
    const db = getDb();
    const table = this.useVec0 ? 'memories_vec' : 'memories_vec_fallback';
    return (db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as any).cnt;
  }

  async close(): Promise<void> {
    // Nothing to close for SQLite-based backend
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}
