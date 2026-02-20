import { createLogger } from '../utils/logger.js';
import { insertMemory, getMemoryById, type Memory, type MemoryCategory } from '../db/index.js';
import { parseDuration } from '../utils/helpers.js';
import type { LLMProvider } from '../llm/interface.js';
import type { EmbeddingProvider } from '../embedding/interface.js';
import type { VectorBackend } from '../vector/interface.js';
import type { CortexConfig } from '../utils/config.js';
import { FLUSH_HIGHLIGHTS_SYSTEM_PROMPT, FLUSH_CORE_ITEMS_SYSTEM_PROMPT, EXTRACTABLE_CATEGORIES } from './prompts.js';
import type { ExtractedMemory, ExtractionLogData } from './sieve.js';

const log = createLogger('flush');

/** Vector distance threshold for dedup (lower = more similar) */
const DEDUP_DISTANCE_THRESHOLD = 0.15;

/** Regex to strip injected <cortex_memory> tags and other system metadata */
const INJECTED_TAG_RE = /<cortex_memory>[\s\S]*?<\/cortex_memory>/g;
const SYSTEM_TAG_RE = /<(?:system|context|memory|tool_result|function_call)[\s\S]*?<\/(?:system|context|memory|tool_result|function_call)>/g;

/** Strip all injected system tags from text to prevent nested pollution */
function stripInjectedContent(text: string): string {
  return text
    .replace(INJECTED_TAG_RE, '')
    .replace(SYSTEM_TAG_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

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
  constructor(
    private llm: LLMProvider,
    private embeddingProvider: EmbeddingProvider,
    private vectorBackend: VectorBackend,
    private config: CortexConfig,
  ) {}

  async flush(req: FlushRequest): Promise<FlushResponse> {
    const agentId = req.agent_id || 'default';
    const flushed: Memory[] = [];
    let extractionLog: ExtractionLogData | undefined;

    // 1. Build conversation text from messages — strip injected tags
    const conversationText = req.messages
      .map(m => `${m.role}: ${stripInjectedContent(m.content)}`)
      .filter(line => line.length > 10)
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

    // 4. Try to extract high-priority items for Core (structured JSON, with dedup)
    let deduplicated = 0;
    const deepStart = Date.now();
    let rawOutput = '';
    let parsedExtractions: ExtractedMemory[] = [];

    try {
      const result = await this.extractCoreItemsStructured(conversationText);
      rawOutput = result.raw;
      parsedExtractions = result.parsed;

      for (const item of parsedExtractions) {
        const isDup = await this.isDuplicate(item.content, agentId);
        if (isDup) {
          deduplicated++;
          log.info({ category: item.category }, 'Core item deduplicated');
          continue;
        }

        const layer = item.importance >= 0.8 ? 'core' : 'working';
        const itemExpiresAt = layer === 'working' ? new Date(Date.now() + ttlMs).toISOString() : undefined;

        const mem = insertMemory({
          layer,
          category: item.category,
          content: item.content,
          importance: item.importance,
          confidence: 0.8,
          agent_id: agentId,
          source: req.session_id ? `flush:${req.session_id}` : 'flush',
          expires_at: itemExpiresAt,
          metadata: JSON.stringify({ extraction_source: item.source, reasoning: item.reasoning }),
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

    const deepLatency = Date.now() - deepStart;

    if (this.config.sieve.extractionLogging) {
      extractionLog = {
        channel: 'flush',
        exchange_preview: conversationText.slice(0, 200),
        raw_output: rawOutput,
        parsed_memories: parsedExtractions,
        memories_written: flushed.length,
        memories_deduped: deduplicated,
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

  private async extractCoreItemsStructured(text: string): Promise<{ raw: string; parsed: ExtractedMemory[] }> {
    const raw = await this.llm.complete(text.slice(0, 3000), {
      maxTokens: this.config.sieve.maxExtractionTokens,
      temperature: 0.1,
      systemPrompt: FLUSH_CORE_ITEMS_SYSTEM_PROMPT,
    });

    const parsed = this.parseStructuredOutput(raw);
    return { raw, parsed };
  }

  private parseStructuredOutput(raw: string): ExtractedMemory[] {
    const trimmed = raw.trim();

    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      // Fallback: extract JSON object with "memories" key
      const jsonMatch = trimmed.match(/\{[\s\S]*"memories"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          obj = JSON.parse(jsonMatch[0]);
        } catch {
          // Legacy fallback: try to parse as plain JSON array
          return this.parseLegacyArray(trimmed);
        }
      } else {
        return this.parseLegacyArray(trimmed);
      }
    }

    // Handle new structured format
    if (obj.memories && Array.isArray(obj.memories)) {
      return this.validateExtractions(obj.memories);
    }

    // Handle legacy array format
    if (Array.isArray(obj)) {
      return this.validateExtractions(obj);
    }

    return [];
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

  /**
   * Check if similar content already exists via vector similarity.
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
      // Dedup is best-effort — allow insertion on failure
    }
    return false;
  }
}
