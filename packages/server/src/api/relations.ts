import type { FastifyInstance } from 'fastify';
import { listRelations, insertRelation, deleteRelation } from '../db/index.js';
import { generateId } from '../utils/helpers.js';

export function registerRelationsRoutes(app: FastifyInstance): void {
  app.get('/api/v1/relations', async (req) => {
    const q = req.query as any;
    return listRelations({ subject: q.subject, object: q.object, limit: q.limit ? parseInt(q.limit) : undefined });
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
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as any;
    const rel = insertRelation({
      subject: body.subject,
      predicate: body.predicate,
      object: body.object,
      confidence: body.confidence ?? 0.8,
      source_memory_id: body.source_memory_id || null,
    });
    reply.code(201);
    return rel;
  });

  app.delete('/api/v1/relations/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = deleteRelation(id);
    if (!ok) { reply.code(404); return { error: 'Relation not found' }; }
    return { ok: true, id };
  });
}
