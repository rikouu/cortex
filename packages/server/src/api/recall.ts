import type { FastifyInstance } from 'fastify';
import type { CortexApp } from '../app.js';

export function registerRecallRoutes(app: FastifyInstance, cortex: CortexApp): void {
  app.post('/api/v1/recall', {
    schema: {
      body: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string' },
          agent_id: { type: 'string' },
          max_tokens: { type: 'number' },
          layers: { type: 'array', items: { type: 'string', enum: ['working', 'core', 'archive'] } },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as any;
    const result = await cortex.gate.recall({
      query: body.query,
      agent_id: body.agent_id,
      max_tokens: body.max_tokens,
      layers: body.layers,
    });
    return result;
  });
}
