import type { FastifyInstance } from 'fastify';
import type { CortexApp } from '../app.js';

export function registerLifecycleRoutes(app: FastifyInstance, cortex: CortexApp): void {
  // Manual trigger
  app.post('/api/v1/lifecycle/run', async (req) => {
    const body = req.body as any || {};
    const agentId = body.agent_id || undefined;
    const report = await cortex.lifecycle.run(body.dry_run || false, 'manual', agentId);
    return report;
  });

  // Preview (dry-run)
  app.get('/api/v1/lifecycle/preview', async (req) => {
    const q = req.query as any;
    return cortex.lifecycle.preview(q.agent_id || undefined);
  });

  // Get logs
  app.get('/api/v1/lifecycle/log', async (req) => {
    const q = req.query as any;
    const { getLifecycleLogs, countLifecycleLogs } = await import('../db/index.js');
    const limit = q.limit ? parseInt(q.limit) : 50;
    const offset = q.offset ? parseInt(q.offset) : 0;
    let logs = getLifecycleLogs(limit, offset);
    const total = countLifecycleLogs();

    // Filter by agent_id if provided
    if (q.agent_id) {
      logs = logs.filter((l: any) => {
        try {
          const details = l.details ? JSON.parse(l.details) : {};
          const logAgent = details.agent_id;
          return logAgent === q.agent_id || logAgent === 'all';
        } catch { return true; }
      });
    }

    return { items: logs, total };
  });
}
