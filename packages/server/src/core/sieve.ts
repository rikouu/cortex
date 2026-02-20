import { createLogger } from '../utils/logger.js';
import { insertMemory, getMemoryById, deleteMemory, type Memory, type MemoryCategory } from '../db/index.js';
import { detectHighSignals, type DetectedSignal } from '../signals/index.js';
import { parseDuration } from '../utils/helpers.js';
import type { LLMProvider } from '../llm/interface.js';
import type { EmbeddingProvider } from '../embedding/interface.js';
import type { VectorBackend } from '../vector/interface.js';
import type { CortexConfig } from '../utils/config.js';
import { SIEVE_SYSTEM_PROMPT, EXTRACTABLE_CATEGORIES } from './prompts.js';

const log = createLogger('sieve');

/** Vector distance threshold for dedup (lower = more similar, 0 = identical) */
const DEDUP_DISTANCE_THRESHOLD = 0.15;

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

export interface ExtractedMemory {
  content: string;
  category: MemoryCategory;
  importance: number;
  source: 'user_stated' | 'user_implied' | 'observed_pattern';
  reasoning: string;
}

export interface ExtractionLogData {
  channel: 'fast' | 'deep' | 'flush';
  exchange_preview: string;
  raw_output: string;
  parsed_memories: ExtractedMemory[];
  memories_written: number;
  memories_deduped: number;
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
  extraction_log?: ExtractionLogData;
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
      return { extracted: [], high_signals: [], structured_extractions: [], deduplicated: 0 };
    }

    const exchange = { user: cleanUser, assistant: cleanAssistant, messages: cleanMessages };
    const extracted: Memory[] = [];
    let deduplicated = 0;
    let extractionLog: ExtractionLogData | undefined;

    // --- Parallel or sequential execution of fast + deep channels ---
    const parallel = this.config.sieve.parallelChannels;

    if (parallel) {
      // Parallel: run both channels concurrently
      const [signalResult, deepResult] = await Promise.allSettled([
        this.runFastChannel(exchange, agentId, req.session_id),
        this.runDeepChannel(exchange, agentId, req.session_id),
      ]);

      // Collect fast channel results
      let fastSignals: DetectedSignal[] = [];
      let fastExtracted: Memory[] = [];
      let fastDedup = 0;
      if (signalResult.status === 'fulfilled') {
        fastSignals = signalResult.value.signals;
        fastExtracted = signalResult.value.extracted;
        fastDedup = signalResult.value.deduplicated;
      }

      // Collect deep channel results
      let deepExtracted: Memory[] = [];
      let deepDedup = 0;
      let structuredExtractions: ExtractedMemory[] = [];
      if (deepResult.status === 'fulfilled') {
        deepExtracted = deepResult.value.extracted;
        deepDedup = deepResult.value.deduplicated;
        structuredExtractions = deepResult.value.structuredExtractions;
        extractionLog = deepResult.value.extractionLog;
      }

      // Cross-dedup: remove deep channel items that duplicate fast channel items
      const crossDedup = await this.crossDedup(fastExtracted, deepExtracted, agentId);

      extracted.push(...fastExtracted, ...crossDedup.kept);
      deduplicated = fastDedup + deepDedup + crossDedup.removed;

      log.info({
        agent_id: agentId,
        high_signals: fastSignals.length,
        deep_extractions: structuredExtractions.length,
        extracted: extracted.length,
        deduplicated,
      }, 'Ingest completed (parallel)');

      return {
        extracted,
        high_signals: fastSignals,
        structured_extractions: structuredExtractions,
        deduplicated,
        extraction_log: extractionLog,
      };
    }

    // Sequential execution (default fallback if parallel disabled)
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

    // 3. LLM structured extraction
    let structuredExtractions: ExtractedMemory[] = [];
    const deepStart = Date.now();
    let rawOutput = '';

    try {
      const profileContext = this.config.sieve.profileInjection
        ? await this.getProfile(agentId)
        : undefined;
      const result = await this.extractStructuredRaw(exchange, profileContext);
      rawOutput = result.raw;
      structuredExtractions = result.parsed;
    } catch (e: any) {
      log.warn({ error: e.message }, 'LLM structured extraction failed');
    }

    const deepLatency = Date.now() - deepStart;
    let deepWritten = 0;
    let deepDeduped = 0;

    // Write structured extractions
    for (const mem of structuredExtractions) {
      try {
        const isDup = await this.isDuplicate(mem.content, agentId);
        if (isDup) {
          deepDeduped++;
          deduplicated++;
          continue;
        }

        const layer = mem.importance >= 0.8 ? 'core' : 'working';
        const ttlMs = parseDuration(this.config.layers.working.ttl);
        const expiresAt = layer === 'working' ? new Date(Date.now() + ttlMs).toISOString() : undefined;

        const written = insertMemory({
          layer,
          category: mem.category,
          content: mem.content,
          importance: mem.importance,
          confidence: 0.8,
          agent_id: agentId,
          source: req.session_id ? `session:${req.session_id}` : 'sieve',
          expires_at: expiresAt,
          metadata: JSON.stringify({ extraction_source: mem.source, reasoning: mem.reasoning }),
        });
        extracted.push(written);
        await this.indexVector(written.id, mem.content);
        deepWritten++;
        log.info({ category: mem.category, importance: mem.importance, layer }, 'Structured extraction -> Memory');
      } catch (e: any) {
        log.error({ error: e.message, category: mem.category }, 'Failed to write structured extraction');
      }
    }

    extractionLog = {
      channel: 'deep',
      exchange_preview: cleanUser.slice(0, 200),
      raw_output: rawOutput,
      parsed_memories: structuredExtractions,
      memories_written: deepWritten,
      memories_deduped: deepDeduped,
      latency_ms: deepLatency,
    };

    log.info({
      agent_id: agentId,
      high_signals: highSignals.length,
      deep_extractions: structuredExtractions.length,
      extracted: extracted.length,
      deduplicated,
    }, 'Ingest completed');

    return {
      extracted,
      high_signals: highSignals,
      structured_extractions: structuredExtractions,
      deduplicated,
      extraction_log: extractionLog,
    };
  }

  // ── Fast channel: regex-based high signal detection ──

  private async runFastChannel(
    exchange: { user: string; assistant: string; messages?: Array<{ role: 'user' | 'assistant'; content: string }> },
    agentId: string,
    sessionId?: string,
  ): Promise<{ signals: DetectedSignal[]; extracted: Memory[]; deduplicated: number }> {
    const signals = detectHighSignals(exchange);
    const extracted: Memory[] = [];
    let deduplicated = 0;

    if (this.config.sieve.highSignalImmediate && signals.length > 0) {
      for (const signal of signals) {
        try {
          const isDup = await this.isDuplicate(signal.content, agentId);
          if (isDup) {
            deduplicated++;
            continue;
          }

          const mem = insertMemory({
            layer: 'core',
            category: signal.category,
            content: signal.content,
            importance: signal.importance,
            confidence: signal.confidence,
            agent_id: agentId,
            source: sessionId ? `session:${sessionId}` : 'sieve',
          });
          extracted.push(mem);
          await this.indexVector(mem.id, signal.content);
        } catch (e: any) {
          log.error({ error: e.message }, 'Fast channel: failed to write signal');
        }
      }
    }

    return { signals, extracted, deduplicated };
  }

  // ── Deep channel: LLM structured extraction ──

  private async runDeepChannel(
    exchange: { user: string; assistant: string; messages?: Array<{ role: 'user' | 'assistant'; content: string }> },
    agentId: string,
    sessionId?: string,
  ): Promise<{
    extracted: Memory[];
    deduplicated: number;
    structuredExtractions: ExtractedMemory[];
    extractionLog: ExtractionLogData;
  }> {
    const extracted: Memory[] = [];
    let deduplicated = 0;
    let structuredExtractions: ExtractedMemory[] = [];
    const start = Date.now();
    let rawOutput = '';

    try {
      const profileContext = this.config.sieve.profileInjection
        ? await this.getProfile(agentId)
        : undefined;
      const result = await this.extractStructuredRaw(exchange, profileContext);
      rawOutput = result.raw;
      structuredExtractions = result.parsed;
    } catch (e: any) {
      log.warn({ error: e.message }, 'Deep channel: LLM extraction failed');
    }

    let written = 0;
    for (const mem of structuredExtractions) {
      try {
        const isDup = await this.isDuplicate(mem.content, agentId);
        if (isDup) {
          deduplicated++;
          continue;
        }

        const layer = mem.importance >= 0.8 ? 'core' : 'working';
        const ttlMs = parseDuration(this.config.layers.working.ttl);
        const expiresAt = layer === 'working' ? new Date(Date.now() + ttlMs).toISOString() : undefined;

        const writtenMem = insertMemory({
          layer,
          category: mem.category,
          content: mem.content,
          importance: mem.importance,
          confidence: 0.8,
          agent_id: agentId,
          source: sessionId ? `session:${sessionId}` : 'sieve',
          expires_at: expiresAt,
          metadata: JSON.stringify({ extraction_source: mem.source, reasoning: mem.reasoning }),
        });
        extracted.push(writtenMem);
        await this.indexVector(writtenMem.id, mem.content);
        written++;
      } catch (e: any) {
        log.error({ error: e.message }, 'Deep channel: failed to write extraction');
      }
    }

    const latency = Date.now() - start;

    return {
      extracted,
      deduplicated,
      structuredExtractions,
      extractionLog: {
        channel: 'deep',
        exchange_preview: exchange.user.slice(0, 200),
        raw_output: rawOutput,
        parsed_memories: structuredExtractions,
        memories_written: written,
        memories_deduped: deduplicated,
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
              if (distance < DEDUP_DISTANCE_THRESHOLD) {
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
  ): Promise<{ raw: string; parsed: ExtractedMemory[] }> {
    let conversationBlock: string;

    if (exchange.messages && exchange.messages.length > 0) {
      // Multi-turn mode: format each message with role labels, total limit 3000 chars
      const parts: string[] = [];
      let totalLen = 0;
      for (const m of exchange.messages) {
        const label = m.role === 'user' ? '[USER]' : '[ASSISTANT]';
        const slice = m.content.slice(0, 1500);
        const line = `${label} ${slice}`;
        if (totalLen + line.length > 3000) break;
        parts.push(line);
        totalLen += line.length;
      }
      conversationBlock = parts.join('\n\n');
    } else {
      // Single-turn mode (backward compatible)
      const userSlice = exchange.user.slice(0, 1500);
      const assistantSlice = exchange.assistant.slice(0, 1500);
      conversationBlock = `[USER] ${userSlice}\n\n[ASSISTANT] ${assistantSlice}`;
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

    const parsed = this.parseStructuredOutput(raw);
    return { raw, parsed };
  }

  private parseStructuredOutput(raw: string): ExtractedMemory[] {
    const trimmed = raw.trim();

    // Try direct JSON.parse
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      // Fallback: extract JSON from markdown code block or embedded JSON
      const jsonMatch = trimmed.match(/\{[\s\S]*"memories"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          obj = JSON.parse(jsonMatch[0]);
        } catch {
          log.warn('Failed to parse structured output JSON');
          return [];
        }
      } else {
        log.warn('No JSON found in structured output');
        return [];
      }
    }

    // Handle nothing_extracted
    if (obj.nothing_extracted === true || !obj.memories || !Array.isArray(obj.memories)) {
      return [];
    }

    const validCategories = new Set<string>(EXTRACTABLE_CATEGORIES);

    return obj.memories
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
