import { getDb } from '../db/connection.js';
import { generateId } from '../utils/helpers.js';
import { createLogger } from '../utils/logger.js';
import type { ExtractedMemory, ExtractionLogData } from './sieve.js';

const log = createLogger('extraction-log');

export interface ExtractionLogEntry extends ExtractionLogData {
  id: string;
  agent_id: string;
  session_id?: string;
  created_at: string;
}

export function insertExtractionLog(
  agentId: string,
  sessionId: string | undefined,
  data: ExtractionLogData,
): string {
  try {
    const db = getDb();
    const id = generateId();

    db.prepare(`
      INSERT INTO extraction_logs (id, agent_id, session_id, exchange_preview, channel, raw_output, parsed_memories, memories_written, memories_deduped, memories_smart_updated, latency_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      agentId,
      sessionId || null,
      data.exchange_preview,
      data.channel,
      data.raw_output,
      JSON.stringify(data.parsed_memories),
      data.memories_written,
      data.memories_deduped,
      data.memories_smart_updated ?? 0,
      data.latency_ms,
    );

    return id;
  } catch (e: any) {
    log.warn({ error: e.message }, 'Failed to write extraction log');
    return '';
  }
}

export function getExtractionLogs(
  agentId: string,
  opts?: { limit?: number; channel?: 'fast' | 'deep' | 'flush' | 'mcp' },
): ExtractionLogEntry[] {
  const db = getDb();
  const conditions = ['agent_id = ?'];
  const params: any[] = [agentId];

  if (opts?.channel) {
    conditions.push('channel = ?');
    params.push(opts.channel);
  }

  const limit = opts?.limit || 50;
  const where = conditions.join(' AND ');

  const rows = db.prepare(`
    SELECT * FROM extraction_logs
    WHERE ${where}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...params, limit) as any[];

  return rows.map((r) => ({
    id: r.id,
    agent_id: r.agent_id,
    session_id: r.session_id,
    exchange_preview: r.exchange_preview,
    channel: r.channel,
    raw_output: r.raw_output,
    parsed_memories: r.parsed_memories ? JSON.parse(r.parsed_memories) : [],
    memories_written: r.memories_written,
    memories_deduped: r.memories_deduped,
    memories_smart_updated: r.memories_smart_updated ?? 0,
    latency_ms: r.latency_ms,
    created_at: r.created_at,
  }));
}
