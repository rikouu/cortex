import type { FastifyInstance } from 'fastify';
import { getExtractionLogs } from '../core/extraction-log.js';

export function registerExtractionLogRoutes(app: FastifyInstance): void {
  app.get('/api/v1/extraction-logs', {
    schema: {
      querystring: {
        type: 'object',
        required: ['agent_id'],
        properties: {
          agent_id: { type: 'string' },
          limit: { type: 'integer', default: 50 },
          channel: { type: 'string', enum: ['fast', 'deep', 'flush'] },
        },
      },
    },
  }, async (req) => {
    const query = req.query as any;
    const logs = getExtractionLogs(query.agent_id, {
      limit: query.limit,
      channel: query.channel,
    });
    return { items: logs, total: logs.length };
  });
}
