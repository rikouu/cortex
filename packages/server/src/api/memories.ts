import type { FastifyInstance } from 'fastify';
import { listMemories, getMemoryById, insertMemory, updateMemory, deleteMemory, ensureAgent, getMemoryVersionChain } from '../db/index.js';
import type { CortexApp } from '../app.js';

export function registerMemoriesRoutes(app: FastifyInstance, cortex: CortexApp): void {
  // List memories
  app.get('/api/v1/memories', async (req) => {
    const q = req.query as any;
    return listMemories({
      layer: q.layer,
      category: q.category,
      agent_id: q.agent_id,
      limit: q.limit ? parseInt(q.limit) : undefined,
      offset: q.offset ? parseInt(q.offset) : undefined,
      orderBy: q.order_by,
      orderDir: q.order_dir,
      include_superseded: q.include_superseded === 'true',
    });
  });

  // Get memory by ID
  app.get('/api/v1/memories/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const mem = getMemoryById(id);
    if (!mem) { reply.code(404); return { error: 'Memory not found' }; }
    return mem;
  });

  // Get memory version chain
  app.get('/api/v1/memories/:id/chain', async (req, reply) => {
    const { id } = req.params as { id: string };
    const mem = getMemoryById(id);
    if (!mem) { reply.code(404); return { error: 'Memory not found' }; }
    const chain = getMemoryVersionChain(id);
    return { chain, current_id: id };
  });

  // Create memory
  app.post('/api/v1/memories', {
    schema: {
      body: {
        type: 'object',
        required: ['layer', 'category', 'content'],
        properties: {
          layer: { type: 'string', enum: ['working', 'core', 'archive'] },
          category: {
            type: 'string',
            enum: [
              'identity', 'preference', 'decision', 'fact', 'entity',
              'correction', 'todo', 'context', 'summary',
              'skill', 'relationship', 'goal', 'insight', 'project_state',
              'constraint', 'policy',
              'agent_self_improvement', 'agent_user_habit', 'agent_relationship', 'agent_persona',
            ],
          },
          content: { type: 'string' },
          agent_id: { type: 'string' },
          importance: { type: 'number' },
          confidence: { type: 'number' },
          source: { type: 'string' },
          expires_at: { type: 'string' },
          metadata: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as any;
    if (body.agent_id) ensureAgent(body.agent_id);
    const mem = insertMemory(body);

    // Index vector
    try {
      const embedding = await cortex.embeddingProvider.embed(body.content);
      if (embedding.length > 0) {
        await cortex.vectorBackend.upsert(mem.id, embedding);
      }
    } catch { /* best effort */ }

    reply.code(201);
    return mem;
  });

  // Update memory
  app.patch('/api/v1/memories/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const mem = updateMemory(id, body);
    if (!mem) { reply.code(404); return { error: 'Memory not found' }; }

    // Re-index vector if content changed
    if (body.content) {
      try {
        const embedding = await cortex.embeddingProvider.embed(mem.content);
        if (embedding.length > 0) {
          await cortex.vectorBackend.upsert(mem.id, embedding);
        }
      } catch { /* best effort */ }
    }

    return mem;
  });

  // Delete memory
  app.delete('/api/v1/memories/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = getMemoryById(id);
    if (!existing) { reply.code(404); return { error: 'Memory not found' }; }

    deleteMemory(id);
    try { await cortex.vectorBackend.delete([id]); } catch { /* best effort */ }
    return { ok: true, id };
  });
}
