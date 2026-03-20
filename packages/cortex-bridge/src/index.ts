/**
 * Cortex Bridge Plugin for OpenClaw
 *
 * Conforms to OpenClaw's register(api) plugin interface.
 * Provides tools + best-effort hooks for Cortex memory integration.
 *
 * Strategy: Tools are the primary interface (reliable), hooks are best-effort
 * (may not fire for kind:"tool" plugins in current OpenClaw versions).
 */

// ── Plugin version ──────────────────────────────────────
const PLUGIN_VERSION = '0.5.1';

// ── Timeouts ────────────────────────────────────────────
const RECALL_TIMEOUT = 8000;
const INGEST_TIMEOUT = 5000;
const FLUSH_TIMEOUT = 5000;
const HEALTH_TIMEOUT = 2000;

// ── OpenClaw Plugin API types (minimal subset) ──────────
interface PluginApi {
  pluginConfig: Record<string, any>;
  logger: { info: (...args: any[]) => void; warn: (...args: any[]) => void; error: (...args: any[]) => void };
  on(event: string, handler: (event: any, ctx?: any) => any): void;
  on(event: string, opts: any, handler: (event: any, ctx?: any) => any): void;
  registerTool(tool: {
    name: string;
    description: string;
    parameters: any;
    execute: (id: string, params: any) => Promise<any>;
  }, opts?: { optional?: boolean }): void;
  registerCommand(cmd: {
    name: string;
    description: string;
    acceptsArgs?: boolean;
    handler: (ctx: any) => Promise<{ text: string }>;
  }): void;
  registerService(svc: { id: string; start: () => Promise<void>; stop: () => Promise<void> }): void;
}

// ── Content extraction ──────────────────────────────────
// OpenClaw messages use multimodal format: content can be string OR
// [{type: "text", text: "..."}, {type: "image", ...}, {type: "tool_use", ...}]
function extractText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // Only keep plain text blocks — skip tool_use, tool_result, image, etc.
    return content
      .filter((b: any) => b.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('\n');
  }
  if (content && typeof content === 'object' && typeof content.text === 'string') {
    return content.text;
  }
  return '';
}

// ── Content cleaning for ingestion ──────────────────────
// Aggressively strip noise from conversation text before sending to Cortex.
// Goal: only send natural language that's meaningful for memory extraction.

// 1. XML-style injected tags
const INJECTED_TAG_RE = /<cortex_memory>[\s\S]*?<\/cortex_memory>/g;
const SYSTEM_TAG_RE = /<(?:system|context|memory|tool_result|function_call|tool_use|thinking|antThinking)[\s\S]*?<\/(?:system|context|memory|tool_result|function_call|tool_use|thinking|antThinking)>/g;

// 2. Markdown fenced code blocks (```lang ... ```)
const CODE_BLOCK_RE = /```[\s\S]*?```/g;

