import React, { useEffect, useState } from 'react';
import { getExtractionLogs, listAgents } from '../api/client.js';
import { useI18n } from '../i18n/index.js';

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
  channel: 'fast' | 'deep' | 'flush';
  raw_output: string;
  parsed_memories: ExtractedMemory[];
  memories_written: number;
  memories_deduped: number;
  latency_ms: number;
  created_at: string;
}

const CHANNEL_COLORS: Record<string, { bg: string; color: string }> = {
  fast: { bg: 'rgba(16,185,129,0.15)', color: '#10b981' },
  deep: { bg: 'rgba(59,130,246,0.15)', color: '#3b82f6' },
  flush: { bg: 'rgba(139,92,246,0.15)', color: '#8b5cf6' },
};

export default function ExtractionLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [agentId, setAgentId] = useState('');
  const [channel, setChannel] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    listAgents().then((res: any) => {
      const list = res.agents || res || [];
      setAgents(list);
      if (list.length > 0 && !agentId) {
        setAgentId(list[0].id);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!agentId) return;
    fetchLogs();
  }, [agentId, channel]);

  const fetchLogs = async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const res = await getExtractionLogs(agentId, { limit: 100, channel: channel || undefined });
      setLogs(res.items || []);
    } catch {
      setLogs([]);
    }
    setLoading(false);
  };

  // Stats
  const totalWritten = logs.reduce((s, l) => s + l.memories_written, 0);
  const totalDeduped = logs.reduce((s, l) => s + l.memories_deduped, 0);
  const avgLatency = logs.length > 0 ? Math.round(logs.reduce((s, l) => s + l.latency_ms, 0) / logs.length) : 0;
  const channelCounts = { fast: 0, deep: 0, flush: 0 };
  for (const l of logs) channelCounts[l.channel] = (channelCounts[l.channel] || 0) + 1;

  return (
    <div>
      <h1 className="page-title">{t('extractionLogs.title')}</h1>

      {/* Filters */}
      <div className="toolbar" style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('extractionLogs.agent')}</label>
          <select value={agentId} onChange={e => setAgentId(e.target.value)} style={{ fontSize: 13, padding: '4px 8px' }}>
            {agents.map((a: any) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('extractionLogs.channel')}</label>
          <select value={channel} onChange={e => setChannel(e.target.value)} style={{ fontSize: 13, padding: '4px 8px' }}>
            <option value="">{t('extractionLogs.allChannels')}</option>
            <option value="fast">Fast</option>
            <option value="deep">Deep</option>
            <option value="flush">Flush</option>
          </select>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div className="card" style={{ padding: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>{logs.length}</div>
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
        {(['fast', 'deep', 'flush'] as const).map(ch => (
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
                    {log.created_at?.slice(0, 19).replace('T', ' ')}
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
    </div>
  );
}
