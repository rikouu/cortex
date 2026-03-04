import React, { useEffect, useState } from 'react';
import { getExtractionLogs, listAgents } from '../api/client.js';
import { useI18n } from '../i18n/index.js';
import { toLocal } from '../utils/time.js';

interface ExtractedMemory {
  content: string;
  category: string;
  importance: number;
  source: string;
  reasoning: string;
}

interface LogEntry {
  id: string;
  agent_id: string;
  session_id?: string;
  exchange_preview: string;
  channel: 'fast' | 'deep' | 'flush' | 'mcp';
  raw_output: string;
  parsed_memories: ExtractedMemory[];
  memories_written: number;
  memories_deduped: number;
  latency_ms: number;
  error?: string;
  created_at: string;
}

const CHANNEL_COLORS: Record<string, { bg: string; color: string }> = {
  fast: { bg: 'rgba(16,185,129,0.15)', color: '#10b981' },
  deep: { bg: 'rgba(59,130,246,0.15)', color: '#3b82f6' },
  flush: { bg: 'rgba(139,92,246,0.15)', color: '#8b5cf6' },
  mcp: { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b' },
};

export default function ExtractionLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [agentId, setAgentId] = useState('');
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');
  const [timeRange, setTimeRange] = useState('');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [stats, setStats] = useState<any>({});
  const [page, setPage] = useState(0);
  const limit = 20;
  const { t } = useI18n();

  useEffect(() => {
    listAgents().then((res: any) => {
      const list = res.agents || res || [];
      setAgents(list);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [agentId, channel, status, timeRange, customFrom, customTo, page]);

  const getTimeFilters = () => {
    const now = new Date();
    if (timeRange === 'today') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      return { from: start };
    } else if (timeRange === '7d') {
      const start = new Date(now.getTime() - 7 * 86400000).toISOString();
      return { from: start };
    } else if (timeRange === '30d') {
      const start = new Date(now.getTime() - 30 * 86400000).toISOString();
      return { from: start };
    } else if (timeRange === 'custom') {
      return {
        from: customFrom ? new Date(customFrom).toISOString() : undefined,
        to: customTo ? new Date(customTo + 'T23:59:59').toISOString() : undefined,
      };
    }
    return {};
  };

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const timeFilters = getTimeFilters();
      const res = await getExtractionLogs(agentId || undefined, {
        limit, offset: page * limit,
        channel: channel || undefined,
        status: status || undefined,
        ...timeFilters,
      });
      setLogs(res.items || []);
      setTotalCount(res.total ?? res.items?.length ?? 0);
      setStats(res.stats || {});
    } catch {
      setLogs([]);
    }
    setLoading(false);
  };

  // Stats from server (aggregated over full filtered set)
  const totalWritten = stats.totalWritten ?? 0;
  const totalDeduped = stats.totalDeduped ?? 0;
  const avgLatency = stats.avgLatency ?? 0;
  const channelCounts = stats.channelCounts ?? { fast: 0, deep: 0, flush: 0, mcp: 0 };

  return (
    <div>
      <h1 className="page-title">{t('extractionLogs.title')}</h1>

      {/* Filters */}
      <div className="toolbar" style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('extractionLogs.agent')}</label>
          <select value={agentId} onChange={e => { setAgentId(e.target.value); setPage(0); setLogs([]); setTotalCount(0); }} style={{ fontSize: 13, padding: '4px 8px' }}>
            <option value="">{t('extractionLogs.allAgents') || '全部 Agent'}</option>
            {agents.map((a: any) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('extractionLogs.channel')}</label>
          <select value={channel} onChange={e => { setChannel(e.target.value); setPage(0); }} style={{ fontSize: 13, padding: '4px 8px' }}>
            <option value="">{t('extractionLogs.allChannels')}</option>
            <option value="fast">Fast</option>
            <option value="deep">Deep</option>
            <option value="flush">Flush</option>
            <option value="mcp">MCP</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('extractionLogs.status')}</label>
          <select value={status} onChange={e => { setStatus(e.target.value); setPage(0); }} style={{ fontSize: 13, padding: '4px 8px' }}>
            <option value="">{t('extractionLogs.allStatus')}</option>
            <option value="written">{t('extractionLogs.statusWritten')}</option>
            <option value="deduped">{t('extractionLogs.statusDeduped')}</option>
            <option value="empty">{t('extractionLogs.statusEmpty')}</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('extractionLogs.timeRange')}</label>
          <select value={timeRange} onChange={e => { setTimeRange(e.target.value); setPage(0); }} style={{ fontSize: 13, padding: '4px 8px' }}>
            <option value="">{t('extractionLogs.timeAll')}</option>
            <option value="today">{t('extractionLogs.timeToday')}</option>
            <option value="7d">{t('extractionLogs.timeLast7d')}</option>
            <option value="30d">{t('extractionLogs.timeLast30d')}</option>
            <option value="custom">{t('extractionLogs.timeCustom')}</option>
          </select>
        </div>
        {timeRange === 'custom' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setPage(0); }} style={{ fontSize: 12, padding: '3px 6px' }} />
            <span style={{ color: 'var(--text-muted)' }}>—</span>
            <input type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); setPage(0); }} style={{ fontSize: 12, padding: '3px 6px' }} />
          </div>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div className="card" style={{ padding: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>{totalCount}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('extractionLogs.totalLogs')}</div>
        </div>
        <div className="card" style={{ padding: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--success)' }}>{totalWritten}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('extractionLogs.written')}</div>
        </div>
        <div className="card" style={{ padding: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--warning)' }}>{totalDeduped}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('extractionLogs.deduped')}</div>
        </div>
        <div className="card" style={{ padding: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>{avgLatency}ms</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('extractionLogs.avgLatency')}</div>
        </div>
        {(['fast', 'deep', 'flush', 'mcp'] as const).map(ch => (
          <div key={ch} className="card" style={{ padding: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: CHANNEL_COLORS[ch].color }}>{channelCounts[ch]}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ch}</div>
          </div>
        ))}
      </div>

      {/* Log list */}
      {loading ? (
        <div className="empty">{t('common.loading')}</div>
      ) : logs.length === 0 ? (
        <div className="empty">{t('extractionLogs.noLogs')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {logs.map(log => {
            const expanded = expandedId === log.id;
            const chStyle = CHANNEL_COLORS[log.channel] || CHANNEL_COLORS.deep;
            return (
              <div key={log.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {/* Header row */}
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer' }}
                  onClick={() => setExpandedId(expanded ? null : log.id)}
                >
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 130 }}>
                    {toLocal(log.created_at)}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                    background: chStyle.bg, color: chStyle.color,
                  }}>
                    {log.channel}
                  </span>
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {log.exchange_preview || '—'}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {log.memories_written}w / {log.memories_deduped}d
                  </span>
                  {log.error && <span style={{ fontSize: 11, color: '#ef4444', whiteSpace: 'nowrap' }} title={log.error}>❌ 错误</span>}
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {log.latency_ms}ms
                  </span>
                  <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{expanded ? '▲' : '▼'}</span>
                </div>

                {/* Expanded detail */}
                {expanded && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: 14, fontSize: 13 }}>
                    {/* Exchange preview */}
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-muted)' }}>{t('extractionLogs.exchangePreview')}</div>
                      <div style={{ background: 'rgba(0,0,0,0.2)', padding: 10, borderRadius: 6, whiteSpace: 'pre-wrap', fontSize: 12 }}>
                        {log.exchange_preview || '—'}
                      </div>
                    </div>

                    {/* Error */}
                    {log.error && (
                      <div style={{ marginBottom: 12, padding: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6 }}>
                        <div style={{ fontWeight: 600, color: '#ef4444', marginBottom: 4 }}>❌ 错误详情</div>
                        <div style={{ fontSize: 12, color: '#fca5a5', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{log.error}</div>
                      </div>
                    )}

                    {/* Raw LLM output */}
                    {log.raw_output && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-muted)' }}>{t('extractionLogs.rawOutput')}</div>
                        <div style={{ background: 'rgba(0,0,0,0.2)', padding: 10, borderRadius: 6, whiteSpace: 'pre-wrap', fontSize: 11, fontFamily: 'monospace', maxHeight: 200, overflow: 'auto' }}>
                          {log.raw_output}
                        </div>
                      </div>
                    )}

                    {/* Parsed memories */}
                    {log.parsed_memories && log.parsed_memories.length > 0 && (
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--text-muted)' }}>
                          {t('extractionLogs.extractedMemories')} ({log.parsed_memories.length})
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {log.parsed_memories.map((m, i) => (
                            <div key={i} style={{ background: 'rgba(0,0,0,0.15)', padding: 10, borderRadius: 6, border: '1px solid var(--border)' }}>
                              <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                <span className="badge" style={{ background: 'rgba(59,130,246,0.2)', color: '#60a5fa' }}>{m.category}</span>
                                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                  imp: {m.importance?.toFixed(2)} | {m.source}
                                </span>
                              </div>
                              <div style={{ fontSize: 13, marginBottom: 4 }}>{m.content}</div>
                              {m.reasoning && (
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>{m.reasoning}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ID */}
                    <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      ID: {log.id} | Session: {log.session_id || '—'}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalCount > limit && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginTop: 16, gap: 8 }}>
          <button className="btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>{t('common.prev')}</button>
          <span style={{ padding: '8px 16px', color: 'var(--text-muted)' }}>{t('common.page', { current: page + 1, total: Math.ceil(totalCount / limit) })}</span>
          <button className="btn" disabled={(page + 1) * limit >= totalCount} onClick={() => setPage(p => p + 1)}>{t('common.next')}</button>
        </div>
      )}
    </div>
  );
}
