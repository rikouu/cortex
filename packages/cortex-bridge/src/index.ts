/**
 * Cortex Bridge Plugin for OpenClaw
 *
 * Conforms to OpenClaw's register(api) plugin interface.
 * Provides tools + best-effort hooks for Cortex memory integration.
 *
 * Strategy: Tools are the primary interface (reliable), hooks are best-effort
 * (may not fire for kind:"tool" plugins in current OpenClaw versions).
 */

// ── Timeouts ────────────────────────────────────────────
const RECALL_TIMEOUT = 3000;
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
// [{type: "text", text: "..."}, {type: "image", ...}]
function extractText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
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

// Strip <cortex_memory> and other injected tags to prevent nested pollution.
// Without this, previously recalled memories get re-ingested as new content.
const INJECTED_TAG_RE = /<cortex_memory>[\s\S]*?<\/cortex_memory>/g;
const SYSTEM_TAG_RE = /<(?:system|context|memory|tool_result|function_call)[\s\S]*?<\/(?:system|context|memory|tool_result|function_call)>/g;

function stripInjectedTags(text: string): string {
  return text
    .replace(INJECTED_TAG_RE, '')
    .replace(SYSTEM_TAG_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Cortex HTTP helpers ─────────────────────────────────
function getCortexUrl(config: Record<string, any>): string {
  return config.cortexUrl || process.env.CORTEX_URL || 'http://localhost:21100';
}

function isDebug(config: Record<string, any>): boolean {
  return config.debug === true || process.env.CORTEX_DEBUG === 'true';
}

async function cortexRecall(
  cortexUrl: string,
  query: string,
  agentId: string,
): Promise<{ context: string; count: number } | null> {
  const res = await fetch(`${cortexUrl}/api/v1/recall`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, agent_id: agentId, max_tokens: 2000 }),
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
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${cortexUrl}/api/v1/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_message: userMessage,
        assistant_message: assistantMessage,
        agent_id: agentId,
      }),
      signal: AbortSignal.timeout(INGEST_TIMEOUT),
    });
    return { ok: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function cortexFlush(
  cortexUrl: string,
  messages: { role: string; content: string }[],
  agentId: string,
): Promise<void> {
  await fetch(`${cortexUrl}/api/v1/flush`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, agent_id: agentId, reason: 'compaction' }),
    signal: AbortSignal.timeout(FLUSH_TIMEOUT),
  });
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
    },
  },

  register(api: PluginApi) {
    const config = api.pluginConfig ?? {};
    const cortexUrl = getCortexUrl(config);
    const agentId = (config.agentId as string) || 'openclaw';
    const debug = isDebug(config);
    const log = api.logger;

    log.info(`[cortex-bridge] Registered — Cortex URL: ${cortexUrl}, Agent: ${agentId}, config keys: ${Object.keys(config).join(',') || '(empty)'}`);

    // ════════════════════════════════════════════════════════
    // TOOLS (primary interface — always work)
    // ════════════════════════════════════════════════════════

    // ── Tool: cortex_recall ─────────────────────────────
    api.registerTool({
      name: 'cortex_recall',
      description: 'Search Cortex long-term memory for relevant past conversations, facts, and preferences. Use this at the start of conversations or when you need context about a topic.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query — describe what you want to recall' },
        },
        required: ['query'],
      },
      async execute(_id: string, params: { query: string }) {
        try {
          const result = await cortexRecall(cortexUrl, params.query, agentId);
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
      description: 'Store an important fact, preference, or decision in Cortex long-term memory. Use this when the user shares something worth remembering for future conversations.',
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
            ],
            default: 'fact',
          },
        },
        required: ['content'],
      },
      async execute(_id: string, params: { content: string; category?: string }) {
        try {
          const res = await fetch(`${cortexUrl}/api/v1/memories`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: params.content,
              category: params.category || 'fact',
              agent_id: agentId,
              layer: 'working',
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
      description: 'Send a conversation exchange to Cortex for automatic memory extraction via LLM. The LLM will analyze the conversation and extract any important facts, preferences, or decisions. Use this after meaningful conversations to build long-term memory.',
      parameters: {
        type: 'object',
        properties: {
          user_message: { type: 'string', description: 'What the user said' },
          assistant_message: { type: 'string', description: 'What you (the assistant) replied' },
        },
        required: ['user_message', 'assistant_message'],
      },
      async execute(_id: string, params: { user_message: string; assistant_message: string }) {
        try {
          const result = await cortexIngest(
            cortexUrl,
            stripInjectedTags(params.user_message),
            stripInjectedTags(params.assistant_message),
            agentId,
          );
          if (result.ok) {
            return { content: [{ type: 'text', text: 'Conversation ingested — memories will be extracted automatically.' }] };
          }
          return { content: [{ type: 'text', text: `Ingest failed: ${result.error}` }] };
        } catch (e) {
          return { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }] };
        }
      },
    });

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

    // ── Command: /cortex-status ─────────────────────────
    api.registerCommand({
      name: 'cortex-status',
      description: 'Check Cortex memory server status',
      handler: async () => {
        const status = await cortexHealthCheck(cortexUrl);
        if (status.ok) {
          return { text: `Cortex is online (${status.latency_ms}ms)` };
        }
        return { text: `Cortex is offline: ${status.error || 'unknown error'}` };
      },
    });

    // ════════════════════════════════════════════════════════
    // HOOKS (best-effort — may not fire for kind:"tool" plugins)
    // ════════════════════════════════════════════════════════

    // ── Hook: before_agent_start → Recall memories ──────
    api.on('before_agent_start', async (event: any) => {
      try {
        const query = extractText(event?.prompt) || '';
        if (!query) return;

        const result = await cortexRecall(cortexUrl, query, agentId);
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
    api.on('agent_end', async (event: any) => {
      try {
        const messages: any[] = event?.messages || [];
        const reversed = [...messages].reverse();
        const lastAssistant = reversed.find((m: any) => m.role === 'assistant');
        const lastUser = reversed.find((m: any) => m.role === 'user');

        if (!lastUser || !lastAssistant) return;

        // Extract text and strip injected <cortex_memory> tags
        // to prevent previously recalled memories from being re-ingested
        const userText = stripInjectedTags(extractText(lastUser.content));
        const assistantText = stripInjectedTags(extractText(lastAssistant.content));

        if (!userText || !assistantText) {
          if (debug) log.warn('[cortex-bridge] agent_end: empty after tag stripping');
          return;
        }

        const result = await cortexIngest(cortexUrl, userText, assistantText, agentId);
        if (debug) log.info(`[cortex-bridge] agent_end ingest ok=${result.ok}`);
      } catch (e) {
        if (debug) log.warn(`[cortex-bridge] agent_end error: ${(e as Error).message}`);
      }
    });

    // ── Hook: before_compaction → Emergency flush ───────
    api.on('before_compaction', async (event: any) => {
      try {
        const rawMessages: any[] = event?.messages || [];
        if (rawMessages.length === 0) return;

        // Normalize multimodal content to plain text, strip injected tags
        const messages = rawMessages.map((m: any) => ({
          role: m.role as string,
          content: stripInjectedTags(extractText(m.content)),
        })).filter(m => m.content);

        if (messages.length === 0) return;

        await cortexFlush(cortexUrl, messages, agentId);
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
