import type { FastifyInstance } from 'fastify';
import { listRelations, insertRelation, deleteRelation, getRelationEvidence } from '../db/index.js';
import { normalizeEntity } from '../utils/normalize.js';

export function registerRelationsRoutes(app: FastifyInstance): void {
  app.get('/api/v1/relations', async (req) => {
    const q = req.query as any;
    return listRelations({
      subject: q.subject,
      object: q.object,
      agent_id: q.agent_id,
      limit: q.limit ? parseInt(q.limit) : undefined,
      include_expired: q.include_expired === 'true' || q.include_expired === '1',
    });
  });

  app.post('/api/v1/relations', {
    schema: {
      body: {
        type: 'object',
        required: ['subject', 'predicate', 'object'],
        properties: {
          subject: { type: 'string' },
          predicate: { type: 'string' },
          object: { type: 'string' },
          confidence: { type: 'number' },
          source_memory_id: { type: 'string' },
          agent_id: { type: 'string' },
          source: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as any;
    const rel = insertRelation({
      subject: normalizeEntity(body.subject),
      predicate: body.predicate,
      object: normalizeEntity(body.object),
      confidence: body.confidence ?? 0.8,
      source_memory_id: body.source_memory_id || null,
      agent_id: body.agent_id || 'default',
      source: body.source || 'manual',
      extraction_count: 1,
      expired: 0,
    });
    reply.code(201);
    return rel;
  });

  app.get('/api/v1/relations/:id/evidence', async (req, reply) => {
    const { id } = req.params as { id: string };
    const evidence = getRelationEvidence(id);
    return evidence;
  });

  app.delete('/api/v1/relations/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = deleteRelation(id);
    if (!ok) { reply.code(404); return { error: 'Relation not found' }; }
    return { ok: true, id };
  });
}
