import { createLogger } from '../utils/logger.js';
import { insertMemory, getMemoryById, updateMemory, deleteMemory, upsertRelation, type Memory, type MemoryCategory } from '../db/index.js';
import { detectHighSignals, type DetectedSignal } from '../signals/index.js';
import { parseDuration } from '../utils/helpers.js';
import type { LLMProvider } from '../llm/interface.js';
import type { EmbeddingProvider } from '../embedding/interface.js';
import type { VectorBackend } from '../vector/interface.js';
import type { CortexConfig } from '../utils/config.js';
import { SIEVE_SYSTEM_PROMPT, SMART_UPDATE_SYSTEM_PROMPT, EXTRACTABLE_CATEGORIES } from './prompts.js';
import { parseRelations } from './relation-utils.js';

const log = createLogger('sieve');

/** Legacy fallback threshold when smartUpdate is disabled */
const LEGACY_DEDUP_THRESHOLD = 0.15;

/** Regex to strip injected <cortex_memory> tags and other system metadata */
const INJECTED_TAG_RE = /<cortex_memory>[\s\S]*?<\/cortex_memory>/g;
const SYSTEM_TAG_RE = /<(?:system|context|memory|tool_result|tool_use|function_call|function_result|instructions|artifact|thinking|antThinking)[\s\S]*?<\/(?:system|context|memory|tool_result|tool_use|function_call|function_result|instructions|artifact|thinking|antThinking)>/g;

