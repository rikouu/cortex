import type { FastifyInstance } from 'fastify';
import type { CortexApp } from '../app.js';

export function registerLifecycleRoutes(app: FastifyInstance, cortex: CortexApp): void {
  // Manual trigger
  app.post('/api/v1/lifecycle/run', async (req) => {
    const body = req.body as any || {};
    const report = await cortex.lifecycle.run(body.dry_run || false);
    return report;
  });

  // Preview (dry-run)
  app.get('/api/v1/lifecycle/preview', async () => {
    return cortex.lifecycle.preview();
  });

  // Get logs
  app.get('/api/v1/lifecycle/log', async (req) => {
    const q = req.query as any;
    const { getLifecycleLogs } = await import('../db/index.js');
    return getLifecycleLogs(q.limit ? parseInt(q.limit) : 50);
  });
}
