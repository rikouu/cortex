import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDatabase, closeDatabase, insertMemory } from '../src/db/index.js';
import { loadConfig } from '../src/utils/config.js';
import { MarkdownExporter } from '../src/export/markdown.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('MarkdownExporter', () => {
  let exporter: MarkdownExporter;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-test-'));
    const dbPath = path.join(tmpDir, 'test.db');

    const config = loadConfig({
      storage: { dbPath, walMode: false },
      llm: { extraction: { provider: 'none' }, lifecycle: { provider: 'none' } },
      embedding: { provider: 'none', dimensions: 4 },
      vectorBackend: { provider: 'sqlite-vec' },
      markdownExport: { enabled: true, exportMemoryMd: true, debounceMs: 999999 },
    });
    initDatabase(dbPath);

    // Seed data
    insertMemory({ layer: 'core', category: 'identity', content: 'User name is Harry', agent_id: 'default', importance: 1.0 });
    insertMemory({ layer: 'core', category: 'preference', content: 'Prefers dark mode', agent_id: 'default', importance: 0.9 });
    insertMemory({ layer: 'core', category: 'fact', content: 'Tokyo is the capital of Japan', agent_id: 'default', importance: 0.7 });

    exporter = new MarkdownExporter(config);
  });

  afterAll(() => {
    closeDatabase();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should export core memories to markdown', async () => {
    await exporter.exportAll();

    const memoryMdPath = path.join(tmpDir, 'MEMORY.md');
    expect(fs.existsSync(memoryMdPath)).toBe(true);

    const content = fs.readFileSync(memoryMdPath, 'utf-8');
    expect(content).toContain('User name is Harry');
    expect(content).toContain('Prefers dark mode');
    expect(content).toContain('Tokyo is the capital of Japan');
  });

  it('should include frontmatter', async () => {
    await exporter.exportAll();

    const content = fs.readFileSync(path.join(tmpDir, 'MEMORY.md'), 'utf-8');
    expect(content).toContain('exported_at:');
    expect(content).toContain('total_entries:');
    expect(content).toContain('source: cortex SQLite');
  });

  it('should organize by category sections', async () => {
    await exporter.exportAll();

    const content = fs.readFileSync(path.join(tmpDir, 'MEMORY.md'), 'utf-8');
    expect(content).toContain('User Profile');
    expect(content).toContain('Preferences');
  });
});
