import { createLogger } from '../utils/logger.js';
import { upsertRelation, type Memory, type MemoryCategory } from '../db/index.js';
import { detectHighSignals, isSmallTalk, type DetectedSignal } from '../signals/index.js';
import type { LLMProvider } from '../llm/interface.js';
import type { EmbeddingProvider } from '../embedding/interface.js';
import type { VectorBackend } from '../vector/interface.js';
import type { CortexConfig } from '../utils/config.js';
import { SIEVE_SYSTEM_PROMPT, EXTRACTABLE_CATEGORIES } from './prompts.js';
import { stripInjectedContent, stripCodeFences } from '../utils/sanitize.js';
import { MemoryWriter, type ExtractedMemory } from './memory-writer.js';
import { parseRelations } from './relation-utils.js';

const log = createLogger('sieve');

// Re-export types for backward compatibility
export type { ExtractedMemory, SimilarMemory, SmartUpdateDecision } from './memory-writer.js';

export const VALID_PREDICATES = new Set([
  'uses', 'works_at', 'lives_in', 'knows', 'manages', 'belongs_to',
  'created', 'prefers', 'studies', 'skilled_in', 'collaborates_with',
  'reports_to', 'owns', 'interested_in', 'related_to',
  'not_uses', 'not_interested_in', 'dislikes',
]);

export interface ExtractedRelation {
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  expired?: boolean;
}

export interface ExtractionLogData {
  channel: 'fast' | 'deep' | 'flush' | 'mcp';
  exchange_preview: string;
  raw_output: string;
  parsed_memories: ExtractedMemory[];
  memories_written: number;
  memories_deduped: number;
  memories_smart_updated: number;
  latency_ms: number;
}

export interface IngestRequest {
  user_message: string;
  assistant_message: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  agent_id?: string;
  session_id?: string;
}

export interface IngestResponse {
  extracted: Memory[];
  high_signals: DetectedSignal[];
  structured_extractions: ExtractedMemory[];
  deduplicated: number;
  smart_updated: number;
  extraction_logs: ExtractionLogData[];
}

export class MemorySieve {
  private writer: MemoryWriter;

  constructor(
    private llm: LLMProvider,
    private embeddingProvider: EmbeddingProvider,
    private vectorBackend: VectorBackend,
    private config: CortexConfig,
  ) {
    this.writer = new MemoryWriter(llm, embeddingProvider, vectorBackend, config);
  }

  async ingest(req: IngestRequest): Promise<IngestResponse> {
    const agentId = req.agent_id || 'default';

    // Build multi-turn messages if provided
    let cleanMessages: Array<{ role: 'user' | 'assistant'; content: string }> | undefined;
    if (req.messages && req.messages.length > 0) {
      // Apply context window: only use recent messages to avoid re-extracting old content
      const windowSize = this.config.sieve.contextMessages;
      const recentMessages = req.messages.slice(-windowSize);
      cleanMessages = recentMessages
        .map(m => ({ role: m.role, content: stripInjectedContent(m.content) }))
        .filter(m => m.content.length >= 3);
      if (cleanMessages.length === 0) cleanMessages = undefined;
    }

    const cleanUser = stripInjectedContent(req.user_message);
    const cleanAssistant = stripInjectedContent(req.assistant_message);

    if (!cleanUser || cleanUser.length < 3) {
      log.info({ agent_id: agentId }, 'Ingest skipped: empty after tag stripping');
      return { extracted: [], high_signals: [], structured_extractions: [], deduplicated: 0, smart_updated: 0, extraction_logs: [] };
    }

    const exchange = { user: cleanUser, assistant: cleanAssistant, messages: cleanMessages };
    const extracted: Memory[] = [];
    let deduplicated = 0;
    let smartUpdated = 0;
    const extractionLogs: ExtractionLogData[] = [];
    const fastEnabled = this.config.sieve.fastChannelEnabled;
    const userIsSmallTalk = isSmallTalk(cleanUser);

    // Always run fast channel first, then deep channel.
    // This ensures fast-channel writes are visible to deep-channel dedup via vector search,
    // eliminating the need for a separate crossDedup step.

    // 1. Fast channel (regex, no LLM)
    let highSignals: DetectedSignal[] = [];
    if (fastEnabled) {
      const fastResult = await this.runFastChannel(exchange, agentId, req.session_id);
      highSignals = fastResult.signals;
      extracted.push(...fastResult.extracted);
      deduplicated += fastResult.deduplicated;
      smartUpdated += fastResult.smart_updated;
      if (fastResult.extractionLog) extractionLogs.push(fastResult.extractionLog);
    }

    // 2. Deep channel (LLM structured extraction) — skip for small talk to save LLM calls
    let deepExtractionCount = 0;
    if (!userIsSmallTalk) {
      const deepResult = await this.runDeepChannel(exchange, agentId, req.session_id);
      extracted.push(...deepResult.extracted);
      deduplicated += deepResult.deduplicated;
      smartUpdated += deepResult.smart_updated;
      extractionLogs.push(deepResult.extractionLog);
      deepExtractionCount = deepResult.structuredExtractions.length;
    }

    log.info({
      agent_id: agentId,
      high_signals: highSignals.length,
      deep_extractions: deepExtractionCount,
      extracted: extracted.length,
      deduplicated,
      smart_updated: smartUpdated,
    }, 'Ingest completed');

    return {
      extracted,
      high_signals: highSignals,
      structured_extractions: [],
      deduplicated,
      smart_updated: smartUpdated,
      extraction_logs: extractionLogs,
    };
  }

