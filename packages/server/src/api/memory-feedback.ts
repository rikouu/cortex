import type { FastifyInstance } from 'fastify';
import type { CortexApp } from '../app.js';
import {
  getMemoryById,
  insertMemoryFeedback,
  getMemoryFeedbacks,
  getMemoryFeedbackStats,
  getFeedbackOverview,
} from '../db/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('api:memory-feedback');

// ── Simple in-memory rate limiter (60 req/min per IP) ──
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

// Clean stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now >= entry.resetAt) rateLimitMap.delete(ip);
  }
}, 5 * 60_000).unref();

export function registerMemoryFeedbackRoutes(app: FastifyInstance, cortex: CortexApp): void {
  /**
   * POST /api/v1/memories/:id/feedback — Submit feedback on a memory.
   *
   * Body:
   *   signal: 'helpful' | 'not_helpful' | 'outdated' | 'wrong' (required)
   *   recall_id?: string (links feedback to a specific recall session)
   *   comment?: string
   *   source?: 'explicit' | 'implicit' (default: 'explicit')
   *   agent_id?: string
   */
  app.post('/api/v1/memories/:id/feedback', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['signal'],
        properties: {
          signal: { type: 'string', enum: ['helpful', 'not_helpful', 'outdated', 'wrong'] },
          recall_id: { type: 'string' },
          comment: { type: 'string', maxLength: 1000 },
          source: { type: 'string', enum: ['explicit', 'implicit'] },
          agent_id: { type: 'string' },
        },
      },
    },
  }, async (req: any, reply: any) => {
    if (!checkRateLimit(req.ip)) {
      return reply.code(429).send({ error: 'Rate limit exceeded' });
    }

    const { id } = req.params;
    const { signal, recall_id, comment, source, agent_id } = req.body;

    const memory = getMemoryById(id);
    if (!memory) {
      return reply.code(404).send({ error: 'Memory not found' });
    }

    const fb = insertMemoryFeedback({
      memory_id: id,
      agent_id: agent_id || memory.agent_id,
      recall_id,
      signal,
      comment,
      source,
    });

    log.info({ memory_id: id, signal, source: fb.source }, 'Memory feedback recorded');
    return { ok: true, feedback: fb };
  });

  /**
   * GET /api/v1/memories/:id/feedback — Get feedback for a memory.
   *
   * Query: limit?, offset?
   */
  app.get('/api/v1/memories/:id/feedback', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  }, async (req: any, reply: any) => {
    const { id } = req.params;
    const { limit, offset } = req.query;

    const memory = getMemoryById(id);
    if (!memory) {
      return reply.code(404).send({ error: 'Memory not found' });
    }

    const feedbacks = getMemoryFeedbacks(id, {
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    const stats = getMemoryFeedbackStats(id);

    return { ...feedbacks, stats };
  });

  /**
   * POST /api/v1/recall/:recallId/usage — Record implicit usage feedback for a recall session.
   *
   * Body:
   *   memory_ids: string[] (memories that were used/referenced by the LLM)
   *   agent_id?: string
   *
   * Records 'helpful' implicit feedback for each memory ID.
   */
  app.post('/api/v1/recall/:recallId/usage', {
    schema: {
      params: {
        type: 'object',
        required: ['recallId'],
        properties: { recallId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['memory_ids'],
        properties: {
          memory_ids: { type: 'array', items: { type: 'string' }, maxItems: 100 },
          agent_id: { type: 'string' },
        },
      },
    },
  }, async (req: any, reply: any) => {
    if (!checkRateLimit(req.ip)) {
      return reply.code(429).send({ error: 'Rate limit exceeded' });
    }

    const { recallId } = req.params;
    const { memory_ids, agent_id } = req.body;

    if (!Array.isArray(memory_ids) || memory_ids.length === 0) {
      return reply.code(400).send({ error: 'memory_ids must be a non-empty array' });
    }

    if (memory_ids.length > 100) {
      return reply.code(400).send({ error: 'memory_ids exceeds maximum of 100 items' });
    }

    const results: any[] = [];
    for (const memoryId of memory_ids) {
      const memory = getMemoryById(memoryId);
      if (!memory) continue;

      const fb = insertMemoryFeedback({
        memory_id: memoryId,
        agent_id: agent_id || memory.agent_id,
        recall_id: recallId,
        signal: 'helpful',
        source: 'implicit',
      });
      results.push(fb);
    }

    log.info({ recall_id: recallId, count: results.length }, 'Implicit usage feedback recorded');
    return { ok: true, recorded: results.length };
  });

  /**
   * GET /api/v1/feedback/overview — Get a high-level overview of memory feedback.
   *
   * Query: agent_id?
   */
  app.get('/api/v1/feedback/overview', async (req: any) => {
    const agentId = (req.query as any)?.agent_id;
    return getFeedbackOverview(agentId);
  });
}
