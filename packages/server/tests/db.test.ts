import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDatabase, closeDatabase, getDb } from '../src/db/index.js';
import { loadConfig } from '../src/utils/config.js';
import {
  insertMemory,
  getMemoryById,
  listMemories,
  updateMemory,
  deleteMemory,
  searchFTS,
  insertRelation,
  listRelations,
  deleteRelation,
  insertLifecycleLog,
  getLifecycleLogs,
  bumpAccessCount,
  getStats,
} from '../src/db/queries.js';

describe('Database', () => {
  beforeAll(() => {
    loadConfig({
      storage: { dbPath: ':memory:', walMode: false },
      llm: { extraction: { provider: 'none' }, lifecycle: { provider: 'none' } },
      embedding: { provider: 'none', dimensions: 4 },
      vectorBackend: { provider: 'sqlite-vec' },
      markdownExport: { enabled: false, exportMemoryMd: false, debounceMs: 999999 },
    });
    initDatabase(':memory:');
  });

  afterAll(() => {
    closeDatabase();
  });

  describe('initDatabase', () => {
    it('should create all required tables', () => {
      const db = getDb();
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      ).all().map((r: any) => r.name);

      expect(tables).toContain('memories');
      expect(tables).toContain('access_log');
      expect(tables).toContain('lifecycle_log');
      expect(tables).toContain('relations');
      expect(tables).toContain('_migrations');
    });

    it('should have applied the initial migration', () => {
      const db = getDb();
      const migrations = db.prepare('SELECT name FROM _migrations').all() as { name: string }[];
      expect(migrations.map(m => m.name)).toContain('001_initial_schema');
    });
  });

  describe('Memory CRUD', () => {
    let memId: string;

    it('should insert a memory', () => {
      const mem = insertMemory({
        layer: 'core',
        category: 'identity',
        content: 'User name is Harry',
        importance: 1.0,
        confidence: 0.9,
        agent_id: 'test',
      });

      expect(mem).toBeDefined();
      expect(mem.id).toBeTruthy();
      expect(mem.layer).toBe('core');
      expect(mem.category).toBe('identity');
      expect(mem.content).toBe('User name is Harry');
      expect(mem.importance).toBe(1.0);
      memId = mem.id;
    });

    it('should get memory by id', () => {
      const mem = getMemoryById(memId);
      expect(mem).toBeDefined();
      expect(mem!.content).toBe('User name is Harry');
    });

    it('should return null for non-existent id', () => {
      expect(getMemoryById('nonexistent')).toBeFalsy();
    });

    it('should list memories with filters', () => {
      insertMemory({ layer: 'working', category: 'context', content: 'some context', agent_id: 'test' });
      insertMemory({ layer: 'core', category: 'preference', content: 'likes coffee', agent_id: 'test' });

      const { items, total } = listMemories({ layer: 'core', agent_id: 'test' });
      expect(total).toBeGreaterThanOrEqual(2);
      items.forEach((m: any) => expect(m.layer).toBe('core'));
    });

    it('should update a memory', () => {
      const updated = updateMemory(memId, { content: 'User name is Harry (updated)', importance: 0.95 });
      expect(updated).toBeDefined();
      expect(updated!.content).toBe('User name is Harry (updated)');
      expect(updated!.importance).toBe(0.95);
    });

    it('should delete a memory', () => {
      const extra = insertMemory({ layer: 'archive', category: 'fact', content: 'to delete', agent_id: 'test' });
      expect(deleteMemory(extra.id)).toBe(true);
      expect(getMemoryById(extra.id)).toBeFalsy();
    });

    it('should return false when deleting non-existent', () => {
      expect(deleteMemory('nonexistent')).toBe(false);
    });
  });

  describe('FTS5 Search', () => {
    it('should find memories by content', () => {
      insertMemory({ layer: 'core', category: 'fact', content: 'Tokyo is the capital of Japan', agent_id: 'test' });
      const results = searchFTS('Tokyo Japan');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.content).toContain('Tokyo');
    });

    it('should filter by layer', () => {
      insertMemory({ layer: 'working', category: 'context', content: 'unique searchable text xyz123', agent_id: 'test' });
      const results = searchFTS('xyz123', { layer: 'core' });
      expect(results.length).toBe(0);
    });
  });

  describe('Relations', () => {
    it('should insert and list relations', () => {
      const rel = insertRelation({ subject: 'Harry', predicate: 'lives_in', object: 'Tokyo', confidence: 0.9, source_memory_id: null });
      expect(rel.id).toBeTruthy();

      const list = listRelations({ subject: 'Harry' });
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list.find(r => r.predicate === 'lives_in')).toBeDefined();
    });

    it('should delete relations', () => {
      const rel = insertRelation({ subject: 'Test', predicate: 'is', object: 'deletable', confidence: 0.5, source_memory_id: null });
      expect(deleteRelation(rel.id)).toBe(true);
      expect(deleteRelation(rel.id)).toBe(false);
    });
  });

  describe('Access Log & Bump', () => {
    it('should bump access count', () => {
      const mem = insertMemory({ layer: 'core', category: 'fact', content: 'access test', agent_id: 'test' });
      expect(mem.access_count).toBe(0);

      bumpAccessCount([mem.id], 'test query');
      const updated = getMemoryById(mem.id);
      expect(updated!.access_count).toBe(1);
      expect(updated!.last_accessed).toBeTruthy();
    });
  });

  describe('Lifecycle Log', () => {
    it('should insert and retrieve logs', () => {
      insertLifecycleLog('promote', ['mem1', 'mem2'], { reason: 'test' });
      const logs = getLifecycleLogs(10);
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0]!.action).toBe('promote');
    });
  });

  describe('Stats', () => {
    it('should return stats', () => {
      const stats = getStats();
      expect(stats.total_memories).toBeGreaterThan(0);
      expect(stats.layers).toBeDefined();
      expect(stats.categories).toBeDefined();
    });

    it('should filter stats by agent_id', () => {
      const stats = getStats('test');
      expect(stats.total_memories).toBeGreaterThan(0);
    });
  });
});
