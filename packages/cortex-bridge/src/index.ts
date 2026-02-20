/**
 * Cortex Bridge Plugin for OpenClaw
 *
 * Conforms to OpenClaw's register(api) plugin interface.
 * Forwards OpenClaw lifecycle hooks to Cortex Sidecar REST API.
 * Key design: NEVER block the Agent. All calls have hard timeouts + graceful fallback.
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
  sessionId?: string,
): Promise<void> {
  fetch(`${cortexUrl}/api/v1/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_message: userMessage,
      assistant_message: assistantMessage,
      agent_id: agentId,
      session_id: sessionId,
    }),
    signal: AbortSignal.timeout(INGEST_TIMEOUT),
  }).catch(() => {});
}

async function cortexFlush(
  cortexUrl: string,
  messages: { role: string; content: string }[],
  agentId: string,
  sessionId?: string,
): Promise<void> {
  await fetch(`${cortexUrl}/api/v1/flush`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, agent_id: agentId, session_id: sessionId, reason: 'compaction' }),
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
    const config = api.pluginConfig;
    const cortexUrl = getCortexUrl(config);
    const agentId = (config.agentId as string) || 'openclaw';
    const debug = isDebug(config);
    const log = api.logger;

    log.info(`[cortex-bridge] Registered — Cortex URL: ${cortexUrl}, Agent: ${agentId}`);

    // ── Hook: before_agent_start → Recall memories ──────
    // event: { prompt: string, messages?: { role: string, content: string }[] }
    api.on('before_agent_start', async (event: any) => {
      try {
        // event.prompt is the current user input
        const query: string = event?.prompt || '';
        if (!query) return;

        const result = await cortexRecall(cortexUrl, query, agentId);
        if (result) {
          log.info(`[cortex-bridge] Recalled ${result.count} memories`);
          return { prependContext: result.context };
        }
      } catch (e) {
        if (debug) {
          log.warn(`[cortex-bridge] Recall failed: ${(e as Error).message}`);
        }
      }
    });

    // ── Hook: agent_end → Ingest conversation ───────────
    // event: { messages: { role: string, content: string }[], success: boolean, error?: string, durationMs?: number }
    api.on('agent_end', async (event: any) => {
      try {
        const messages: { role: string; content: string }[] = event?.messages || [];

        // Find the last user + assistant pair
        const reversed = [...messages].reverse();
        const lastAssistant = reversed.find((m: { role: string }) => m.role === 'assistant');
        const lastUser = reversed.find((m: { role: string }) => m.role === 'user');

        if (!lastUser || !lastAssistant) return;

        await cortexIngest(
          cortexUrl,
          lastUser.content,
          lastAssistant.content,
          agentId,
        );

        if (debug) {
          log.info('[cortex-bridge] Ingested conversation pair');
        }
      } catch (e) {
        if (debug) {
          log.warn(`[cortex-bridge] Ingest failed: ${(e as Error).message}`);
        }
      }
    });

    // ── Hook: before_compaction → Emergency flush ───────
    // event: { messages: { role: string, content: string }[] }
    api.on('before_compaction', async (event: any) => {
      try {
        const messages: { role: string; content: string }[] = event?.messages || [];
        if (messages.length === 0) return;

        await cortexFlush(cortexUrl, messages, agentId);

        if (debug) {
          log.info(`[cortex-bridge] Flushed ${messages.length} messages before compaction`);
        }
      } catch (e) {
        if (debug) {
          log.warn(`[cortex-bridge] Flush failed: ${(e as Error).message}`);
        }
      }
    });

    // ── Tool: cortex_recall ─────────────────────────────
    api.registerTool({
      name: 'cortex_recall',
      description: 'Search Cortex for relevant memories about a topic',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
        },
        required: ['query'],
      },
      async execute(_id: string, params: { query: string }) {
        const result = await cortexRecall(cortexUrl, params.query, agentId);
        if (result) {
          return { content: [{ type: 'text', text: result.context }] };
        }
        return { content: [{ type: 'text', text: 'No relevant memories found.' }] };
      },
    });

    // ── Tool: cortex_remember ───────────────────────────
    api.registerTool({
      name: 'cortex_remember',
      description: 'Store an important fact or piece of information in Cortex memory',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The information to remember' },
        },
        required: ['content'],
      },
      async execute(_id: string, params: { content: string }) {
        try {
          const res = await fetch(`${cortexUrl}/api/v1/memories`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: params.content,
              agent_id: agentId,
              layer: 'working',
            }),
            signal: AbortSignal.timeout(INGEST_TIMEOUT),
          });
          if (res.ok) {
            return { content: [{ type: 'text', text: 'Memory stored successfully.' }] };
          }
          return { content: [{ type: 'text', text: `Failed to store memory: ${res.status}` }] };
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

    // ── Service: background health monitor ──────────────
    let healthInterval: ReturnType<typeof setInterval> | undefined;

    api.registerService({
      id: 'cortex-bridge',
      start: async () => {
        const status = await cortexHealthCheck(cortexUrl);
        if (status.ok) {
          log.info(`[cortex-bridge] Cortex server online (${status.latency_ms}ms)`);
        } else {
          log.warn(`[cortex-bridge] Cortex server unreachable: ${status.error}`);
        }
        // Periodic health check every 60s
        healthInterval = setInterval(async () => {
          const s = await cortexHealthCheck(cortexUrl);
          if (!s.ok && debug) {
            log.warn(`[cortex-bridge] Health check failed: ${s.error}`);
          }
        }, 60_000);
      },
      stop: async () => {
        if (healthInterval) clearInterval(healthInterval);
        log.info('[cortex-bridge] Service stopped');
      },
    });
  },
};