// 3. Inline code that looks like JSON/code fragments
const INLINE_JSON_RE = /`{[^`]*}`/g;

// 4. Standalone JSON objects/arrays (multi-line { ... } or [ ... ] blocks)
const JSON_BLOCK_RE = /^\s*[\[{][\s\S]*?[\]}]\s*$/gm;

// 5. Lines that look like code/logs (common patterns)
const CODE_LINE_RE = /^(\s*(import |export |const |let |var |function |class |if |for |while |return |async |await |try |catch |throw |\$ |> |#!|\/\/ ).*)$/gm;

// 6. Tool call metadata patterns
const TOOL_META_RE = /\b(tool_call_id|message_id|tool_use_id)\s*[:=]\s*["']?[\w-]+["']?/g;

function cleanForIngestion(text: string): string {
  return text
    // Strip XML tags
    .replace(INJECTED_TAG_RE, '')
    .replace(SYSTEM_TAG_RE, '')
    // Strip code blocks (most important — removes JSON, code, logs)
    .replace(CODE_BLOCK_RE, '')
    // Strip inline JSON in backticks
    .replace(INLINE_JSON_RE, '')
    // Strip standalone JSON blocks
    .replace(JSON_BLOCK_RE, '')
    // Strip obvious code lines
    .replace(CODE_LINE_RE, '')
    // Strip tool metadata
    .replace(TOOL_META_RE, '')
    // Clean up markdown artifacts left behind
    .replace(/\*{2,}([^*]*)\*{2,}/g, '$1')  // **bold** → bold
    .replace(/_{2,}([^_]*)_{2,}/g, '$1')     // __underline__ → underline
    // Collapse whitespace
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+$/gm, '')
    .trim();
}

// Quality gate: skip ingestion if cleaned text is too short or fragmented
const MIN_USEFUL_LENGTH = 20;  // at least 20 chars of actual content

function isUsefulForIngestion(text: string): boolean {
  if (text.length < MIN_USEFUL_LENGTH) return false;
  // If text is mostly punctuation/symbols, skip
  const alphaCount = (text.match(/[\p{L}\p{N}]/gu) || []).length;
  return alphaCount >= text.length * 0.3;  // at least 30% letters/numbers
}

// ── Cortex HTTP helpers ─────────────────────────────────
function getCortexUrl(config: Record<string, any>): string {
  return config.cortexUrl || process.env.CORTEX_URL || 'http://localhost:21100';
}

function getAuthToken(config: Record<string, any>): string {
  return (config.authToken as string) || process.env.CORTEX_AUTH_TOKEN || '';
}

function getHeaders(config: Record<string, any>): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getAuthToken(config);
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function isDebug(config: Record<string, any>): boolean {
  return config.debug === true || process.env.CORTEX_DEBUG === 'true';
}

async function cortexRecall(
  cortexUrl: string,
  query: string,
  agentId: string,
  config: Record<string, any> = {},
): Promise<{ context: string; count: number } | null> {
  const res = await fetch(`${cortexUrl}/api/v1/recall`, {
    method: 'POST',
    headers: getHeaders(config),
    body: JSON.stringify({ query, agent_id: agentId }),
    signal: AbortSignal.timeout(RECALL_TIMEOUT),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { context: string; meta: { injected_count: number } };
  if (data.context && data.meta.injected_count > 0) {
    return { context: data.context, count: data.meta.injected_count };
  }
  return null;
}

async function cortexIngest(
  cortexUrl: string,
  userMessage: string,
  assistantMessage: string,
  agentId: string,
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>,
  config: Record<string, any> = {},
): Promise<{ ok: boolean; extracted?: number; deduplicated?: number; error?: string }> {
  try {
    const payload: any = {
      user_message: userMessage,
      assistant_message: assistantMessage,
      agent_id: agentId,
    };
    if (messages && messages.length > 0) {
      payload.messages = messages;
    }
    const res = await fetch(`${cortexUrl}/api/v1/ingest`, {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(INGEST_TIMEOUT),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    try {
      const data = (await res.json()) as any;
      return {
        ok: true,
        extracted: data.extracted?.length ?? 0,
        deduplicated: data.deduplicated ?? 0,
      };
    } catch {
      return { ok: true };
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function cortexFlush(
  cortexUrl: string,
  messages: { role: string; content: string }[],
  agentId: string,
  config: Record<string, any> = {},
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${cortexUrl}/api/v1/flush`, {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify({ messages, agent_id: agentId, reason: 'compaction' }),
      signal: AbortSignal.timeout(FLUSH_TIMEOUT),
    });
    return { ok: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function cortexHealthCheck(cortexUrl: string): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
  const start = Date.now();
  try {
    const res = await fetch(`${cortexUrl}/api/v1/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT) });
    const data = (await res.json()) as any;
    return { ok: data.status === 'ok', latency_ms: Date.now() - start };
  } catch (e) {
    return { ok: false, latency_ms: Date.now() - start, error: (e as Error).message };
  }
}

// ── Plugin export (OpenClaw register(api) interface) ────
export default {
  id: 'cortex-bridge',
  name: 'Cortex Memory Bridge',
  description: 'Long-term memory for OpenClaw powered by Cortex',
  kind: 'tool' as const,
  configSchema: {
    type: 'object',
    properties: {
      cortexUrl: { type: 'string', default: 'http://localhost:21100' },
      agentId: { type: 'string', default: 'openclaw' },
      debug: { type: 'boolean', default: false },
      contextMessages: { type: 'number', default: 4, minimum: 2, maximum: 20 },
    },
  },

  register(api: PluginApi) {
    const config = api.pluginConfig ?? {};
    const cortexUrl = getCortexUrl(config);
    const defaultAgentId = (config.agentId as string) || process.env.CORTEX_AGENT_ID || 'openclaw';
    const debug = isDebug(config);
    const log = api.logger;

    // Resolve agentId: prefer ctx.agentId (per-agent isolation), fallback to config.
    // Per-session cache keyed by sessionId to avoid race conditions in concurrent multi-agent scenarios.
    const sessionAgentMap = new Map<string, string>();
    let lastSessionAgentId = defaultAgentId; // fallback for tools when session unknown

    function resolveAgentId(ctx?: any): string {
      const resolved = ctx?.agentId || defaultAgentId;
      const sessionId = ctx?.sessionId;
      if (sessionId) {
        sessionAgentMap.set(sessionId, resolved);
      }
      lastSessionAgentId = resolved;
      return resolved;
    }

    // For tools: use optional override, then fallback to last known session agent
    function resolveToolAgentId(paramAgentId?: string): string {
      return paramAgentId || lastSessionAgentId;
    }

    log.info(`[cortex-bridge] Registered — Cortex URL: ${cortexUrl}, Agent: ${defaultAgentId}, config keys: ${Object.keys(config).join(',') || '(empty)'}`);

    // ════════════════════════════════════════════════════════
    // TOOLS (primary interface — always work)
    // ════════════════════════════════════════════════════════

    // ── Tool: cortex_recall ─────────────────────────────
    api.registerTool({
      name: 'cortex_recall',
      description: 'Search Cortex long-term memory for relevant past conversations, facts, preferences, constraints, and agent observations. Use this at the start of conversations or when you need context about a topic. Constraints and persona are prioritized in results.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query — describe what you want to recall' },
          agent_id: { type: 'string', description: 'Optional agent ID for memory isolation (defaults to configured agent)' },
        },
        required: ['query'],
      },
      async execute(_id: string, params: { query: string; agent_id?: string }) {
        try {
          const effectiveAgent = resolveToolAgentId(params.agent_id);
          const result = await cortexRecall(cortexUrl, params.query, effectiveAgent, config);
          if (result) {
            return { content: [{ type: 'text', text: result.context }] };
          }
          return { content: [{ type: 'text', text: 'No relevant memories found.' }] };
        } catch (e) {
          return { content: [{ type: 'text', text: `Recall error: ${(e as Error).message}` }] };
        }
      },
    });

    // ── Tool: cortex_remember ───────────────────────────
    api.registerTool({
      name: 'cortex_remember',
      description: 'Store a memory in Cortex long-term memory. Use for facts, preferences, decisions, constraints ("never do X"), policies ("prefer X before Y"), or agent self-observations.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The information to remember — be specific and concise' },
          category: {
            type: 'string',
            description: 'Memory category',
            enum: [
              'identity', 'preference', 'decision', 'fact', 'entity',
              'correction', 'todo', 'skill', 'relationship', 'goal',
              'insight', 'project_state',
              'constraint', 'policy',
              'agent_self_improvement', 'agent_user_habit', 'agent_relationship', 'agent_persona',
            ],
            default: 'fact',
          },
          agent_id: { type: 'string', description: 'Optional agent ID for memory isolation (defaults to configured agent)' },
        },
        required: ['content'],
      },
      async execute(_id: string, params: { content: string; category?: string; agent_id?: string }) {
        try {
          const effectiveAgent = resolveToolAgentId(params.agent_id);
          const res = await fetch(`${cortexUrl}/api/v1/memories`, {
            method: 'POST',
            headers: getHeaders(config),
            body: JSON.stringify({
              content: params.content,
              category: params.category || 'fact',
              agent_id: effectiveAgent,
              layer: 'core',
              importance: 0.7,
              confidence: 0.9,
            }),
            signal: AbortSignal.timeout(INGEST_TIMEOUT),
          });
          if (res.ok) {
            return { content: [{ type: 'text', text: `Remembered: "${params.content}"` }] };
          }
          const err = await res.text();
          return { content: [{ type: 'text', text: `Failed to store memory (${res.status}): ${err}` }] };
        } catch (e) {
          return { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
        }
      },
    });

    // ── Tool: cortex_ingest ─────────────────────────────
    api.registerTool({
      name: 'cortex_ingest',
      description: 'Send a conversation exchange to Cortex for automatic memory extraction via LLM. Extracts facts, preferences, decisions, constraints, policies, and agent self-improvement observations. Use this after meaningful conversations to build long-term memory.',
      parameters: {
        type: 'object',
        properties: {
          user_message: { type: 'string', description: 'What the user said' },
          assistant_message: { type: 'string', description: 'What you (the assistant) replied' },
          agent_id: { type: 'string', description: 'Optional agent ID for memory isolation (defaults to configured agent)' },
        },
        required: ['user_message', 'assistant_message'],
      },
      async execute(_id: string, params: { user_message: string; assistant_message: string; agent_id?: string }) {
        try {
          const effectiveAgent = resolveToolAgentId(params.agent_id);
          const result = await cortexIngest(
            cortexUrl,
            cleanForIngestion(params.user_message),
            cleanForIngestion(params.assistant_message),
            effectiveAgent,
            undefined,
            config,
          );
          if (result.ok) {
            const parts = ['Conversation ingested'];
            if (result.extracted !== undefined) parts.push(`${result.extracted} memories extracted`);
            if (result.deduplicated) parts.push(`${result.deduplicated} deduplicated`);
            return { content: [{ type: 'text', text: parts.join(' — ') + '.' }] };
          }
          return { content: [{ type: 'text', text: `Ingest failed: ${result.error}` }] };
        } catch (e) {
          return { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
        }
      },
    });

    // ── Tool: cortex_relations ──────────────────────────
    api.registerTool(
      {
        name: 'cortex_relations',
        description: 'List entity relationships from Cortex memory (e.g. who knows whom, who uses what). Useful for understanding connections between people, tools, and concepts.',
        parameters: {
          type: 'object',
          properties: {
            subject: { type: 'string', description: 'Filter by subject entity' },
            object: { type: 'string', description: 'Filter by object entity' },
            limit: { type: 'number', description: 'Maximum results to return', default: 20 },
            agent_id: { type: 'string', description: 'Optional agent ID for memory isolation (defaults to configured agent)' },
          },
        },
        async execute(_id: string, params: { subject?: string; object?: string; limit?: number; agent_id?: string }) {
          try {
            const effectiveAgent = resolveToolAgentId(params.agent_id);
            const query = new URLSearchParams();
            if (params.subject) query.set('subject', params.subject);
            if (params.object) query.set('object', params.object);
            if (params.limit) query.set('limit', String(params.limit));
            query.set('agent_id', effectiveAgent);
            const headers: Record<string, string> = {};
            const token = getAuthToken(config);
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const res = await fetch(`${cortexUrl}/api/v1/relations?${query.toString()}`, {
              headers,
              signal: AbortSignal.timeout(RECALL_TIMEOUT),
            });
            if (!res.ok) return { content: [{ type: 'text', text: `Failed to fetch relations: HTTP ${res.status}` }] };
            const data = await res.json() as any[];
            if (data.length === 0) {
              return { content: [{ type: 'text', text: 'No relations found.' }] };
            }
            const formatted = data.map((r: any) => `${r.subject} → ${r.predicate} → ${r.object} (confidence: ${r.confidence})`).join('\n');
            return { content: [{ type: 'text', text: formatted }] };
          } catch (e) {
            return { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
          }
        },
      },
      { optional: true },
    );

    // ── Tool: cortex_health ─────────────────────────────
    api.registerTool(
      {
        name: 'cortex_health',
        description: 'Check if the Cortex memory server is reachable',
        parameters: { type: 'object', properties: {} },
        async execute() {
          const status = await cortexHealthCheck(cortexUrl);
          return { content: [{ type: 'text', text: JSON.stringify(status) }] };
        },
      },
      { optional: true },
    );

    // ── Command: /cortex_status ────────────────────────
    api.registerCommand({
      name: 'cortex_status',
      description: 'Check Cortex memory server status',
      handler: async () => {
        const health = await cortexHealthCheck(cortexUrl);
        if (!health.ok) {
          return { text: `❌ Cortex is offline: ${health.error || 'unknown error'}` };
        }

        // Fetch additional stats
        const lines: string[] = [];
        lines.push(`✅ Cortex is online (${health.latency_ms}ms)`);

        try {
          // Health details (version, uptime)
          const healthRes = await fetch(`${cortexUrl}/api/v1/health`, {
            signal: AbortSignal.timeout(HEALTH_TIMEOUT),
          });
          if (healthRes.ok) {
            const data = (await healthRes.json()) as any;
            if (data.version) lines.push(`📦 Version: ${data.version}`);
            if (data.uptime) {
              const h = Math.floor(data.uptime / 3600);
              const m = Math.floor((data.uptime % 3600) / 60);
              lines.push(`⏱ Uptime: ${h}h ${m}m`);
            }
            if (data.latestRelease?.updateAvailable) {
              lines.push(`🆕 Update available: ${data.latestRelease.version}`);
            }
          }
        } catch { /* ignore */ }

        try {
          // Memory stats
          const statsRes = await fetch(`${cortexUrl}/api/v1/stats?agent_id=${encodeURIComponent(lastSessionAgentId)}`, {
            headers: getHeaders(config),
            signal: AbortSignal.timeout(HEALTH_TIMEOUT),
          });
          if (statsRes.ok) {
            const stats = (await statsRes.json()) as any;
            lines.push(`🧠 Memories: ${stats.total_memories ?? '?'}`);
            if (stats.layers) {
              const layerParts = Object.entries(stats.layers).map(([k, v]) => `${k}: ${v}`);
              lines.push(`📂 Layers: ${layerParts.join(', ')}`);
            }
            if (stats.total_relations) lines.push(`🔗 Relations: ${stats.total_relations}`);
          }
        } catch { /* ignore */ }

        lines.push(`🤖 Agent: ${lastSessionAgentId}`);
        lines.push(`🌐 URL: ${cortexUrl}`);
        lines.push(`🔌 Plugin: v${PLUGIN_VERSION}`);

        // Version compatibility check
        try {
          const healthRes2 = await fetch(`${cortexUrl}/api/v1/health`, {
            signal: AbortSignal.timeout(HEALTH_TIMEOUT),
          });
          if (healthRes2.ok) {
            const hd = (await healthRes2.json()) as any;
            const serverMajor = parseInt((hd.version || '0').split('.')[1] || '0');
            const pluginMajor = parseInt(PLUGIN_VERSION.split('.')[1] || '0');
            if (Math.abs(serverMajor - pluginMajor) > 1) {
              lines.push(`⚠️ 版本差异较大: server v${hd.version} vs plugin v${PLUGIN_VERSION}，建议更新`);
            }
          }
        } catch { /* ignore */ }

        return { text: lines.join('\n') };
      },
    });

    // ── Command: /cortex_search ─────────────────────────
    api.registerCommand({
      name: 'cortex_search',
      description: 'Search Cortex memories by keyword',
      acceptsArgs: true,
      handler: async (ctx: any) => {
        const query = (ctx.args || ctx.text || '').trim();
        if (!query) {
          return { text: '用法: /cortex_search <关键词>' };
        }
        try {
          const res = await fetch(`${cortexUrl}/api/v1/recall`, {
            method: 'POST',
            headers: getHeaders(config),
            body: JSON.stringify({ query, agent_id: lastSessionAgentId }),
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) return { text: `❌ 搜索失败 (HTTP ${res.status})` };
          const data = (await res.json()) as any;
          if (data.context && data.meta?.injected_count > 0) {
            return { text: `🔍 找到 ${data.meta.injected_count} 条相关记忆 (${data.meta.latency_ms}ms):\n\n${data.context}` };
          }
          return { text: '🔍 没有找到相关记忆。' };
        } catch (e) {
          return { text: `❌ 搜索失败: ${(e as Error).message}` };
        }
      },
    });

    // ── Command: /cortex_remember ───────────────────────
    api.registerCommand({
      name: 'cortex_remember',
      description: 'Store a memory in Cortex',
      acceptsArgs: true,
      handler: async (ctx: any) => {
        const content = (ctx.args || ctx.text || '').trim();
        if (!content) {
          return { text: '用法: /cortex_remember <要记住的内容>' };
        }
        try {
          const res = await fetch(`${cortexUrl}/api/v1/memories`, {
            method: 'POST',
            headers: getHeaders(config),
            body: JSON.stringify({
              content,
              category: 'fact',
              agent_id: lastSessionAgentId,
              layer: 'core',
              importance: 0.7,
              confidence: 0.9,
            }),
            signal: AbortSignal.timeout(INGEST_TIMEOUT),
          });
          if (res.ok) {
            return { text: `✅ 已记住: "${content}"` };
          }
          return { text: `❌ 存储失败 (HTTP ${res.status})` };
        } catch (e) {
          return { text: `❌ 存储失败: ${(e as Error).message}` };
        }
      },
    });

    // ── Command: /cortex_recent ─────────────────────────
    api.registerCommand({
      name: 'cortex_recent',
      description: 'Show recent Cortex memories',
      handler: async () => {
        try {
          const headers: Record<string, string> = {};
          const token = getAuthToken(config);
          if (token) headers['Authorization'] = `Bearer ${token}`;
          const res = await fetch(
            `${cortexUrl}/api/v1/memories?agent_id=${encodeURIComponent(lastSessionAgentId)}&limit=10&sort=created_at&order=desc`,
            { headers, signal: AbortSignal.timeout(10000) },
          );
          if (!res.ok) {
            return { text: `❌ 获取失败 (HTTP ${res.status})` };
          }
          const data = (await res.json()) as any;
          const items = data.items || data;
          if (!Array.isArray(items) || items.length === 0) {
            return { text: '📭 暂无记忆。' };
          }
          const lines = items.map((m: any, i: number) => {
            const time = m.created_at ? new Date(m.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '?';
            const cat = m.category || '?';
            const text = (m.content || '').slice(0, 80);
            return `${i + 1}. [${cat}] ${text}${m.content?.length > 80 ? '...' : ''}\n   🕐 ${time}`;
          });
          return { text: `🕐 最近 ${items.length} 条记忆:\n\n${lines.join('\n\n')}` };
        } catch (e) {
          return { text: `❌ 获取失败: ${(e as Error).message}` };
        }
      },
    });

    // ════════════════════════════════════════════════════════
    // HOOKS (best-effort — may not fire for kind:"tool" plugins)
    // ════════════════════════════════════════════════════════

    // ── Hook: before_agent_start → Recall memories ──────
    api.on('before_agent_start', async (event: any, ctx?: any) => {
      try {
        const currentAgentId = resolveAgentId(ctx);
        const rawQuery = extractText(event?.prompt) || '';
        if (!rawQuery) return;

        // Clean the query: strip metadata, code, JSON, system tags
        const query = cleanForIngestion(rawQuery).slice(0, 500);
        if (!query || query.length < 5) return;

        // Try recall with one retry on timeout
        let result = await cortexRecall(cortexUrl, query, currentAgentId, config).catch(() => null);
        if (!result) {
          // Retry once after a short delay
          await new Promise(r => setTimeout(r, 500));
          result = await cortexRecall(cortexUrl, query, currentAgentId, config).catch(() => null);
          if (result && debug) log.info(`[cortex-bridge] Hook recall succeeded on retry`);
        }

        if (result) {
          log.info(`[cortex-bridge] Hook recalled ${result.count} memories`);
          return { prependContext: result.context };
        }
      } catch (e) {
        if (debug) log.warn(`[cortex-bridge] Hook recall failed: ${(e as Error).message}`);
      }
    });

    // ── Hook: agent_end → Ingest conversation ───────────
    // event: { messages: AgentMessage[], success, error?, durationMs? }
    // AgentMessage.content is multimodal: string | {type,text}[]
    const contextMessageCount = Number(config.contextMessages) || 4;

    // Fix #2: Patterns to skip (heartbeats, no-reply, etc.)
    const SKIP_RESPONSE_RE = /^(HEARTBEAT_OK|NO_REPLY|HEARTBEAT_ACKNOWLEDGED)\s*$/i;
    const HEARTBEAT_PROMPT_RE = /HEARTBEAT(?:\.md|_OK)/i;

    // Fix #5: Content-level dedup to avoid repeated ingestion of same content
    // Per-agent hash map for multi-agent isolation
    const lastIngestHashes: Record<string, string> = {};
    function simpleHash(str: string): string {
      let h = 0;
      for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h + str.charCodeAt(i)) | 0;
      }
      return String(h);
    }

    api.on('agent_end', async (event: any, ctx?: any) => {
      try {
        const currentAgentId = resolveAgentId(ctx);
        const allMessages: any[] = event?.messages || [];

        // Filter to user/assistant messages only
        const conversationMsgs = allMessages.filter(
          (m: any) => m.role === 'user' || m.role === 'assistant',
        );

        // Fix #2: Skip heartbeat/no-reply turns before any processing
        const lastRawAssistant = [...conversationMsgs].reverse().find((m: any) => m.role === 'assistant');
        if (lastRawAssistant) {
          const rawText = extractText(lastRawAssistant.content).trim();
          if (SKIP_RESPONSE_RE.test(rawText)) {
            if (debug) log.info('[cortex-bridge] agent_end: skipping heartbeat/no-reply turn');
            return;
          }
        }
        const lastRawUser = [...conversationMsgs].reverse().find((m: any) => m.role === 'user');
        if (lastRawUser) {
          const rawUserText = extractText(lastRawUser.content).trim();
          if (HEARTBEAT_PROMPT_RE.test(rawUserText) && rawUserText.length < 500) {
            if (debug) log.info('[cortex-bridge] agent_end: skipping heartbeat prompt turn');
            return;
          }
        }

        // Fix #5: Group messages into conversation turns (user + assistant pairs)
        // contextMessageCount=4 → take last 2 turns (2 user + 2 assistant messages)
        const turnsToTake = Math.max(1, Math.floor(contextMessageCount / 2));
        const turns: Array<{ user: any; assistant: any }> = [];
        for (let i = conversationMsgs.length - 1; i >= 0 && turns.length < turnsToTake; i--) {
          const msg = conversationMsgs[i];
          if (msg.role === 'assistant') {
            // Look backward for the preceding user message
            const userIdx = conversationMsgs.slice(0, i).reverse().findIndex((m: any) => m.role === 'user');
            if (userIdx >= 0) {
              turns.unshift({ user: conversationMsgs[i - 1 - userIdx], assistant: msg });
              i = i - userIdx; // skip past the user message we just paired
            }
          }
        }

        // Build cleaned messages from turns
        const recentMsgs = turns.flatMap(t => [t.user, t.assistant]).filter(Boolean);
        if (recentMsgs.length === 0) {
          // Fallback to original slice behavior
          const fallbackMsgs = conversationMsgs.slice(-contextMessageCount);
          if (fallbackMsgs.length === 0) return;
          recentMsgs.push(...fallbackMsgs);
        }

        // Clean each message
        const cleanedMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
        for (const m of recentMsgs) {
          const cleaned = cleanForIngestion(extractText(m.content));
          if (isUsefulForIngestion(cleaned)) {
            cleanedMessages.push({ role: m.role as 'user' | 'assistant', content: cleaned });
          }
        }

        if (cleanedMessages.length === 0) {
          if (debug) log.warn('[cortex-bridge] agent_end: no useful messages after cleaning, skipping');
          return;
        }

        // For backward compat, also derive user_message/assistant_message from last pair
        const lastUser = [...cleanedMessages].reverse().find(m => m.role === 'user');
        const lastAssistant = [...cleanedMessages].reverse().find(m => m.role === 'assistant');
        const userText = lastUser?.content || '';
        const assistantText = lastAssistant?.content || '';

        if (!userText || !assistantText) {
          if (debug) log.warn('[cortex-bridge] agent_end: missing user or assistant in last pair, skipping');
          return;
        }

        // Fix #5: Content-level dedup — skip if same user+assistant pair (per-agent)
        const currentHash = simpleHash(userText + '|||' + assistantText);
        if (currentHash === lastIngestHashes[currentAgentId]) {
          if (debug) log.info(`[cortex-bridge] agent_end: skipping duplicate ingest for agent ${currentAgentId}`);
          return;
        }
        lastIngestHashes[currentAgentId] = currentHash;

        let result = await cortexIngest(cortexUrl, userText, assistantText, currentAgentId, cleanedMessages, config);
        if (!result.ok) {
          // Retry once
          await new Promise(r => setTimeout(r, 1000));
          result = await cortexIngest(cortexUrl, userText, assistantText, currentAgentId, cleanedMessages, config);
          if (result.ok && debug) log.info(`[cortex-bridge] agent_end ingest succeeded on retry`);
        }
        if (debug) log.info(`[cortex-bridge] agent_end ingest ok=${result.ok}, agent=${currentAgentId}, messages=${cleanedMessages.length}`);
      } catch (e) {
        if (debug) log.warn(`[cortex-bridge] agent_end error: ${(e as Error).message}`);
      }
    });

    // ── Hook: before_compaction → Emergency flush ───────
    api.on('before_compaction', async (event: any, ctx?: any) => {
      try {
        const currentAgentId = resolveAgentId(ctx);
        const rawMessages: any[] = event?.messages || [];
        if (rawMessages.length === 0) return;

        // Normalize multimodal content to plain text, strip injected tags
        const messages = rawMessages.map((m: any) => ({
          role: m.role as string,
          content: cleanForIngestion(extractText(m.content)),
        })).filter(m => m.content);

        if (messages.length === 0) return;

        await cortexFlush(cortexUrl, messages, currentAgentId, config);
        if (debug) log.info(`[cortex-bridge] Hook flushed ${messages.length} messages`);
      } catch (e) {
        if (debug) log.warn(`[cortex-bridge] Hook flush failed: ${(e as Error).message}`);
      }
    });

    // ── Service: startup health check ───────────────────
    api.registerService({
      id: 'cortex-bridge',
      start: async () => {
        const status = await cortexHealthCheck(cortexUrl);
        if (status.ok) {
          log.info(`[cortex-bridge] Cortex server online (${status.latency_ms}ms)`);
        } else {
          log.warn(`[cortex-bridge] Cortex server unreachable: ${status.error}`);
        }
      },
      stop: async () => {
        log.info('[cortex-bridge] Service stopped');
      },
    });
  },
};
