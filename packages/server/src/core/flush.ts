import { createLogger } from '../utils/logger.js';
import { insertMemory, getMemoryById, updateMemory, upsertRelation, type Memory, type MemoryCategory } from '../db/index.js';
import { parseDuration } from '../utils/helpers.js';
import type { LLMProvider } from '../llm/interface.js';
import type { EmbeddingProvider } from '../embedding/interface.js';
import type { VectorBackend } from '../vector/interface.js';
import type { CortexConfig } from '../utils/config.js';
import { FLUSH_HIGHLIGHTS_SYSTEM_PROMPT, FLUSH_CORE_ITEMS_SYSTEM_PROMPT, SMART_UPDATE_SYSTEM_PROMPT, EXTRACTABLE_CATEGORIES } from './prompts.js';
import { type ExtractedMemory, type ExtractedRelation, type ExtractionLogData, type SimilarMemory, type SmartUpdateDecision } from './sieve.js';
import { parseRelations } from './relation-utils.js';

const log = createLogger('flush');

/** Legacy fallback threshold when smartUpdate is disabled */
const LEGACY_DEDUP_THRESHOLD = 0.15;

/** Regex to strip injected <cortex_memory> tags and other system metadata */
const INJECTED_TAG_RE = /<cortex_memory>[\s\S]*?<\/cortex_memory>/g;
const SYSTEM_TAG_RE = /<(?:system|context|memory|tool_result|function_call)[\s\S]*?<\/(?:system|context|memory|tool_result|function_call)>/g;

