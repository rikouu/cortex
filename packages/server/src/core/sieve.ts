import { createLogger } from '../utils/logger.js';
import { insertMemory, getMemoryById, type Memory } from '../db/index.js';
import { detectHighSignals, type DetectedSignal } from '../signals/index.js';
import { parseDuration } from '../utils/helpers.js';
import type { LLMProvider } from '../llm/interface.js';
import type { EmbeddingProvider } from '../embedding/interface.js';
import type { VectorBackend } from '../vector/interface.js';
import type { CortexConfig } from '../utils/config.js';

const log = createLogger('sieve');

/** Vector distance threshold for dedup (lower = more similar, 0 = identical) */
const DEDUP_DISTANCE_THRESHOLD = 0.15;

export interface IngestRequest {
  user_message: string;
  assistant_message: string;
  agent_id?: string;
  session_id?: string;
}

export interface IngestResponse {
  extracted: Memory[];
  high_signals: DetectedSignal[];
  summary: string | null;
  deduplicated: number;
}

export class MemorySieve {
  constructor(
    private llm: LLMProvider,
    private embeddingProvider: EmbeddingProvider,
    private vectorBackend: VectorBackend,
    private config: CortexConfig,
  ) {}

  async ingest(req: IngestRequest): Promise<IngestResponse> {
    const agentId = req.agent_id || 'default';
    const exchange = { user: req.user_message, assistant: req.assistant_message };
    const extracted: Memory[] = [];
    let deduplicated = 0;

    // 1. High signal detection (regex, no LLM)
    const highSignals = detectHighSignals(exchange);

    // 2. Write high signals immediately to Core (with dedup check)
    if (this.config.sieve.highSignalImmediate && highSignals.length > 0) {
      for (const signal of highSignals) {
        try {
          const isDup = await this.isDuplicate(signal.content, agentId);
          if (isDup) {
            deduplicated++;
            log.info({ category: signal.category }, 'High signal deduplicated');
            continue;
          }

          const mem = insertMemory({
            layer: 'core',
            category: signal.category,
            content: signal.content,
            importance: signal.importance,
            confidence: signal.confidence,
            agent_id: agentId,
            source: req.session_id ? `session:${req.session_id}` : 'sieve',
          });
          extracted.push(mem);
          await this.indexVector(mem.id, signal.content);
          log.info({ category: signal.category, pattern: signal.pattern }, 'High signal -> Core');
        } catch (e: any) {
          log.error({ error: e.message }, 'Failed to write high signal');
        }
      }
    }

    // 3. LLM summarization -> Working Memory
    let summary: string | null = null;
    try {
      summary = await this.summarize(exchange);
    } catch (e: any) {
      log.warn({ error: e.message }, 'LLM summarization failed');
      // On LLM failure, don't store raw conversation as memory
      summary = null;
    }

    if (summary) {
      const ttlMs = parseDuration(this.config.layers.working.ttl);
      const expiresAt = new Date(Date.now() + ttlMs).toISOString();

      try {
        const mem = insertMemory({
          layer: 'working',
          category: 'context',
          content: summary,
          importance: 0.5,
          confidence: 0.8,
          agent_id: agentId,
          source: req.session_id ? `session:${req.session_id}` : 'sieve',
          expires_at: expiresAt,
        });
        extracted.push(mem);
        await this.indexVector(mem.id, summary);
      } catch (e: any) {
        log.error({ error: e.message }, 'Failed to write working memory');
      }
    }

    log.info({
      agent_id: agentId,
      high_signals: highSignals.length,
      extracted: extracted.length,
      deduplicated,
    }, 'Ingest completed');

    return { extracted, high_signals: highSignals, summary, deduplicated };
  }

  /**
   * Check if similar content already exists via vector similarity.
   * Returns true if a near-duplicate is found.
   */
  private async isDuplicate(content: string, agentId: string): Promise<boolean> {
    try {
      const embedding = await this.embeddingProvider.embed(content);
      if (embedding.length === 0) return false;

      const results = await this.vectorBackend.search(embedding, 1, { agent_id: agentId });
      if (results.length > 0 && results[0]!.distance < DEDUP_DISTANCE_THRESHOLD) {
        const existing = getMemoryById(results[0]!.id);
        if (existing && !existing.superseded_by) {
          return true;
        }
      }
    } catch {
      // If vector search fails, allow insertion (dedup is best-effort)
    }
    return false;
  }

  private async summarize(exchange: { user: string; assistant: string }): Promise<string> {
    const prompt = [
      'Summarize this conversation exchange in 1-3 concise bullet points.',
      'Focus ONLY on: personal facts about the user, their preferences, decisions, goals, and actionable items.',
      '',
      'DO NOT include:',
      '- Technical implementation details, debugging steps, or code discussions',
      '- Information about tools, APIs, or system behavior',
      '- The assistant\'s explanations or instructions',
      '- Anything that is only relevant to the current task, not the user as a person',
      '',
      'If there is nothing worth remembering about the USER, output exactly: NOTHING_TO_EXTRACT',
      '',
      'Output in the same language as the input. Be brief.',
      '',
      `User: ${exchange.user.slice(0, 1000)}`,
      '',
      `Assistant: ${exchange.assistant.slice(0, 1000)}`,
    ].join('\n');

    const result = await this.llm.complete(prompt, {
      maxTokens: 200,
      temperature: 0.2,
      systemPrompt: 'You are a personal memory assistant. You ONLY extract facts about the user as a person — their identity, preferences, decisions, and goals. You ignore technical discussions, code, and implementation details.',
    });

    const trimmed = result.trim();
    if (trimmed === 'NOTHING_TO_EXTRACT' || trimmed === '') return '';
    return trimmed;
  }

  private async indexVector(id: string, content: string): Promise<void> {
    try {
      const embedding = await this.embeddingProvider.embed(content);
      if (embedding.length > 0) {
        await this.vectorBackend.upsert(id, embedding);
      }
    } catch (e: any) {
      log.warn({ id, error: e.message }, 'Vector indexing failed, text-only');
    }
  }
}
