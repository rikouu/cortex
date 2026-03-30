import { getAgentById } from '../db/index.js';

/**
 * Returns true if automatic memory hooks (ingest/recall/flush) are disabled
 * for the given agent via the `cortex_hooks_disabled` metadata flag.
 * The `default` agent is never disabled.
 */
export function isHooksDisabled(agentId: string | undefined): boolean {
  if (!agentId || agentId === 'default') return false;
  const agent = getAgentById(agentId);
  if (!agent?.metadata) return false;
  try {
    const meta = JSON.parse(agent.metadata);
    return meta.cortex_hooks_disabled === true;
  } catch { return false; }
}
