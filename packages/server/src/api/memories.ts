import type { FastifyInstance } from 'fastify';
import { listMemories, getMemoryById, insertMemory, updateMemory, deleteMemory } from '../db/index.js';
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
    });
  });

  // Get memory by ID
  app.get('/api/v1/memories/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const mem = getMemoryById(id);
    if (!mem) { reply.code(404); return { error: 'Memory not found' }; }
    return mem;
  });

  // Create memory
  app.post('/api/v1/memories', {
    schema: {
      body: {
        type: 'object',
        required: ['layer', 'category', 'content'],
        properties: {
          layer: { type: 'string', enum: ['working', 'core', 'archive'] },
          category: { type: 'string' },
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
    const mem = insertMemory(body);
    reply.code(201);
    return mem;
  });

  // Update memory
  app.patch('/api/v1/memories/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const mem = updateMemory(id, body);
    if (!mem) { reply.code(404); return { error: 'Memory not found' }; }
    return mem;
  });

  // Delete memory (soft delete — moves to archive)
  app.delete('/api/v1/memories/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = getMemoryById(id);
    if (!existing) { reply.code(404); return { error: 'Memory not found' }; }

    // Soft delete: move to archive instead of actually deleting
    if (existing.layer !== 'archive') {
      updateMemory(id, { layer: 'archive' });
    } else {
      deleteMemory(id);
    }
    return { ok: true, id };
  });
}
