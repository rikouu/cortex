import React, { useEffect, useState, useRef } from 'react';
import { getSystemLogs } from '../api/client.js';
import { useI18n } from '../i18n/index.js';

interface LogEntry {
  level: string;
  time: number;
  module?: string;
  msg: string;
}

const LEVEL_COLORS: Record<string, string> = {
  trace: '#6b7280',
  debug: '#60a5fa',
  info: '#10b981',
  warn: '#f59e0b',
  error: '#ef4444',
  fatal: '#dc2626',
};

export default function SystemLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [level, setLevel] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await getSystemLogs(200, level || undefined);
      setLogs(res.logs || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();
  }, [level]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(fetchLogs, 3000);
    return () => clearInterval(timer);
  }, [autoRefresh, level]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div>
      <h1 className="page-title">{t('systemLogs.title')}</h1>

      <div className="toolbar" style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('systemLogs.filterLevel')}</label>
          <select value={level} onChange={e => setLevel(e.target.value)} style={{ fontSize: 13, padding: '4px 8px' }}>
            <option value="">{t('systemLogs.allLevels')}</option>
            <option value="error">Error</option>
            <option value="warn">Warn</option>
            <option value="info">Info</option>
            <option value="debug">Debug</option>
            <option value="trace">Trace</option>
          </select>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
          {t('systemLogs.autoRefresh')}
        </label>
        <button className="btn" onClick={fetchLogs} style={{ fontSize: 12, padding: '4px 12px' }}>
          {t('systemLogs.refresh')}
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {logs.length} {t('systemLogs.entries')}
        </span>
      </div>

      <div className="card" style={{
        padding: 0, maxHeight: '70vh', overflow: 'auto',
        fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6,
      }}>
        {logs.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
            {loading ? t('common.loading') : t('systemLogs.noLogs')}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {logs.map((log, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '4px 8px', color: 'var(--text-muted)', whiteSpace: 'nowrap', width: 70 }}>
                    {formatTime(log.time)}
                  </td>
                  <td style={{
                    padding: '4px 6px', fontWeight: 600, whiteSpace: 'nowrap', width: 50,
                    color: LEVEL_COLORS[log.level] || 'var(--text)',
                  }}>
                    {log.level.toUpperCase()}
                  </td>
                  <td style={{ padding: '4px 6px', color: '#8b5cf6', whiteSpace: 'nowrap', width: 100 }}>
                    {log.module || '—'}
                  </td>
                  <td style={{ padding: '4px 8px', color: 'var(--text)', wordBreak: 'break-word' }}>
                    {log.msg}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
