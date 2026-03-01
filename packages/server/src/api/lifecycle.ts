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
    const { getLifecycleLogs } = await import('../db/index.js');
    const limit = q.limit ? parseInt(q.limit) : 50;
    const logs = getLifecycleLogs(limit);

    // Filter by agent_id if provided (check memory_ids and details)
    if (q.agent_id) {
      // For lifecycle_run logs, filter by checking if the run was for a specific agent
      // For promote/archive/expire logs, check if memory_ids relate to agent
      return logs.filter((l: any) => {
        try {
          const details = l.details ? JSON.parse(l.details) : {};
          if (details.agent_id === q.agent_id) return true;
          // lifecycle_run with agent_id in details
          if (l.action === 'lifecycle_run' && details.agent_id === q.agent_id) return true;
          // For promote/expire, we need to check — but memory_ids don't carry agent info
          // So for non-lifecycle_run entries, include all (they're per-memory ops)
          if (l.action !== 'lifecycle_run') return true;
          // lifecycle_run without agent filter = global run, include if no agent filter on run
          if (!details.agent_id && !q.agent_id) return true;
          return false;
        } catch { return true; }
      });
    }

    return logs;
  });
}