  // ── Fast channel: regex-based high signal detection ──

  private async runFastChannel(
    exchange: { user: string; assistant: string; messages?: Array<{ role: 'user' | 'assistant'; content: string }> },
    agentId: string,
    sessionId?: string,
  ): Promise<{ signals: DetectedSignal[]; extracted: Memory[]; deduplicated: number; smart_updated: number; extractionLog?: ExtractionLogData }> {
    const start = Date.now();
    const signals = detectHighSignals(exchange);
    const extracted: Memory[] = [];
    let deduplicated = 0;
    let smart_updated = 0;

    if (this.config.sieve.highSignalImmediate && signals.length > 0) {
      try {
        const signalExtractions: ExtractedMemory[] = signals.map(s => ({
          content: s.content, category: s.category, importance: s.importance,
          source: 'user_stated' as const, reasoning: `signal: ${s.pattern}`,
        }));
        const batchResults = await this.writer.processNewMemoryBatch(
          signalExtractions, agentId, sessionId, signals[0]?.confidence, 'session',
        );
        for (const result of batchResults) {
          if (result.action === 'skipped') { deduplicated++; continue; }
          if (result.action === 'smart_updated') { smart_updated++; }
          if (result.memory) extracted.push(result.memory);
        }
      } catch (e: any) {
        log.error({ error: e.message }, 'Fast channel: batch processing failed');
      }
    }

    const fastPreview = exchange.messages && exchange.messages.length > 0
      ? exchange.messages.map((m: any) => `[${m.role}] ${m.content.slice(0, 60)}`).join(' → ').slice(0, 300)
      : exchange.user.slice(0, 200);
    const extractionLog: ExtractionLogData | undefined = signals.length > 0 ? {
      channel: 'fast',
      exchange_preview: fastPreview,
      raw_output: JSON.stringify(signals.map(s => ({ pattern: s.pattern, category: s.category, content: s.content }))),
      parsed_memories: signals.map(s => ({ content: s.content, category: s.category, importance: s.importance, source: 'user_stated' as const, reasoning: `signal: ${s.pattern}` })),
      memories_written: extracted.length,
      memories_deduped: deduplicated,
      memories_smart_updated: smart_updated,
      latency_ms: Date.now() - start,
    } : undefined;

    return { signals, extracted, deduplicated, smart_updated, extractionLog };
  }

  // ── Deep channel: LLM structured extraction ──

  private async runDeepChannel(
    exchange: { user: string; assistant: string; messages?: Array<{ role: 'user' | 'assistant'; content: string }> },
    agentId: string,
    sessionId?: string,
  ): Promise<{
    extracted: Memory[];
    deduplicated: number;
    smart_updated: number;
    structuredExtractions: ExtractedMemory[];
    extractionLog: ExtractionLogData;
  }> {
    const extracted: Memory[] = [];
    let deduplicated = 0;
    let smart_updated = 0;
    let structuredExtractions: ExtractedMemory[] = [];
    const start = Date.now();
    let rawOutput = '';
    let extractedRelations: ExtractedRelation[] = [];

    try {
      const profileContext = this.config.sieve.profileInjection
        ? await this.getProfile(agentId)
        : undefined;
      const result = await this.extractStructuredRaw(exchange, profileContext);
      rawOutput = result.raw;
      structuredExtractions = result.parsed;
      extractedRelations = result.relations;
    } catch (e: any) {
      log.warn({ error: e.message }, 'Deep channel: LLM extraction failed');
    }

    let written = 0;
    if (structuredExtractions.length > 0) {
      try {
        const batchResults = await this.writer.processNewMemoryBatch(
          structuredExtractions, agentId, sessionId, undefined, 'sieve',
        );
        for (const result of batchResults) {
          if (result.action === 'skipped') { deduplicated++; continue; }
          if (result.action === 'smart_updated') { smart_updated++; }
          if (result.memory) { extracted.push(result.memory); written++; }
        }
      } catch (e: any) {
        log.error({ error: e.message }, 'Deep channel: batch processing failed');
      }
    }

    // Write extracted relations
    if (this.config.sieve.relationExtraction && extractedRelations.length > 0) {
      const firstMemoryId = extracted.length > 0 ? extracted[0]!.id : null;
      for (const rel of extractedRelations) {
        try {
          const result = upsertRelation({
            subject: rel.subject,
            predicate: rel.predicate,
            object: rel.object,
            confidence: rel.confidence,
            source_memory_id: firstMemoryId,
            agent_id: agentId,
            source: 'extraction',
            expired: rel.expired ? 1 : 0,
          });
          log.info({ action: result.action, subject: rel.subject, predicate: rel.predicate, object: rel.object }, 'Relation upserted');
        } catch (e: any) {
          log.warn({ error: e.message, subject: rel.subject, predicate: rel.predicate }, 'Failed to upsert relation');
        }
      }
    }

    const latency = Date.now() - start;
    const preview = exchange.messages && exchange.messages.length > 0
      ? exchange.messages.map((m: any) => `[${m.role}] ${m.content.slice(0, 60)}`).join(' → ').slice(0, 300)
      : exchange.user.slice(0, 200);

    return {
      extracted,
      deduplicated,
      smart_updated,
      structuredExtractions,
      extractionLog: {
        channel: 'deep',
        exchange_preview: preview,
        raw_output: rawOutput,
        parsed_memories: structuredExtractions,
        memories_written: written,
        memories_deduped: deduplicated,
        memories_smart_updated: smart_updated,
        latency_ms: latency,
      },
    };
  }