/** Plain-text metadata prefixes injected by some frameworks */
const PLAIN_META_RE = /^Conversation info \(untrusted metadata\):.*$/gm;
const SYSTEM_PREFIX_RE = /^(?:System (?:info|context|metadata)|Conversation (?:info|context|metadata)|Memory context|Previous context)[\s(][^\n]*$/gm;

/** Strip all injected system tags from text to prevent nested pollution */
function stripInjectedContent(text: string): string {
  return text
    .replace(INJECTED_TAG_RE, '')
    .replace(SYSTEM_TAG_RE, '')
    .replace(PLAIN_META_RE, '')
    .replace(SYSTEM_PREFIX_RE, '')
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

    // 4. Try to extract high-priority items for Core (structured JSON, with smart dedup)
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
        const processResult = await this.processNewMemory(item, agentId, req.session_id);
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
    const raw = await this.llm.complete(text.slice(0, 3000), {
      maxTokens: this.config.sieve.maxExtractionTokens,
      temperature: 0.1,
      systemPrompt: FLUSH_CORE_ITEMS_SYSTEM_PROMPT,
    });

    const { memories: parsed, relations } = this.parseStructuredOutput(raw);
    return { raw, parsed, relations };
  }

  private parseStructuredOutput(raw: string): { memories: ExtractedMemory[]; relations: ExtractedRelation[] } {
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
          return { memories: this.parseLegacyArray(trimmed), relations: [] };
        }
      } else {
        return { memories: this.parseLegacyArray(trimmed), relations: [] };
      }
    }

    const relations = parseRelations(obj);

    // Handle new structured format
    if (obj.memories && Array.isArray(obj.memories)) {
      return { memories: this.validateExtractions(obj.memories), relations };
    }

    // Handle legacy array format
    if (Array.isArray(obj)) {
      return { memories: this.validateExtractions(obj), relations };
    }

    return { memories: [], relations };
  }

  // parseRelations is now imported from ./relation-utils.js

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

  // ── Smart Update methods (mirrors sieve.ts logic) ──

  private async findSimilar(content: string, agentId: string): Promise<SimilarMemory[]> {
    try {
      const embedding = await this.embeddingProvider.embed(content);
      if (embedding.length === 0) return [];

      const results = await this.vectorBackend.search(embedding, 3, { agent_id: agentId });
      const similar: SimilarMemory[] = [];
      for (const r of results) {
        const mem = getMemoryById(r.id);
        if (mem && !mem.superseded_by && !mem.is_pinned) {
          similar.push({ memory: mem, distance: r.distance });
        }
      }
      return similar;
    } catch {
      return [];
    }
  }

  private async smartUpdateDecision(existing: Memory, newContent: string): Promise<SmartUpdateDecision> {
    const prompt = `EXISTING MEMORY:\n${existing.content}\n\nNEW MEMORY:\n${newContent}`;
    try {
      const raw = await this.llm.complete(prompt, {
        maxTokens: 300,
        temperature: 0.1,
        systemPrompt: SMART_UPDATE_SYSTEM_PROMPT,
      });

      const trimmed = raw.trim();
      let obj: any;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        const jsonMatch = trimmed.match(/\{[\s\S]*"action"[\s\S]*\}/);
        if (jsonMatch) obj = JSON.parse(jsonMatch[0]);
        else return { action: 'replace', reasoning: 'Failed to parse LLM response' };
      }

      const action = ['keep', 'replace', 'merge'].includes(obj.action) ? obj.action : 'replace';
      return {
        action: action as SmartUpdateDecision['action'],
        merged_content: obj.merged_content,
        reasoning: obj.reasoning || '',
      };
    } catch (e: any) {
      log.warn({ error: e.message }, 'Flush smart update LLM call failed, defaulting to replace');
      return { action: 'replace', reasoning: 'LLM call failed' };
    }
  }

  private async executeSmartUpdate(
    decision: SmartUpdateDecision,
    existing: Memory,
    extraction: ExtractedMemory,
    agentId: string,
    sessionId?: string,
  ): Promise<Memory> {
    const content = decision.action === 'merge' && decision.merged_content
      ? decision.merged_content
      : extraction.content;

    const layer = extraction.importance >= 0.8 ? 'core' : 'working';
    const ttlMs = parseDuration(this.config.layers.working.ttl);
    const expiresAt = layer === 'working' ? new Date(Date.now() + ttlMs).toISOString() : undefined;

    const metadata: Record<string, any> = {
      extraction_source: extraction.source,
      reasoning: extraction.reasoning,
      smart_update_type: decision.action,
      update_reasoning: decision.reasoning,
      supersedes: existing.id,
    };

    const newMem = insertMemory({
      layer,
      category: extraction.category,
      content,
      importance: extraction.importance,
      confidence: 0.8,
      agent_id: agentId,
      source: sessionId ? `flush:${sessionId}` : 'flush',
      expires_at: expiresAt,
      metadata: JSON.stringify(metadata),
    });

    updateMemory(existing.id, { superseded_by: newMem.id });

    try {
      const embedding = await this.embeddingProvider.embed(content);
      if (embedding.length > 0) {
        await this.vectorBackend.upsert(newMem.id, embedding);
      }
    } catch { /* best-effort */ }

    log.info({ action: decision.action, old_id: existing.id, new_id: newMem.id }, 'Flush smart update executed');
    return newMem;
  }

  private async processNewMemory(
    extraction: ExtractedMemory,
    agentId: string,
    sessionId?: string,
  ): Promise<{ action: 'inserted' | 'skipped' | 'smart_updated'; memory?: Memory }> {
    const { smartUpdate, exactDupThreshold, similarityThreshold } = this.config.sieve;

    const similar = await this.findSimilar(extraction.content, agentId);

    if (!smartUpdate) {
      if (similar.length > 0 && similar[0]!.distance < LEGACY_DEDUP_THRESHOLD) {
        return { action: 'skipped' };
      }
      return { action: 'inserted', memory: await this.insertNewMemory(extraction, agentId, sessionId) };
    }

    if (similar.length > 0) {
      const closest = similar[0]!;

      if (closest.distance < exactDupThreshold) {
        return { action: 'skipped' };
      }

      if (closest.distance < similarityThreshold) {
        const decision = await this.smartUpdateDecision(closest.memory, extraction.content);
        if (decision.action === 'keep') return { action: 'skipped' };
        const newMem = await this.executeSmartUpdate(decision, closest.memory, extraction, agentId, sessionId);
        return { action: 'smart_updated', memory: newMem };
      }
    }

    return { action: 'inserted', memory: await this.insertNewMemory(extraction, agentId, sessionId) };
  }

  private async insertNewMemory(extraction: ExtractedMemory, agentId: string, sessionId?: string): Promise<Memory> {
    const layer = extraction.importance >= 0.8 ? 'core' : 'working';
    const ttlMs = parseDuration(this.config.layers.working.ttl);
    const expiresAt = layer === 'working' ? new Date(Date.now() + ttlMs).toISOString() : undefined;

    const mem = insertMemory({
      layer,
      category: extraction.category,
      content: extraction.content,
      importance: extraction.importance,
      confidence: 0.8,
      agent_id: agentId,
      source: sessionId ? `flush:${sessionId}` : 'flush',
      expires_at: expiresAt,
      metadata: JSON.stringify({ extraction_source: extraction.source, reasoning: extraction.reasoning }),
    });

    // Index vector
    try {
      const embedding = await this.embeddingProvider.embed(extraction.content);
      if (embedding.length > 0) {
        await this.vectorBackend.upsert(mem.id, embedding);
      }
    } catch { /* best-effort */ }

    return mem;
  }
}
