import { createLogger } from '../utils/logger.js';
import { insertMemory, upsertRelation, type Memory, type MemoryCategory } from '../db/index.js';
import { parseDuration } from '../utils/helpers.js';
import type { LLMProvider } from '../llm/interface.js';
import type { EmbeddingProvider } from '../embedding/interface.js';
import type { VectorBackend } from '../vector/interface.js';
import type { CortexConfig } from '../utils/config.js';
import { FLUSH_HIGHLIGHTS_SYSTEM_PROMPT, FLUSH_CORE_ITEMS_SYSTEM_PROMPT, EXTRACTABLE_CATEGORIES } from './prompts.js';
import { stripInjectedContent, stripCodeFences } from '../utils/sanitize.js';
import { MemoryWriter, type ExtractedMemory } from './memory-writer.js';
import { type ExtractedRelation, type ExtractionLogData } from './sieve.js';
import { parseRelations } from './relation-utils.js';

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
  extraction_log?: ExtractionLogData;
}

export class MemoryFlush {
  private writer: MemoryWriter;

  constructor(
    private llm: LLMProvider,
    private embeddingProvider: EmbeddingProvider,
    private vectorBackend: VectorBackend,
    private config: CortexConfig,
  ) {
    this.writer = new MemoryWriter(llm, embeddingProvider, vectorBackend, config);
  }

  async flush(req: FlushRequest): Promise<FlushResponse> {
    const agentId = req.agent_id || 'default';
    const flushed: Memory[] = [];
    let extractionLog: ExtractionLogData | undefined;

    // 1. Build conversation text
    const conversationText = req.messages
      .map(m => `${m.role}: ${stripInjectedContent(m.content)}`)
      .filter(line => line.length > 10)
      .join('\n')
      .slice(0, 5000);

    // 2. Extract highlights (for API response, not stored as separate memory)
    let summary: string;
    try {
      summary = await this.extractHighlights(conversationText);
    } catch (e: any) {
      log.warn({ error: e.message }, 'LLM highlight extraction failed, storing raw summary');
      summary = conversationText.slice(0, 500);
    }

    // 3. Structured extraction of core items (with smart dedup via MemoryWriter)
    let deduplicated = 0;
    let smartUpdated = 0;
    const deepStart = Date.now();
    let rawOutput = '';
    let parsedExtractions: ExtractedMemory[] = [];

    try {
      const result = await this.extractCoreItemsStructured(conversationText);
      rawOutput = result.raw;
      parsedExtractions = result.parsed;

      for (const item of parsedExtractions) {
        const processResult = await this.writer.processNewMemory(item, agentId, req.session_id, undefined, 'flush');
        if (processResult.action === 'skipped') {
          deduplicated++;
          log.info({ category: item.category }, 'Core item deduplicated');
          continue;
        }
        if (processResult.action === 'smart_updated') { smartUpdated++; }
        if (processResult.memory) flushed.push(processResult.memory);
      }

      // Write extracted relations
      if (this.config.sieve.relationExtraction && result.relations.length > 0) {
        const firstMemoryId = flushed.length > 0 ? flushed[0]!.id : null;
        for (const rel of result.relations) {
          try {
            upsertRelation({
              subject: rel.subject,
              predicate: rel.predicate,
              object: rel.object,
              confidence: rel.confidence,
              source_memory_id: firstMemoryId,
              agent_id: agentId,
              source: 'flush',
              expired: rel.expired ? 1 : 0,
            });
          } catch (e: any) {
            log.warn({ error: e.message }, 'Flush: failed to upsert relation');
          }
        }
      }
    } catch (e: any) {
      log.warn({ error: e.message }, 'Core item extraction failed');
    }

    // 4. Fallback: if no structured items were extracted, write summary to working memory
    if (flushed.length === 0) {
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
            fallback: true,
          }),
        });
        flushed.push(mem);

        try {
          const embedding = await this.embeddingProvider.embed(summary);
          if (embedding.length > 0) {
            await this.vectorBackend.upsert(mem.id, embedding);
          }
        } catch (e: any) {
          log.warn({ error: e.message }, 'Vector indexing failed for flush fallback');
        }
      } catch (e: any) {
        log.error({ error: e.message }, 'Failed to write flush fallback summary');
      }
    }

    const deepLatency = Date.now() - deepStart;

    if (this.config.sieve.extractionLogging) {
      extractionLog = {
        channel: 'flush',
        exchange_preview: conversationText.slice(0, 200),
        raw_output: rawOutput,
        parsed_memories: parsedExtractions,
        memories_written: flushed.length,
        memories_deduped: deduplicated,
        memories_smart_updated: smartUpdated,
        latency_ms: deepLatency,
      };
    }

    log.info({
      agent_id: agentId,
      reason: req.reason,
      flushed_count: flushed.length,
      deduplicated,
      message_count: req.messages.length,
    }, 'Flush completed');

    return { flushed, summary, extraction_log: extractionLog };
  }

  private async extractHighlights(text: string): Promise<string> {
    return (await this.llm.complete(text, {
      maxTokens: 300,
      temperature: 0.2,
      systemPrompt: FLUSH_HIGHLIGHTS_SYSTEM_PROMPT,
    })).trim();
  }

  private async extractCoreItemsStructured(text: string): Promise<{ raw: string; parsed: ExtractedMemory[]; relations: ExtractedRelation[] }> {
    const raw = await this.llm.complete(text.slice(0, this.config.sieve.maxConversationChars), {
      maxTokens: this.config.sieve.maxExtractionTokens,
      temperature: 0.1,
      systemPrompt: FLUSH_CORE_ITEMS_SYSTEM_PROMPT,
    });

    const { memories: parsed, relations } = this.parseStructuredOutput(raw);
    return { raw, parsed, relations };
  }

  private parseStructuredOutput(raw: string): { memories: ExtractedMemory[]; relations: ExtractedRelation[] } {
    const trimmed = stripCodeFences(raw);

    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      const jsonMatch = trimmed.match(/\{[\s\S]*"memories"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          obj = JSON.parse(jsonMatch[0]);
        } catch {
          return { memories: this.parseLegacyArray(trimmed), relations: [] };
        }
      } else {
        return { memories: this.parseLegacyArray(trimmed), relations: [] };
      }
    }

    const relations = parseRelations(obj);

    if (obj.memories && Array.isArray(obj.memories)) {
      return { memories: this.validateExtractions(obj.memories), relations };
    }

    if (Array.isArray(obj)) {
      return { memories: this.validateExtractions(obj), relations };
    }

    return { memories: [], relations };
  }

  private parseLegacyArray(raw: string): ExtractedMemory[] {
    try {
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const items = JSON.parse(jsonMatch[0]);
        if (Array.isArray(items)) {
          return this.validateExtractions(items);
        }
      }
    } catch {
      log.warn('Failed to parse flush extraction output');
    }
    return [];
  }

  private validateExtractions(items: any[]): ExtractedMemory[] {
    const validCategories = new Set<string>(EXTRACTABLE_CATEGORIES);

    return items
      .filter((m: any) => {
        if (!m.content || typeof m.content !== 'string' || m.content.length < 3) return false;
        if (!m.category || !validCategories.has(m.category)) return false;
        if (typeof m.importance !== 'number' || m.importance < 0 || m.importance > 1) return false;
        return true;
      })
      .map((m: any) => ({
        content: m.content,
        category: m.category as MemoryCategory,
        importance: m.importance,
        source: (['user_stated', 'user_implied', 'observed_pattern'].includes(m.source)
          ? m.source
          : 'user_implied') as ExtractedMemory['source'],
        reasoning: m.reasoning || '',
      }));
  }
}
