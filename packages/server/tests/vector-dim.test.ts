import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDatabase, closeDatabase, getDb } from '../src/db/index.js';
import { loadConfig } from '../src/utils/config.js';
import { SqliteVecBackend } from '../src/vector/sqlite-vec.js';

/**
 * Regression test for #21: switching embedding models with a different vector
 * dimension (e.g. default 1536 -> bge-m3 1024) must rebuild the vec0 table.
 * Previously the dimension check read a non-existent `dimensions` key from the
 * vec0 `_info` shadow table, so the table was never rebuilt and all subsequent
 * upserts/searches failed with a dimension mismatch.
 */
describe('SqliteVecBackend dimension change', () => {
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

  function declaredDim(): number | null {
    const row = getDb().prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memories_vec'"
    ).get() as { sql?: string } | undefined;
    if (!row?.sql) return null;
    const m = row.sql.match(/FLOAT\s*\[\s*(\d+)\s*\]/i);
    return m ? Number(m[1]) : null;
  }

  it('rebuilds the vec0 table when dimensions change and keeps search working', async () => {
    const backend = new SqliteVecBackend();

    // Initial dimension: 8
    await backend.initialize(8);
    // Skip if the native extension is unavailable in this environment (fallback table).
    const usingVec0 = declaredDim() !== null;
    if (!usingVec0) return;

    expect(declaredDim()).toBe(8);
    await backend.upsert('a', new Array(8).fill(0.1));
    expect(await backend.count()).toBe(1);

    // Switch to a different dimension (simulates changing embedding model).
    await backend.initialize(4);
    expect(declaredDim()).toBe(4);
    // Old vectors are gone after rebuild — must be a clean 4-dim table.
    expect(await backend.count()).toBe(0);

    // New-dimension upsert + search must succeed (would throw on a stale 8-dim table).
    await backend.upsert('b', [0.1, 0.2, 0.3, 0.4]);
    const results = await backend.search([0.1, 0.2, 0.3, 0.4], 5);
    expect(results.map(r => r.id)).toContain('b');
  });
});
