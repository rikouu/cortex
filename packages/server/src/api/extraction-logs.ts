import type { FastifyInstance } from 'fastify';
import { getExtractionLogs, countExtractionLogs, getExtractionLogStats } from '../core/extraction-log.js';

export function registerExtractionLogRoutes(app: FastifyInstance): void {
  app.get('/api/v1/extraction-logs', {
    schema: {
      querystring: {
        type: 'object',
        required: [],
        properties: {
          agent_id: { type: 'string' },
          limit: { type: 'integer', default: 50 },
          offset: { type: 'integer', default: 0 },
          channel: { type: 'string', enum: ['fast', 'deep', 'flush', 'mcp'] },
          status: { type: 'string', enum: ['written', 'deduped', 'empty'] },
          from: { type: 'string' },
          to: { type: 'string' },
        },
      },
    },
  }, async (req) => {
    const query = req.query as any;
    const filterOpts = {
      limit: query.limit,
      offset: query.offset,
      channel: query.channel,
      status: query.status,
      from: query.from,
      to: query.to,
    };
    const logs = getExtractionLogs(query.agent_id || undefined, filterOpts);
    const total = countExtractionLogs(query.agent_id || undefined, filterOpts);
    // Stats filtered by agent + time, but NOT by status/channel
    const statsOpts: any = {};
    if (query.from) statsOpts.from = query.from;
    if (query.to) statsOpts.to = query.to;
    const stats = getExtractionLogStats(query.agent_id || undefined, statsOpts);
    return { items: logs, total, stats };
  });
}
