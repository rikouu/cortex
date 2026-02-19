import { createLogger } from '../utils/logger.js';
import { insertMemory, type Memory } from '../db/index.js';
import { parseDuration } from '../utils/helpers.js';
import type { LLMProvider } from '../llm/interface.js';
import type { EmbeddingProvider } from '../embedding/interface.js';
import type { VectorBackend } from '../vector/interface.js';
import type { CortexConfig } from '../utils/config.js';

const log = createLogger('flush');

export interface FlushRequest {
  messages: { role: string; content: string }[];
  agent_id?: string;
  session_id?: string;
  reason?: string;
}

export interface FlushResponse {
  flushed: Memory[];
  summary: string;
}

export class MemoryFlush {
  constructor(
    private llm: LLMProvider,
    private embeddingProvider: EmbeddingProvider,
    private vectorBackend: VectorBackend,
    private config: CortexConfig,
  ) {}

  async flush(req: FlushRequest): Promise<FlushResponse> {
    const agentId = req.agent_id || 'default';
    const flushed: Memory[] = [];

    // 1. Build conversation text from messages
    const conversationText = req.messages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n')
      .slice(0, 5000);

    // 2. LLM extraction of key highlights
    let summary: string;
    try {
      summary = await this.extractHighlights(conversationText);
    } catch (e: any) {
      log.warn({ error: e.message }, 'LLM highlight extraction failed, storing raw summary');
      summary = conversationText.slice(0, 500);
    }

    // 3. Write to Working Memory with flush tag
    const ttlMs = parseDuration(this.config.layers.working.ttl);
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();

    try {
      const mem = insertMemory({
        layer: 'working',
        category: 'summary',
        content: summary,
        importance: 0.7,
        confidence: 0.85,
        agent_id: agentId,
        source: req.session_id ? `flush:${req.session_id}` : 'flush',
        expires_at: expiresAt,
        metadata: JSON.stringify({
          reason: req.reason || 'manual',
          message_count: req.messages.length,
          flushed_at: new Date().toISOString(),
        }),
      });
      flushed.push(mem);

      // Index vector
      try {
        const embedding = await this.embeddingProvider.embed(summary);
        if (embedding.length > 0) {
          await this.vectorBackend.upsert(mem.id, embedding);
        }
      } catch (e: any) {
        log.warn({ error: e.message }, 'Vector indexing failed for flush');
      }
    } catch (e: any) {
      log.error({ error: e.message }, 'Failed to write flush memory');
    }

    // 4. Try to extract high-priority items for Core
    try {
      const coreItems = await this.extractCoreItems(conversationText);
      for (const item of coreItems) {
        const mem = insertMemory({
          layer: 'core',
          category: item.category as any,
          content: item.content,
          importance: item.importance,
          confidence: 0.8,
          agent_id: agentId,
          source: req.session_id ? `flush:${req.session_id}` : 'flush',
        });
        flushed.push(mem);

        try {
          const embedding = await this.embeddingProvider.embed(item.content);
          if (embedding.length > 0) {
            await this.vectorBackend.upsert(mem.id, embedding);
          }
        } catch { /* vector indexing is best-effort */ }
      }
    } catch (e: any) {
      log.warn({ error: e.message }, 'Core item extraction failed');
    }

    log.info({
      agent_id: agentId,
      reason: req.reason,
      flushed_count: flushed.length,
      message_count: req.messages.length,
    }, 'Flush completed');

    return { flushed, summary };
  }

  private async extractHighlights(text: string): Promise<string> {
    const prompt = [
      'Extract the key highlights from this conversation session.',
      'Focus on: decisions made, state changes, user preferences, blockers/todos.',
      'Output as concise bullet points in the same language as the input.',
      'Maximum 5 bullet points.',
      '',
      text,
    ].join('\n');

    return (await this.llm.complete(prompt, {
      maxTokens: 300,
      temperature: 0.2,
      systemPrompt: 'You are a memory extraction assistant. Be concise and factual.',
    })).trim();
  }

  private async extractCoreItems(text: string): Promise<{ category: string; content: string; importance: number }[]> {
    const prompt = [
      'From this conversation, extract ONLY the most important permanent facts.',
      'For each fact, provide a JSON array of objects with: category, content, importance.',
      'Categories: identity, preference, decision, fact, todo',
      'importance: 0.0-1.0 (only include items >= 0.7)',
      'Output ONLY valid JSON array. If nothing important, output [].',
      '',
      text.slice(0, 3000),
    ].join('\n');

    const result = await this.llm.complete(prompt, {
      maxTokens: 500,
      temperature: 0.1,
      systemPrompt: 'You are a structured data extraction assistant. Output only valid JSON.',
    });

    try {
      // Try to parse JSON from the response
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const items = JSON.parse(jsonMatch[0]);
        if (Array.isArray(items)) {
          return items.filter(
            (i: any) => i.category && i.content && typeof i.importance === 'number'
          );
        }
      }
    } catch {
      log.warn('Failed to parse core items JSON');
    }
    return [];
  }
}
