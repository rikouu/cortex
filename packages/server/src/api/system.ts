import type { FastifyInstance } from 'fastify';
import { getStats } from '../db/index.js';
import { getConfig, updateConfig } from '../utils/config.js';
import type { CortexApp } from '../app.js';

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
}
