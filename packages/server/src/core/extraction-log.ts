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
      INSERT INTO extraction_logs (id, agent_id, session_id, exchange_preview, channel, raw_output, parsed_memories, memories_written, memories_deduped, memories_smart_updated, latency_ms, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      data.error || null,
    );

    return id;
  } catch (e: any) {
    log.warn({ error: e.message }, 'Failed to write extraction log');
    return '';
  }
}

interface LogFilterOpts {
  limit?: number;
  offset?: number;
  channel?: 'fast' | 'deep' | 'flush' | 'mcp';
  status?: 'written' | 'deduped' | 'empty';
  from?: string;
  to?: string;
}

function buildConditions(agentId?: string, opts?: LogFilterOpts): { conditions: string[]; params: any[] } {
  const conditions: string[] = [];
  const params: any[] = [];

  if (agentId) {
    conditions.push('agent_id = ?');
    params.push(agentId);
  }
  if (opts?.channel) {
    conditions.push('channel = ?');
    params.push(opts.channel);
  }
  if (opts?.status === 'written') {
    conditions.push('memories_written > 0');
  } else if (opts?.status === 'deduped') {
    conditions.push('memories_deduped > 0');
  } else if (opts?.status === 'empty') {
    conditions.push('memories_written = 0 AND memories_deduped = 0');
  }
  if (opts?.from) {
    conditions.push('created_at >= ?');
    params.push(opts.from);
  }
  if (opts?.to) {
    conditions.push('created_at <= ?');
    params.push(opts.to);
  }
  return { conditions, params };
}

export function getExtractionLogs(
  agentId?: string,
  opts?: LogFilterOpts,
): ExtractionLogEntry[] {
  const db = getDb();
  const { conditions, params } = buildConditions(agentId, opts);

  const limit = opts?.limit || 50;
  const offset = opts?.offset || 0;
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT * FROM extraction_logs
    ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[];

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

export function countExtractionLogs(
  agentId?: string,
  opts?: LogFilterOpts,
): number {
  const db = getDb();
  const { conditions, params } = buildConditions(agentId, opts);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const row = db.prepare(`SELECT count(*) as c FROM extraction_logs ${where}`).get(...params) as { c: number };
  return row.c;
}

export interface LogAggregateStats {
  totalWritten: number;
  totalDeduped: number;
  avgLatency: number;
  channelCounts: Record<string, number>;
}

export function getExtractionLogStats(
  agentId?: string,
  opts?: LogFilterOpts,
): LogAggregateStats {
  const db = getDb();
  const { conditions, params } = buildConditions(agentId, opts);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const row = db.prepare(`
    SELECT
      COALESCE(SUM(memories_written), 0) as total_written,
      COALESCE(SUM(memories_deduped), 0) as total_deduped,
      COALESCE(AVG(latency_ms), 0) as avg_latency
    FROM extraction_logs ${where}
  `).get(...params) as any;

  const channels = db.prepare(`
    SELECT channel, COUNT(*) as cnt
    FROM extraction_logs ${where}
    GROUP BY channel
  `).all(...params) as any[];

  const channelCounts: Record<string, number> = { fast: 0, deep: 0, flush: 0, mcp: 0 };
  for (const ch of channels) {
    channelCounts[ch.channel] = ch.cnt;
  }

  return {
    totalWritten: row.total_written,
    totalDeduped: row.total_deduped,
    avgLatency: Math.round(row.avg_latency),
    channelCounts,
  };
}
