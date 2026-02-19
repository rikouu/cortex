/**
 * Cortex Bridge Plugin for OpenClaw
 *
 * Thin bridge (~200 lines) that forwards OpenClaw hooks to Cortex Sidecar REST API.
 * Key design: NEVER block the Agent. All calls have hard timeouts + graceful fallback.
 */

const CORTEX_URL = process.env.CORTEX_URL || 'http://localhost:21100';
const RECALL_TIMEOUT = 3000;
const INGEST_TIMEOUT = 5000;
const FLUSH_TIMEOUT = 5000;

interface AgentContext {
  agentId?: string;
  sessionId?: string;
  lastUserMessage?: string;
  lastAssistantMessage?: string;
  messages?: { role: string; content: string }[];
  metadata?: Record<string, any>;
}

interface PluginResult {
  prependContext?: string;
}

/**
 * Called before Agent generates a response.
 * Searches Cortex for relevant memories and injects them as context.
 */
export async function onBeforeResponse(context: AgentContext): Promise<PluginResult | null> {
  if (!context.lastUserMessage) return null;

  try {
    const res = await fetch(`${CORTEX_URL}/api/v1/recall`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: context.lastUserMessage,
        agent_id: context.agentId || 'openclaw',
        max_tokens: 2000,
      }),
      signal: AbortSignal.timeout(RECALL_TIMEOUT),
    });

    if (res.ok) {
      const data = await res.json() as { context: string; meta: { injected_count: number } };
      if (data.context && data.meta.injected_count > 0) {
        return { prependContext: data.context };
      }
    }
  } catch (e) {
    // Sidecar unreachable — silent fallback, Agent works normally
    if (process.env.CORTEX_DEBUG) {
      console.warn('[cortex-bridge] Sidecar unreachable for recall:', (e as Error).message);
    }
  }

  return null;
}

/**
 * Called after Agent generates a response.
 * Sends the conversation exchange to Cortex for memory extraction.
 * Fire-and-forget — does NOT wait for result.
 */
export async function onAfterResponse(context: AgentContext): Promise<void> {
  if (!context.lastUserMessage || !context.lastAssistantMessage) return;

  try {
    // Fire-and-forget: don't await the full response
    fetch(`${CORTEX_URL}/api/v1/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_message: context.lastUserMessage,
        assistant_message: context.lastAssistantMessage,
        agent_id: context.agentId || 'openclaw',
        session_id: context.sessionId,
      }),
      signal: AbortSignal.timeout(INGEST_TIMEOUT),
    }).catch(() => {
      // Silent failure — memory ingestion is best-effort
    });
  } catch {
    // Swallow all errors
  }
}

/**
 * Called before context window compaction.
 * Emergency flush — extract key info before it's lost.
 */
export async function onBeforeCompaction(context: AgentContext): Promise<void> {
  if (!context.messages || context.messages.length === 0) return;

  try {
    await fetch(`${CORTEX_URL}/api/v1/flush`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: context.messages,
        agent_id: context.agentId || 'openclaw',
        session_id: context.sessionId,
        reason: 'compaction',
      }),
      signal: AbortSignal.timeout(FLUSH_TIMEOUT),
    });
  } catch (e) {
    if (process.env.CORTEX_DEBUG) {
      console.warn('[cortex-bridge] Flush failed:', (e as Error).message);
    }
  }
}

/**
 * Health check — verify Cortex Sidecar is reachable.
 */
export async function healthCheck(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
  const start = Date.now();
  try {
    const res = await fetch(`${CORTEX_URL}/api/v1/health`, {
      signal: AbortSignal.timeout(2000),
    });
    const data = await res.json() as any;
    return { ok: data.status === 'ok', latency_ms: Date.now() - start };
  } catch (e) {
    return { ok: false, latency_ms: Date.now() - start, error: (e as Error).message };
  }
}

// Plugin metadata
export const pluginInfo = {
  name: 'cortex-bridge',
  version: '0.1.0',
  description: 'Bridge plugin for Cortex AI Agent Memory Service',
  cortexUrl: CORTEX_URL,
};

export default {
  name: 'cortex-bridge',
  onBeforeResponse,
  onAfterResponse,
  onBeforeCompaction,
  healthCheck,
  pluginInfo,
};
