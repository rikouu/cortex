/**
 * Test setup — initializes an in-memory SQLite database for each test suite.
 */
import { initDatabase, closeDatabase } from '../src/db/index.js';
import { loadConfig } from '../src/utils/config.js';
import { beforeAll, afterAll } from 'vitest';

export function setupTestDb() {
  beforeAll(() => {
    loadConfig({
      storage: { dbPath: ':memory:', walMode: false },
      llm: {
        extraction: { provider: 'none' },
        lifecycle: { provider: 'none' },
      },
      embedding: { provider: 'none', dimensions: 4 },
      vectorBackend: { provider: 'sqlite-vec' },
      markdownExport: { enabled: false, exportMemoryMd: false, debounceMs: 999999 },
    });
    initDatabase(':memory:');
  });

  afterAll(() => {
    closeDatabase();
  });
}
