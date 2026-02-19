import type { FastifyInstance } from 'fastify';
import type { CortexApp } from '../app.js';

export function registerIngestRoutes(app: FastifyInstance, cortex: CortexApp): void {
  app.post('/api/v1/ingest', {
    schema: {
      body: {
        type: 'object',
        required: ['user_message', 'assistant_message'],
        properties: {
          user_message: { type: 'string' },
          assistant_message: { type: 'string' },
          agent_id: { type: 'string' },
          session_id: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as any;
    const result = await cortex.sieve.ingest({
      user_message: body.user_message,
      assistant_message: body.assistant_message,
      agent_id: body.agent_id,
      session_id: body.session_id,
    });
    reply.code(201);
    return result;
  });
}
