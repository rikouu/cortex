import type { FastifyInstance } from 'fastify';
import type { CortexApp } from '../app.js';
import { getDb } from '../db/connection.js';
import { insertMemory, type Memory, type MemoryLayer, type MemoryCategory } from '../db/queries.js';
import { createLogger } from '../utils/logger.js';
import fs from 'node:fs';
import path from 'node:path';

const log = createLogger('import-export');

const VALID_LAYERS = new Set(['working', 'core', 'archive']);
const VALID_CATEGORIES = new Set(['identity', 'preference', 'decision', 'fact', 'entity', 'correction', 'todo', 'context', 'summary']);

export function registerImportExportRoutes(app: FastifyInstance, cortex: CortexApp): void {
  // ============ EXPORT ============
  app.post('/api/v1/export', async (req, reply) => {
    const { format = 'json' } = req.body as { format?: string };

    switch (format) {
      case 'json': {
        const db = getDb();
        const memories = db.prepare('SELECT * FROM memories ORDER BY created_at DESC').all();
        const relations = db.prepare('SELECT * FROM relations ORDER BY created_at DESC').all();
        const stats = {
          exported_at: new Date().toISOString(),
          total_memories: memories.length,
          total_relations: (relations as any[]).length,
        };
        return { ...stats, memories, relations };
      }

      case 'markdown': {
        await cortex.exporter.exportAll();
        return { status: 'ok', message: 'Markdown files exported successfully' };
      }

      case 'sqlite': {
        const config = cortex['config' as any] || {};
        const dbPath = (config as any)?.storage?.dbPath;
        if (!dbPath || dbPath === ':memory:') {
          reply.code(400);
          return { error: 'Cannot export in-memory database as SQLite dump' };
        }

        // Return the db file path for download
        if (!fs.existsSync(dbPath)) {
          reply.code(404);
          return { error: 'Database file not found' };
        }

        const buffer = fs.readFileSync(dbPath);
        reply.header('Content-Type', 'application/x-sqlite3');
        reply.header('Content-Disposition', `attachment; filename="cortex-${new Date().toISOString().slice(0, 10)}.db"`);
        return reply.send(buffer);
      }

      default:
        reply.code(400);
        return { error: `Unknown format: ${format}. Supported: json, markdown, sqlite` };
    }
  });

  // ============ IMPORT ============
  app.post('/api/v1/import', async (req, reply) => {
    const body = req.body as any;
    const format = body.format || 'json';

    try {
      switch (format) {
        case 'json': {
          const memories = body.memories as any[];
          if (!Array.isArray(memories)) {
            reply.code(400);
            return { error: 'Missing "memories" array in request body' };
          }

          let imported = 0;
          let skipped = 0;
          for (const m of memories) {
            if (!m.content || !VALID_LAYERS.has(m.layer) || !VALID_CATEGORIES.has(m.category)) {
              skipped++;
              continue;
            }
            try {
              insertMemory({
                layer: m.layer as MemoryLayer,
                category: m.category as MemoryCategory,
                content: m.content,
                importance: m.importance ?? 0.5,
                confidence: m.confidence ?? 0.8,
                agent_id: m.agent_id || 'default',
                source: m.source || 'import',
                metadata: m.metadata ? (typeof m.metadata === 'string' ? m.metadata : JSON.stringify(m.metadata)) : null,
              });
              imported++;
            } catch (e: any) {
              log.warn({ error: e.message }, 'Failed to import memory');
              skipped++;
            }
          }

          reply.code(201);
          return { status: 'ok', imported, skipped, total: memories.length };
        }

        case 'memory_md': {
          const content = body.content as string;
          if (!content) {
            reply.code(400);
            return { error: 'Missing "content" field with MEMORY.md text' };
          }

          const { imported, skipped } = importFromMemoryMd(content);
          reply.code(201);
          return { status: 'ok', imported, skipped, format: 'memory_md' };
        }

        default:
          reply.code(400);
          return { error: `Unknown format: ${format}. Supported: json, memory_md` };
      }
    } catch (e: any) {
      log.error({ error: e.message }, 'Import failed');
      reply.code(500);
      return { error: e.message };
    }
  });
}

/**
 * Parse a MEMORY.md file and import its entries.
 * Expected format:
 *   ## Section Header
 *   - Entry text
 *   - Another entry
 */
function importFromMemoryMd(content: string): { imported: number; skipped: number } {
  const lines = content.split('\n');
  let currentCategory: MemoryCategory = 'fact';
  let imported = 0;
  let skipped = 0;

  // Category mapping from common section headers
  const categoryMap: Record<string, MemoryCategory> = {
    'profile': 'identity',
    'identity': 'identity',
    'user': 'identity',
    'about': 'identity',
    'preference': 'preference',
    'preferences': 'preference',
    'habit': 'preference',
    'decision': 'decision',
    'decisions': 'decision',
    'fact': 'fact',
    'facts': 'fact',
    'entity': 'entity',
    'entities': 'entity',
    'correction': 'correction',
    'corrections': 'correction',
    'todo': 'todo',
    'reminder': 'todo',
    'reminders': 'todo',
    'task': 'todo',
    'tasks': 'todo',
    'summary': 'summary',
    'context': 'context',
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Section header
    if (trimmed.startsWith('## ') || trimmed.startsWith('### ')) {
      const header = trimmed.replace(/^#+\s*/, '').toLowerCase();
      for (const [key, cat] of Object.entries(categoryMap)) {
        if (header.includes(key)) {
          currentCategory = cat;
          break;
        }
      }
      continue;
    }

    // Bullet entries
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const entryContent = trimmed.slice(2).trim();
      if (entryContent.length < 3) {
        skipped++;
        continue;
      }

      try {
        insertMemory({
          layer: 'core',
          category: currentCategory,
          content: entryContent,
          importance: 0.7,
          confidence: 0.7,
          agent_id: 'default',
          source: 'import:memory_md',
        });
        imported++;
      } catch (e: any) {
        skipped++;
      }
    }
  }

  return { imported, skipped };
}
