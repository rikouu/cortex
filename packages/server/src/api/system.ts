import type { FastifyInstance } from 'fastify';
import { getStats, getDb } from '../db/index.js';
import { getConfig, updateConfig } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import type { CortexApp } from '../app.js';
import type { Memory } from '../db/queries.js';

const log = createLogger('system');

export function registerSystemRoutes(app: FastifyInstance, cortex: CortexApp): void {
  // Health check
  app.get('/api/v1/health', async () => {
    return {
      status: 'ok',
      version: '0.1.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  });

  // Stats
  app.get('/api/v1/stats', async (req) => {
    const q = req.query as any;
    return getStats(q.agent_id);
  });

  // Get config (safe — masks sensitive fields)
  app.get('/api/v1/config', async () => {
    const config = getConfig();
    return {
      ...config,
      llm: {
        extraction: { provider: config.llm.extraction.provider, model: config.llm.extraction.model },
        lifecycle: { provider: config.llm.lifecycle.provider, model: config.llm.lifecycle.model },
      },
      embedding: { provider: config.embedding.provider, model: config.embedding.model, dimensions: config.embedding.dimensions },
    };
  });

  // Hot update config
  app.patch('/api/v1/config', async (req) => {
    const body = req.body as any;
    const updated = updateConfig(body);
    return { ok: true, config: updated };
  });

  // Full reindex — rebuilds all vector embeddings
  app.post('/api/v1/reindex', async (req, reply) => {
    const db = getDb();
    const memories = db.prepare('SELECT id, content FROM memories WHERE superseded_by IS NULL').all() as Pick<Memory, 'id' | 'content'>[];

    let indexed = 0;
    let errors = 0;
    const batchSize = 20;

    for (let i = 0; i < memories.length; i += batchSize) {
      const batch = memories.slice(i, i + batchSize);
      try {
        const embeddings = await cortex.embeddingProvider.embedBatch(batch.map(m => m.content));
        for (let j = 0; j < batch.length; j++) {
          if (embeddings[j] && embeddings[j]!.length > 0) {
            await cortex.vectorBackend.upsert(batch[j]!.id, embeddings[j]!);
            indexed++;
          }
        }
      } catch (e: any) {
        log.error({ error: e.message, batch: i }, 'Reindex batch failed');
        errors += batch.length;
      }
    }

    return { ok: true, total: memories.length, indexed, errors };
  });
}
