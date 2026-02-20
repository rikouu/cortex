import type { FastifyInstance } from 'fastify';
import type { CortexApp } from '../app.js';
import { insertExtractionLog } from '../core/extraction-log.js';
import { ensureAgent } from '../db/index.js';

export function registerFlushRoutes(app: FastifyInstance, cortex: CortexApp): void {
  app.post('/api/v1/flush', {
    schema: {
      body: {
        type: 'object',
        required: ['messages'],
        properties: {
          messages: {
            type: 'array',
            items: {
              type: 'object',
              required: ['role', 'content'],
              properties: {
                role: { type: 'string' },
                content: { type: 'string' },
              },
            },
          },
          agent_id: { type: 'string' },
          session_id: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  }, async (req) => {
    const body = req.body as any;
    if (body.agent_id) ensureAgent(body.agent_id);
    const result = await cortex.flush.flush({
      messages: body.messages,
      agent_id: body.agent_id,
      session_id: body.session_id,
      reason: body.reason,
    });

    // Write extraction log if available and logging enabled
    if (result.extraction_log && cortex.config.sieve.extractionLogging) {
      insertExtractionLog(body.agent_id || 'default', body.session_id, result.extraction_log);
    }

    return result;
  });
}
