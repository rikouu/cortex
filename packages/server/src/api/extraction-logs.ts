import type { FastifyInstance } from 'fastify';
import { getExtractionLogs, countExtractionLogs } from '../core/extraction-log.js';

export function registerExtractionLogRoutes(app: FastifyInstance): void {
  app.get('/api/v1/extraction-logs', {
    schema: {
      querystring: {
        type: 'object',
        required: [],
        properties: {
          agent_id: { type: 'string' },
          limit: { type: 'integer', default: 50 },
          channel: { type: 'string', enum: ['fast', 'deep', 'flush'] },
        },
      },
    },
  }, async (req) => {
    const query = req.query as any;
    const logs = getExtractionLogs(query.agent_id || undefined, {
      limit: query.limit,
      channel: query.channel,
    });
    const total = countExtractionLogs(query.agent_id || undefined, { channel: query.channel });
    return { items: logs, total };
  });
}
