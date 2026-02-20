import type { FastifyInstance } from 'fastify';
import type { CortexApp } from '../app.js';
import { getDb } from '../db/connection.js';
import { insertMemory, type Memory, type MemoryLayer, type MemoryCategory } from '../db/queries.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('import-export');

const VALID_LAYERS = new Set(['working', 'core', 'archive']);
const VALID_CATEGORIES = new Set(['identity', 'preference', 'decision', 'fact', 'entity', 'correction', 'todo', 'context', 'summary', 'skill', 'relationship', 'goal', 'insight', 'project_state', 'constraint', 'policy', 'agent_self_improvement', 'agent_user_habit', 'agent_relationship', 'agent_persona']);

const CATEGORY_LABELS: Record<string, string> = {
  identity: 'User Profile',
  preference: 'Preferences & Habits',
  decision: 'Key Decisions',
  fact: 'Facts',
  entity: 'Entities',
  correction: 'Corrections',
  todo: 'To-Do / Reminders',
  skill: 'Skills & Expertise',
  relationship: 'Relationships',
  goal: 'Goals & Plans',
  insight: 'Insights & Lessons',
  project_state: 'Project Status',
  context: 'Context',
  summary: 'Historical Memory Summary',
  constraint: 'Constraints',
  policy: 'Policies & Strategies',
  agent_self_improvement: 'Agent Self-Improvement',
  agent_user_habit: 'Agent User Observations',
  agent_relationship: 'Agent Relationship Dynamics',
  agent_persona: 'Agent Persona & Style',
};

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
        const db = getDb();
        const memories = db.prepare(
          "SELECT * FROM memories WHERE superseded_by IS NULL ORDER BY layer, category, importance DESC"
        ).all() as Memory[];

        const lines: string[] = [
          '# Cortex Memory Export',
          '',
          `> Exported at ${new Date().toISOString()}`,
          `> Total: ${memories.length} memories`,
          '',
        ];

        // Group by layer then category
        const grouped = new Map<string, Map<string, Memory[]>>();
        for (const m of memories) {
          if (!grouped.has(m.layer)) grouped.set(m.layer, new Map());
          const layerMap = grouped.get(m.layer)!;
          if (!layerMap.has(m.category)) layerMap.set(m.category, []);
          layerMap.get(m.category)!.push(m);
        }

        const layerOrder = ['core', 'working', 'archive'];
        for (const layer of layerOrder) {
          const categories = grouped.get(layer);
          if (!categories || categories.size === 0) continue;
          lines.push(`## ${layer.charAt(0).toUpperCase() + layer.slice(1)} Layer`);
          lines.push('');
          for (const [category, mems] of categories) {
            lines.push(`### ${CATEGORY_LABELS[category] || category}`);
            lines.push('');
            for (const m of mems) {
              lines.push(`- ${m.content}`);
            }
            lines.push('');
          }
        }

        // Also trigger disk export if enabled
        cortex.exporter.exportAll().catch(() => {});

        return { content: lines.join('\n'), format: 'markdown', total: memories.length };
      }

      case 'sqlite': {
        const config = cortex['config' as any] || {};
        const dbPath = (config as any)?.storage?.dbPath;
        if (!dbPath || dbPath === ':memory:') {
          reply.code(400);
          return { error: 'Cannot export in-memory database as SQLite dump' };
        }

        const fs = await import('node:fs');
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
          const insertedMems: { id: string; content: string }[] = [];

          for (const m of memories) {
            if (!m.content || !VALID_LAYERS.has(m.layer) || !VALID_CATEGORIES.has(m.category)) {
              skipped++;
              continue;
            }
            try {
              const mem = insertMemory({
                layer: m.layer as MemoryLayer,
                category: m.category as MemoryCategory,
                content: m.content,
                importance: m.importance ?? 0.5,
                confidence: m.confidence ?? 0.8,
                agent_id: m.agent_id || 'default',
                source: m.source || 'import',
                metadata: m.metadata ? (typeof m.metadata === 'string' ? m.metadata : JSON.stringify(m.metadata)) : null,
              });
              insertedMems.push({ id: mem.id, content: m.content });
              imported++;
            } catch (e: any) {
              log.warn({ error: e.message }, 'Failed to import memory');
              skipped++;
            }
          }

          // Batch index vectors
          await batchIndexVectors(cortex, insertedMems);

          reply.code(201);
          return { status: 'ok', imported, skipped, total: memories.length };
        }

        case 'memory_md': {
          const content = body.content as string;
          if (!content) {
            reply.code(400);
            return { error: 'Missing "content" field with MEMORY.md text' };
          }

          const { imported, skipped, insertedMems } = importFromMemoryMd(content);

          // Batch index vectors
          await batchIndexVectors(cortex, insertedMems);

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
 * Batch index vectors for a list of memories
 */
async function batchIndexVectors(
  cortex: CortexApp,
  mems: { id: string; content: string }[],
): Promise<void> {
  if (mems.length === 0) return;
  const batchSize = 20;
  for (let i = 0; i < mems.length; i += batchSize) {
    const batch = mems.slice(i, i + batchSize);
    try {
      const embeddings = await cortex.embeddingProvider.embedBatch(batch.map(b => b.content));
      for (let j = 0; j < batch.length; j++) {
        if (embeddings[j]?.length && embeddings[j]!.length > 0) {
          await cortex.vectorBackend.upsert(batch[j].id, embeddings[j]!);
        }
      }
    } catch (e: any) {
      log.warn({ error: e.message }, 'Failed to index vectors for imported batch');
    }
  }
}

/**
 * Parse a MEMORY.md file and import its entries.
 */
function importFromMemoryMd(content: string): { imported: number; skipped: number; insertedMems: { id: string; content: string }[] } {
  const lines = content.split('\n');
  let currentCategory: MemoryCategory = 'fact';
  let imported = 0;
  let skipped = 0;
  const insertedMems: { id: string; content: string }[] = [];

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
    'skill': 'skill',
    'skills': 'skill',
    'relationship': 'relationship',
    'relationships': 'relationship',
    'goal': 'goal',
    'goals': 'goal',
    'insight': 'insight',
    'insights': 'insight',
    'project': 'project_state',
    'project_state': 'project_state',
    'constraint': 'constraint',
    'constraints': 'constraint',
    'policy': 'policy',
    'policies': 'policy',
    'strategy': 'policy',
    'strategies': 'policy',
    'agent_self_improvement': 'agent_self_improvement',
    'self_improvement': 'agent_self_improvement',
    'agent_user_habit': 'agent_user_habit',
    'user_habit': 'agent_user_habit',
    'agent_relationship': 'agent_relationship',
    'agent_persona': 'agent_persona',
    'persona': 'agent_persona',
  };

  for (const line of lines) {
    const trimmed = line.trim();

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

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const entryContent = trimmed.slice(2).trim();
      if (entryContent.length < 3) {
        skipped++;
        continue;
      }

      try {
        const mem = insertMemory({
          layer: 'core',
          category: currentCategory,
          content: entryContent,
          importance: 0.7,
          confidence: 0.7,
          agent_id: 'default',
          source: 'import:memory_md',
        });
        insertedMems.push({ id: mem.id, content: entryContent });
        imported++;
      } catch (e: any) {
        skipped++;
      }
    }
  }

  return { imported, skipped, insertedMems };
}