  // ── Core extraction logic ──

  private async extractStructuredRaw(
    exchange: { user: string; assistant: string; messages?: Array<{ role: 'user' | 'assistant'; content: string }> },
    profileContext?: string,
  ): Promise<{ raw: string; parsed: ExtractedMemory[]; relations: ExtractedRelation[] }> {
    let conversationBlock: string;
    const totalLimit = this.config.sieve.maxConversationChars;

    if (exchange.messages && exchange.messages.length > 0) {
      // Dynamic budget: allocate proportional to actual content length, not fixed 65/35.
      // Each message gets a share of the budget based on its length relative to total.
      const rawLengths = exchange.messages.map(m => m.content.length);
      const rawTotal = rawLengths.reduce((a, b) => a + b, 0);

      // Minimum per-message budget: ensure short messages aren't starved
      const minPerMessage = 200;
      const overhead = exchange.messages.length * 15; // labels + separators
      const usableBudget = totalLimit - overhead;

      const parts: string[] = [];
      let totalLen = 0;
      for (let i = 0; i < exchange.messages.length; i++) {
        const m = exchange.messages[i]!;
        const label = m.role === 'user' ? '[USER]' : '[ASSISTANT]';
        // Proportional budget with minimum floor
        const proportional = rawTotal > 0
          ? Math.floor(usableBudget * (rawLengths[i]! / rawTotal))
          : Math.floor(usableBudget / exchange.messages.length);
        const maxLen = Math.max(minPerMessage, proportional);
        const slice = m.content.slice(0, maxLen);
        const line = `${label}\n${slice}`;
        if (totalLen + line.length > totalLimit) break;
        parts.push(line);
        totalLen += line.length;
      }
      conversationBlock = parts.join('\n\n');
    } else {
      // Single-turn: dynamic ratio based on actual content lengths
      const userLen = exchange.user.length;
      const assistantLen = exchange.assistant.length;
      const contentTotal = userLen + assistantLen;
      const userRatio = contentTotal > 0 ? Math.max(0.2, Math.min(0.8, userLen / contentTotal)) : 0.65;
      const userSlice = exchange.user.slice(0, Math.floor(totalLimit * userRatio));
      const assistantSlice = exchange.assistant.slice(0, Math.floor(totalLimit * (1 - userRatio)));
      conversationBlock = `[USER]\n${userSlice}\n\n[ASSISTANT]\n${assistantSlice}`;
    }

    const prompt = profileContext
      ? `${profileContext}\n\n---\n\n${conversationBlock}`
      : conversationBlock;

    const maxTokens = this.config.sieve.maxExtractionTokens;

    const raw = await this.llm.complete(prompt, {
      maxTokens,
      temperature: 0.1,
      systemPrompt: SIEVE_SYSTEM_PROMPT,
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
          log.warn('Failed to parse structured output JSON');
          return { memories: [], relations: [] };
        }
      } else {
        log.warn('No JSON found in structured output');
        return { memories: [], relations: [] };
      }
    }

    if (obj.nothing_extracted === true || !obj.memories || !Array.isArray(obj.memories)) {
      return { memories: [], relations: parseRelations(obj) };
    }

    const validCategories = new Set<string>(EXTRACTABLE_CATEGORIES);

    const memories = obj.memories
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

    return { memories, relations: parseRelations(obj) };
  }

  // ── Profile retrieval for injection ──

  async getProfile(agentId: string): Promise<string | undefined> {
    try {
      const { getDb } = await import('../db/connection.js');
      const db = getDb();
      const agent = db.prepare('SELECT metadata FROM agents WHERE id = ?').get(agentId) as { metadata: string | null } | undefined;
      if (agent?.metadata) {
        const meta = JSON.parse(agent.metadata);
        if (meta.profile) return meta.profile;
      }
    } catch {
      // Profile injection is best-effort
    }
    return undefined;
  }
}