/** Plain-text metadata prefixes injected by some frameworks */
const PLAIN_META_RE = /^Conversation info \(untrusted metadata\):.*$/gm;
const SYSTEM_PREFIX_RE = /^(?:System (?:info|context|metadata|prompt|instruction)|Conversation (?:info|context|metadata)|Memory context|Previous context|Tool (?:description|instructions)|Image (?:analysis|description) instructions?)[\s(:\-][^\n]*$/gm;

/** Chat-ML / special role markers */
const ROLE_MARKER_RE = /^(?:<\|(?:system|im_start|im_end)\|>|\[(?:SYSTEM|INST|\/INST|SYS|\/SYS)\]|Human:|Assistant:|<<SYS>>|<<\/SYS>>)[^\n]*$/gm;

/** Tool/capability instructions injected by frameworks (OpenClaw, etc.) */
const TOOL_INSTRUCTION_RE = /^(?:To (?:send|upload|share|create|use|handle|process|generate|render|display|format|attach|include)\b[^\n]*\b(?:tool|function|method|API|endpoint|format|command|provider|message)\b[^\n]*|(?:Prefer|Use|Always use|When possible,? use)\b[^\n]*\b(?:tool|function|method|format)\b[^\n]*|(?:Note|Important|Warning|Tip):\s*(?:When|If|To|For)\s[^\n]*\b(?:tool|API|function|MCP|message|provider)\b[^\n]*)$/gmi;

/** Capability description lines (e.g. "I can analyze images", "This tool supports...") */
const CAPABILITY_RE = /^(?:(?:I|This (?:tool|assistant|model|system)) (?:can|support|am able to|will|allow)\b[^\n]{10,}|(?:Supported|Available|Enabled) (?:features|capabilities|tools|formats|options)[:\s][^\n]*)$/gmi;

/** Strip markdown code fences (```json ... ```) from LLM output */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  // Match ```json or ``` at start and ``` at end
  const match = trimmed.match(/^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```$/);
  return match ? match[1]!.trim() : trimmed;
}

/** Strip all injected system tags from text to prevent nested pollution */
function stripInjectedContent(text: string): string {
  return text
    .replace(INJECTED_TAG_RE, '')
    .replace(SYSTEM_TAG_RE, '')
    .replace(PLAIN_META_RE, '')
    .replace(SYSTEM_PREFIX_RE, '')
    .replace(ROLE_MARKER_RE, '')
    .replace(TOOL_INSTRUCTION_RE, '')
    .replace(CAPABILITY_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface ExtractedMemory {
  content: string;
  category: MemoryCategory;
  importance: number;
  source: 'user_stated' | 'user_implied' | 'observed_pattern';
  reasoning: string;
}

export interface ExtractedRelation {
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  expired?: boolean;
}

export const VALID_PREDICATES = new Set([
  'uses', 'works_at', 'lives_in', 'knows', 'manages', 'belongs_to',
  'created', 'prefers', 'studies', 'skilled_in', 'collaborates_with',
  'reports_to', 'owns', 'interested_in', 'related_to',
  // Negative predicates for conflict modeling
  'not_uses', 'not_interested_in', 'dislikes',
]);

export interface SimilarMemory {
  memory: Memory;
  distance: number;
}

export interface SmartUpdateDecision {
  action: 'keep' | 'replace' | 'merge';
  merged_content?: string;
  reasoning: string;
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
  constructor(
    private llm: LLMProvider,
    private embeddingProvider: EmbeddingProvider,
    private vectorBackend: VectorBackend,
    private config: CortexConfig,
  ) {}

  async ingest(req: IngestRequest): Promise<IngestResponse> {
    const agentId = req.agent_id || 'default';

    // Build multi-turn messages if provided, otherwise fall back to single pair
    let cleanMessages: Array<{ role: 'user' | 'assistant'; content: string }> | undefined;
    if (req.messages && req.messages.length > 0) {
      cleanMessages = req.messages
        .map(m => ({ role: m.role, content: stripInjectedContent(m.content) }))
        .filter(m => m.content.length >= 3);
      if (cleanMessages.length === 0) cleanMessages = undefined;
    }

    // Strip injected tags FIRST to prevent nested pollution
    const cleanUser = stripInjectedContent(req.user_message);
    const cleanAssistant = stripInjectedContent(req.assistant_message);

    // Skip if nothing left after stripping
    if (!cleanUser || cleanUser.length < 3) {
      log.info({ agent_id: agentId }, 'Ingest skipped: empty after tag stripping');
      return { extracted: [], high_signals: [], structured_extractions: [], deduplicated: 0, smart_updated: 0, extraction_logs: [] };
    }

    const exchange = { user: cleanUser, assistant: cleanAssistant, messages: cleanMessages };
    const extracted: Memory[] = [];
    let deduplicated = 0;
    let smartUpdated = 0;
    const extractionLogs: ExtractionLogData[] = [];

    // --- Parallel or sequential execution of fast + deep channels ---
    const parallel = this.config.sieve.parallelChannels;

    const fastEnabled = this.config.sieve.fastChannelEnabled;

    if (parallel) {
      // Parallel: run both channels concurrently
      const promises: [Promise<any>, Promise<any>] = [
        fastEnabled
          ? this.runFastChannel(exchange, agentId, req.session_id)
          : Promise.resolve({ signals: [], extracted: [], deduplicated: 0, smart_updated: 0 }),
        this.runDeepChannel(exchange, agentId, req.session_id),
      ];
      const [signalResult, deepResult] = await Promise.allSettled(promises);

      // Collect fast channel results
      let fastSignals: DetectedSignal[] = [];
      let fastExtracted: Memory[] = [];
      let fastDedup = 0;
      let fastSmartUpdated = 0;
      if (signalResult.status === 'fulfilled') {
        fastSignals = signalResult.value.signals;
        fastExtracted = signalResult.value.extracted;
        fastDedup = signalResult.value.deduplicated;
        fastSmartUpdated = signalResult.value.smart_updated;
        if (signalResult.value.extractionLog) extractionLogs.push(signalResult.value.extractionLog);
      }

      // Collect deep channel results
      let deepExtracted: Memory[] = [];
      let deepDedup = 0;
      let deepSmartUpdated = 0;
      let structuredExtractions: ExtractedMemory[] = [];
      if (deepResult.status === 'fulfilled') {
        deepExtracted = deepResult.value.extracted;
        deepDedup = deepResult.value.deduplicated;
        deepSmartUpdated = deepResult.value.smart_updated;
        structuredExtractions = deepResult.value.structuredExtractions;
        extractionLogs.push(deepResult.value.extractionLog);
      }

      // Cross-dedup: remove deep channel items that duplicate fast channel items
      const crossDedup = await this.crossDedup(fastExtracted, deepExtracted, agentId);

      extracted.push(...fastExtracted, ...crossDedup.kept);
      deduplicated = fastDedup + deepDedup + crossDedup.removed;
      smartUpdated = fastSmartUpdated + deepSmartUpdated;

      log.info({
        agent_id: agentId,
        high_signals: fastSignals.length,
        deep_extractions: structuredExtractions.length,
        extracted: extracted.length,
        deduplicated,
        smart_updated: smartUpdated,
      }, 'Ingest completed (parallel)');

      return {
        extracted,
        high_signals: fastSignals,
        structured_extractions: structuredExtractions,
        deduplicated,
        smart_updated: smartUpdated,
        extraction_logs: extractionLogs,
      };
    }

    // Sequential execution (default fallback if parallel disabled)
    // 1. High signal detection (regex, no LLM) — skipped if fast channel disabled
    const highSignals = fastEnabled ? detectHighSignals(exchange) : [];

    // 2. Write high signals immediately to Core (with dedup/smart-update check)
    if (this.config.sieve.highSignalImmediate && highSignals.length > 0) {
      for (const signal of highSignals) {
        try {
          const result = await this.processNewMemory(
            { content: signal.content, category: signal.category, importance: signal.importance, source: 'user_stated', reasoning: '' },
            agentId, req.session_id, signal.confidence,
          );
          if (result.action === 'skipped') { deduplicated++; continue; }
          if (result.action === 'smart_updated') { smartUpdated++; }
          if (result.memory) extracted.push(result.memory);
        } catch (e: any) {
          log.error({ error: e.message }, 'Failed to write high signal');
        }
      }
    }

    // 3. LLM structured extraction
    let structuredExtractions: ExtractedMemory[] = [];
    let seqExtractedRelations: ExtractedRelation[] = [];
    const deepStart = Date.now();
    let rawOutput = '';

    try {
      const profileContext = this.config.sieve.profileInjection
        ? await this.getProfile(agentId)
        : undefined;
      const result = await this.extractStructuredRaw(exchange, profileContext);
      rawOutput = result.raw;
      structuredExtractions = result.parsed;
      seqExtractedRelations = result.relations;
    } catch (e: any) {
      log.warn({ error: e.message }, 'LLM structured extraction failed');
    }

    const deepLatency = Date.now() - deepStart;
    let deepWritten = 0;
    let deepDeduped = 0;
    let deepSmartUpdated = 0;

    // Write structured extractions
    for (const mem of structuredExtractions) {
      try {
        const result = await this.processNewMemory(mem, agentId, req.session_id);
        if (result.action === 'skipped') { deepDeduped++; deduplicated++; continue; }
        if (result.action === 'smart_updated') { deepSmartUpdated++; smartUpdated++; }
        if (result.memory) { extracted.push(result.memory); deepWritten++; }
      } catch (e: any) {
        log.error({ error: e.message, category: mem.category }, 'Failed to write structured extraction');
      }
    }

    // Write extracted relations (sequential mode)
    if (this.config.sieve.relationExtraction && seqExtractedRelations.length > 0) {
      const firstMemoryId = extracted.length > 0 ? extracted[0]!.id : null;
      for (const rel of seqExtractedRelations) {
        try {
          upsertRelation({
            subject: rel.subject,
            predicate: rel.predicate,
            object: rel.object,
            confidence: rel.confidence,
            source_memory_id: firstMemoryId,
            agent_id: agentId,
            source: 'extraction',
            expired: rel.expired ? 1 : 0,
          });
        } catch (e: any) {
          log.warn({ error: e.message }, 'Failed to upsert relation');
        }
      }
    }

    const seqPreview = exchange.messages && exchange.messages.length > 0
      ? exchange.messages.map((m: any) => `[${m.role}] ${m.content.slice(0, 60)}`).join(' → ').slice(0, 300)
      : cleanUser.slice(0, 200);
    extractionLogs.push({
      channel: 'deep',
      exchange_preview: seqPreview,
      raw_output: rawOutput,
      parsed_memories: structuredExtractions,
      memories_written: deepWritten,
      memories_deduped: deepDeduped,
      memories_smart_updated: deepSmartUpdated,
      latency_ms: deepLatency,
    });

    log.info({
      agent_id: agentId,
      high_signals: highSignals.length,
      deep_extractions: structuredExtractions.length,
      extracted: extracted.length,
      deduplicated,
      smart_updated: smartUpdated,
    }, 'Ingest completed');

    return {
      extracted,
      high_signals: highSignals,
      structured_extractions: structuredExtractions,
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
      for (const signal of signals) {
        try {
          const result = await this.processNewMemory(
            { content: signal.content, category: signal.category, importance: signal.importance, source: 'user_stated', reasoning: '' },
            agentId, sessionId, signal.confidence,
          );
          if (result.action === 'skipped') { deduplicated++; continue; }
          if (result.action === 'smart_updated') { smart_updated++; }
          if (result.memory) extracted.push(result.memory);
        } catch (e: any) {
          log.error({ error: e.message }, 'Fast channel: failed to write signal');
        }
      }
    }

    // Generate extraction log for fast channel if signals were detected
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
    for (const mem of structuredExtractions) {
      try {
        const result = await this.processNewMemory(mem, agentId, sessionId);
        if (result.action === 'skipped') { deduplicated++; continue; }
        if (result.action === 'smart_updated') { smart_updated++; }
        if (result.memory) { extracted.push(result.memory); written++; }
      } catch (e: any) {
        log.error({ error: e.message }, 'Deep channel: failed to write extraction');
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

    // Build exchange preview: show multi-turn messages if available, otherwise just user message
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

  // ── Cross-dedup: remove deep items that duplicate fast items ──

  private async crossDedup(
    fastExtracted: Memory[],
    deepExtracted: Memory[],
    _agentId: string,
  ): Promise<{ kept: Memory[]; removed: number }> {
    if (fastExtracted.length === 0 || deepExtracted.length === 0) {
      return { kept: deepExtracted, removed: 0 };
    }

    const kept: Memory[] = [];
    let removed = 0;

    for (const deepMem of deepExtracted) {
      let isDup = false;
      try {
        const deepEmb = await this.embeddingProvider.embed(deepMem.content);
        if (deepEmb.length > 0) {
          for (const fastMem of fastExtracted) {
            const fastEmb = await this.embeddingProvider.embed(fastMem.content);
            if (fastEmb.length > 0) {
              // Cosine distance check
              let dot = 0, normA = 0, normB = 0;
              for (let i = 0; i < deepEmb.length; i++) {
                dot += deepEmb[i]! * fastEmb[i]!;
                normA += deepEmb[i]! * deepEmb[i]!;
                normB += fastEmb[i]! * fastEmb[i]!;
              }
              const distance = 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
              if (distance < this.config.sieve.exactDupThreshold) {
                isDup = true;
                break;
              }
            }
          }
        }
      } catch {
        // Best-effort dedup
      }

      if (isDup) {
        // Actually remove the deep extraction from DB and vector store
        try {
          deleteMemory(deepMem.id);
          await this.vectorBackend.delete([deepMem.id]);
        } catch (e: any) {
          log.warn({ id: deepMem.id, error: e.message }, 'Cross-dedup: failed to delete duplicate');
        }
        removed++;
        log.info({ id: deepMem.id, content: deepMem.content.slice(0, 50) }, 'Cross-dedup: deep item deleted');
      } else {
        kept.push(deepMem);
      }
    }

    return { kept, removed };
  }

  // ── Core extraction logic ──

  private async extractStructuredRaw(
    exchange: { user: string; assistant: string; messages?: Array<{ role: 'user' | 'assistant'; content: string }> },
    profileContext?: string,
  ): Promise<{ raw: string; parsed: ExtractedMemory[]; relations: ExtractedRelation[] }> {
    let conversationBlock: string;

    const totalLimit = this.config.sieve.maxConversationChars;

    if (exchange.messages && exchange.messages.length > 0) {
      // Multi-turn mode: dynamically allocate per-message limits based on total budget
      // User messages get ~65% of budget, assistant ~35%
      const msgCount = exchange.messages.length;
      const userBudget = Math.floor(totalLimit * 0.65 / Math.max(1, Math.ceil(msgCount / 2)));
      const assistantBudget = Math.floor(totalLimit * 0.35 / Math.max(1, Math.floor(msgCount / 2)));
      const parts: string[] = [];
      let totalLen = 0;
      for (const m of exchange.messages) {
        const isUser = m.role === 'user';
        const label = isUser ? '[USER]' : '[ASSISTANT]';
        const maxLen = isUser ? userBudget : assistantBudget;
        const slice = m.content.slice(0, maxLen);
        const line = `${label}\n${slice}`;
        if (totalLen + line.length > totalLimit) break;
        parts.push(line);
        totalLen += line.length;
      }
      conversationBlock = parts.join('\n\n');
    } else {
      // Single-turn mode (backward compatible)
      const userSlice = exchange.user.slice(0, Math.floor(totalLimit * 0.65));
      const assistantSlice = exchange.assistant.slice(0, Math.floor(totalLimit * 0.35));
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
    // Strip markdown code fences first (LLMs often wrap JSON in ```json ... ```)
    const trimmed = stripCodeFences(raw);

    // Try direct JSON.parse
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      // Fallback: extract JSON from embedded text
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

    // Handle nothing_extracted
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

  // parseRelations is now imported from ./relation-utils.js

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

  // ── Smart Update: three-tier matching ──

  /**
   * Find similar memories via vector search.
   * Returns top-K similar memories with distances.
   */
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

  /**
   * Ask LLM to decide: keep, replace, or merge.
   */
  private async smartUpdateDecision(existing: Memory, newContent: string): Promise<SmartUpdateDecision> {
    const prompt = `EXISTING MEMORY:\n${existing.content}\n\nNEW MEMORY:\n${newContent}`;
    try {
      const raw = await this.llm.complete(prompt, {
        maxTokens: 300,
        temperature: 0.1,
        systemPrompt: SMART_UPDATE_SYSTEM_PROMPT,
      });

      const trimmed = stripCodeFences(raw);
      let obj: any;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        const jsonMatch = trimmed.match(/\{[\s\S]*"action"[\s\S]*\}/);
        if (jsonMatch) obj = JSON.parse(jsonMatch[0]);
        else return { action: 'replace', reasoning: 'Failed to parse LLM response, defaulting to replace' };
      }

      const action = ['keep', 'replace', 'merge'].includes(obj.action) ? obj.action : 'replace';
      return {
        action: action as SmartUpdateDecision['action'],
        merged_content: obj.merged_content,
        reasoning: obj.reasoning || '',
      };
    } catch (e: any) {
      log.warn({ error: e.message }, 'Smart update LLM call failed, defaulting to replace');
      return { action: 'replace', reasoning: 'LLM call failed' };
    }
  }

  /**
   * Execute a smart update decision: replace or merge.
   * Sets superseded_by on the old memory and creates/indexes the new one.
   */
  private async executeSmartUpdate(
    decision: SmartUpdateDecision,
    existing: Memory,
    extraction: ExtractedMemory,
    agentId: string,
    sessionId?: string,
    confidenceOverride?: number,
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
      confidence: confidenceOverride ?? 0.8,
      agent_id: agentId,
      source: sessionId ? `session:${sessionId}` : 'sieve',
      expires_at: expiresAt,
      metadata: JSON.stringify(metadata),
    });

    // Mark old memory as superseded
    updateMemory(existing.id, { superseded_by: newMem.id });

    // Index the new memory's vector
    await this.indexVector(newMem.id, content);

    log.info({
      action: decision.action,
      old_id: existing.id,
      new_id: newMem.id,
      reasoning: decision.reasoning,
    }, 'Smart update executed');

    return newMem;
  }

  /**
   * Unified entry point for processing a new memory extraction.
   * Implements three-tier matching:
   *   distance < exactDupThreshold  → exact duplicate, skip
   *   distance < similarityThreshold → semantic overlap, LLM decides
   *   distance >= similarityThreshold → unrelated, normal insert
   *
   * When smartUpdate=false, falls back to legacy behavior (distance < 0.15 → skip).
   */
  async processNewMemory(
    extraction: ExtractedMemory,
    agentId: string,
    sessionId?: string,
    confidenceOverride?: number,
  ): Promise<{ action: 'inserted' | 'skipped' | 'smart_updated'; memory?: Memory }> {
    const { smartUpdate, exactDupThreshold, similarityThreshold } = this.config.sieve;

    // Corrections get a wider similarity window (1.5x) to better find the memory they're correcting
    const effectiveThreshold = extraction.category === 'correction'
      ? Math.min(similarityThreshold * 1.5, 0.6)
      : similarityThreshold;

    // Find similar memories
    const similar = await this.findSimilar(extraction.content, agentId);

    if (!smartUpdate) {
      // Legacy behavior: simple threshold skip
      if (similar.length > 0 && similar[0]!.distance < LEGACY_DEDUP_THRESHOLD) {
        return { action: 'skipped' };
      }
      // Normal insert
      const mem = this.insertNewMemory(extraction, agentId, sessionId, confidenceOverride);
      await this.indexVector(mem.id, extraction.content);
      return { action: 'inserted', memory: mem };
    }

    // Three-tier matching
    if (similar.length > 0) {
      const closest = similar[0]!;

      // Cross-family check: agent_* categories and user categories represent different perspectives
      // and should be allowed to coexist even when semantically similar
      const newIsAgent = extraction.category.startsWith('agent_');
      const existingIsAgent = closest.memory.category.startsWith('agent_');
      const crossFamily = newIsAgent !== existingIsAgent;

      if (!crossFamily && closest.distance < exactDupThreshold) {
        // Tier 1: exact duplicate → skip (only within same family)
        log.info({ distance: closest.distance, existing_id: closest.memory.id }, 'Exact duplicate, skipping');
        return { action: 'skipped' };
      }

      if (!crossFamily && closest.distance < effectiveThreshold) {
        // Tier 2: semantic overlap → LLM decides (only within same family)
        const decision = await this.smartUpdateDecision(closest.memory, extraction.content);

        if (decision.action === 'keep') {
          log.info({ existing_id: closest.memory.id, reasoning: decision.reasoning }, 'Smart update: keep existing');
          return { action: 'skipped' };
        }

        // replace or merge
        const newMem = await this.executeSmartUpdate(
          decision, closest.memory, extraction, agentId, sessionId, confidenceOverride,
        );
        return { action: 'smart_updated', memory: newMem };
      }
    }

    // Tier 3: unrelated → normal insert
    const mem = this.insertNewMemory(extraction, agentId, sessionId, confidenceOverride);
    await this.indexVector(mem.id, extraction.content);
    return { action: 'inserted', memory: mem };
  }

  /**
   * Insert a new memory (shared helper for normal inserts).
   */
  private insertNewMemory(
    extraction: ExtractedMemory,
    agentId: string,
    sessionId?: string,
    confidenceOverride?: number,
  ): Memory {
    const layer = extraction.importance >= 0.8 ? 'core' : 'working';
    const ttlMs = parseDuration(this.config.layers.working.ttl);
    const expiresAt = layer === 'working' ? new Date(Date.now() + ttlMs).toISOString() : undefined;

    return insertMemory({
      layer,
      category: extraction.category,
      content: extraction.content,
      importance: extraction.importance,
      confidence: confidenceOverride ?? 0.8,
      agent_id: agentId,
      source: sessionId ? `session:${sessionId}` : 'sieve',
      expires_at: expiresAt,
      metadata: JSON.stringify({ extraction_source: extraction.source, reasoning: extraction.reasoning }),
    });
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
