import type { FastifyInstance } from 'fastify';
import type { CortexApp } from '../app.js';
import { insertExtractionLog } from '../core/extraction-log.js';
import { ensureAgent } from '../db/index.js';

export function registerIngestRoutes(app: FastifyInstance, cortex: CortexApp): void {
  app.post('/api/v1/ingest', {
    schema: {
      body: {
        type: 'object',
        required: ['user_message', 'assistant_message'],
        properties: {
          user_message: { type: 'string' },
          assistant_message: { type: 'string' },
          messages: {
            type: 'array',
            items: {
              type: 'object',
              required: ['role', 'content'],
              properties: {
                role: { type: 'string', enum: ['user', 'assistant'] },
                content: { type: 'string' },
              },
            },
          },
          agent_id: { type: 'string' },
          session_id: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as any;
    if (body.agent_id) ensureAgent(body.agent_id);
    const result = await cortex.sieve.ingest({
      user_message: body.user_message,
      assistant_message: body.assistant_message,
      messages: body.messages,
      agent_id: body.agent_id,
      session_id: body.session_id,
    });

    // Write extraction logs (fast + deep channels)
    if (cortex.config.sieve.extractionLogging && result.extraction_logs.length > 0) {
      for (const log of result.extraction_logs) {
        insertExtractionLog(body.agent_id || 'default', body.session_id, log);
      }
    }

    reply.code(201);
    return result;
  });
}
