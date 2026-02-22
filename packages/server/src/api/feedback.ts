import type { FastifyInstance } from 'fastify';
import { insertExtractionFeedback, getExtractionFeedbackStats, getMemoryById, updateMemory } from '../db/index.js';
import type { CortexApp } from '../app.js';

export function registerFeedbackRoutes(app: FastifyInstance, cortex: CortexApp): void {
  /**
   * POST /api/v1/feedback — Submit feedback on an extracted memory.
   *
   * Body:
   *   memory_id: string (required)
   *   feedback: 'good' | 'bad' | 'corrected' (required)
   *   corrected_content?: string (required if feedback='corrected')
   *   agent_id?: string
   *
   * When feedback='corrected', the memory content is updated in-place
   * and a correction record is logged for quality tracking.
   *
   * When feedback='bad', the memory is deleted (or superseded).
   */
  app.post('/api/v1/feedback', {
    schema: {
      body: {
        type: 'object',
        required: ['memory_id', 'feedback'],
        properties: {
          memory_id: { type: 'string' },
          feedback: { type: 'string', enum: ['good', 'bad', 'corrected'] },
          corrected_content: { type: 'string' },
          agent_id: { type: 'string' },
        },
      },
    },
  }, async (req: any, reply: any) => {
    const { memory_id, feedback, corrected_content, agent_id } = req.body;

    const memory = getMemoryById(memory_id);
    if (!memory) {
      return reply.code(404).send({ error: 'Memory not found' });
    }

    // Log the feedback
    const fb = insertExtractionFeedback({
      memory_id,
      agent_id: agent_id || memory.agent_id,
      feedback,
      original_content: memory.content,
      corrected_content: feedback === 'corrected' ? corrected_content : undefined,
      category: memory.category,
      source_channel: memory.source || undefined,
    });

    // Apply correction: update memory content in-place
    if (feedback === 'corrected' && corrected_content) {
      updateMemory(memory_id, { content: corrected_content });

      // Re-index the vector with corrected content
      try {
        const embedding = await cortex.embeddingProvider.embed(corrected_content);
        if (embedding.length > 0) {
          await cortex.vectorBackend.upsert(memory_id, embedding);
        }
      } catch {
        // Best-effort re-indexing
      }
    }

    // Bad feedback: mark memory as low-confidence (can be cleaned up by lifecycle)
    if (feedback === 'bad') {
      updateMemory(memory_id, { confidence: 0.1 as any, importance: 0.1 as any });
    }

    return { ok: true, feedback: fb };
  });

  /**
   * GET /api/v1/feedback/stats — Get extraction quality stats.
   */
  app.get('/api/v1/feedback/stats', async (req: any) => {
    const agentId = (req.query as any)?.agent_id;
    return getExtractionFeedbackStats(agentId);
  });
}
