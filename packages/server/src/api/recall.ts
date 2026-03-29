import type { FastifyInstance } from 'fastify';
import type { CortexApp } from '../app.js';
import { getAgentById } from '../db/index.js';

function isHooksDisabled(agentId: string | undefined): boolean {
  if (!agentId || agentId === 'default') return false;
  const agent = getAgentById(agentId);
  if (!agent?.metadata) return false;
  try {
    const meta = JSON.parse(agent.metadata);
    return meta.cortex_hooks_disabled === true;
  } catch { return false; }
}

export function registerRecallRoutes(app: FastifyInstance, cortex: CortexApp): void {
  app.post('/api/v1/recall', {
    schema: {
      body: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string' },
          agent_id: { type: 'string' },
          pairing_code: { type: 'string' },
          max_tokens: { type: 'number' },
          layers: { type: 'array', items: { type: 'string', enum: ['working', 'core', 'archive'] } },
          skip_filters: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as any;

    // Skip recall if agent has hooks disabled
    if (isHooksDisabled(body.agent_id)) {
      return { context: '', count: 0, memories: [], skipped: true };
    }

    const result = await cortex.gate.recall({
      query: body.query,
      agent_id: body.agent_id,
      pairing_code: body.pairing_code,
      max_tokens: body.max_tokens,
      layers: body.layers,
      skip_filters: body.skip_filters,
    });
    return result;
  });
}
