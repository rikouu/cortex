import { getDb } from './connection.js';

// ============ Agent Types ============

export interface Agent {
  id: string;
  name: string;
  description: string | null;
  config_override: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentWithCount extends Agent {
  memory_count: number;
}

// Agent ID validation: lowercase alphanumeric + hyphens/underscores, 2-64 chars
const AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$|^[a-z0-9]{2}$/;

const BUILT_IN_AGENTS = ['default', 'mcp'];

// ============ Auto-provision ============

/**
 * Ensure an agent record exists. If not, auto-create with a sensible name.
 * This allows plugins (e.g. OpenClaw bridge) to send agent_id without
 * requiring explicit agent registration first.
 */
export function ensureAgent(agentId: string): void {
  if (!agentId || agentId === 'default') return;
  const db = getDb();
  const exists = db.prepare('SELECT 1 FROM agents WHERE id = ?').get(agentId);
  if (exists) return;

  // Validate ID format — if invalid, silently skip (memory will still store with the raw agent_id)
  if (!AGENT_ID_RE.test(agentId)) return;

  db.prepare(`
    INSERT OR IGNORE INTO agents (id, name, description)
    VALUES (?, ?, ?)
  `).run(agentId, agentId, `Auto-created from first API request`);
}

// ============ Agent Queries ============

export function listAgents(): AgentWithCount[] {
  const db = getDb();
  return db.prepare(`
    SELECT a.*, (SELECT COUNT(*) FROM memories WHERE agent_id = a.id) as memory_count
    FROM agents a
    ORDER BY a.created_at
  `).all() as AgentWithCount[];
}

export function getAgentById(id: string): Agent | null {
  const db = getDb();
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Agent | null;
}

export function getAgentStats(id: string): { layers: Record<string, number>; total: number } {
  const db = getDb();
  const rows = db.prepare(
    'SELECT layer, COUNT(*) as cnt FROM memories WHERE agent_id = ? GROUP BY layer'
  ).all(id) as { layer: string; cnt: number }[];

  const layers: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    layers[r.layer] = r.cnt;
    total += r.cnt;
  }
  return { layers, total };
}

export function insertAgent(data: { id: string; name: string; description?: string; config_override?: any }): Agent {
  if (!AGENT_ID_RE.test(data.id)) {
    throw new Error('Invalid agent ID. Must be 2-64 chars, lowercase alphanumeric with hyphens/underscores.');
  }

  const db = getDb();
  const configStr = data.config_override ? JSON.stringify(data.config_override) : null;

  db.prepare(`
    INSERT INTO agents (id, name, description, config_override)
    VALUES (?, ?, ?, ?)
  `).run(data.id, data.name, data.description || null, configStr);

  return getAgentById(data.id)!;
}

export function updateAgent(id: string, updates: { name?: string; description?: string; config_override?: any }): Agent | null {
  const db = getDb();
  const existing = getAgentById(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: any[] = [];

  if (updates.name !== undefined) {
    sets.push('name = ?');
    params.push(updates.name);
  }
  if (updates.description !== undefined) {
    sets.push('description = ?');
    params.push(updates.description);
  }
  if (updates.config_override !== undefined) {
    sets.push('config_override = ?');
    params.push(updates.config_override ? JSON.stringify(updates.config_override) : null);
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getAgentById(id);
}

export function deleteAgent(id: string): { deleted: boolean; orphaned_memories: number } {
  if (BUILT_IN_AGENTS.includes(id)) {
    throw new Error(`Cannot delete built-in agent '${id}'`);
  }

  const db = getDb();
  const memoryCount = (db.prepare('SELECT COUNT(*) as cnt FROM memories WHERE agent_id = ?').get(id) as any).cnt;
  const result = db.prepare('DELETE FROM agents WHERE id = ?').run(id);

  return { deleted: result.changes > 0, orphaned_memories: memoryCount };
}
