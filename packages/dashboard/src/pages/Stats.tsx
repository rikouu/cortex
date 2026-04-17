import React, { useEffect, useState, useRef } from 'react';
import { getStats, getHealth, getComponentHealth, listMemories, testConnections, recall as recallApi, listAgents } from '../api/client.js';
import { useI18n } from '../i18n/index.js';

function fmtNum(n: number, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (n >= 100_000_000) return t('stats.fmtHundredMillion', { value: (n / 100_000_000).toFixed(1).replace(/\.0$/, '') });
  if (n >= 10_000) return t('stats.fmtTenThousand', { value: (n / 10_000).toFixed(1).replace(/\.0$/, '') });
  if (n >= 1_000) return t('stats.fmtThousand', { value: (n / 1_000).toFixed(1).replace(/\.0$/, '') });
  return String(n);
}

function timeAgo(dateStr: string, t: (key: string, params?: Record<string, string | number>) => string, future = false): string {
  const diff = future ? new Date(dateStr).getTime() - Date.now() : Date.now() - new Date(dateStr).getTime();
  const abs = Math.abs(diff);
  if (abs < 60_000) return future ? t('stats.timeSoon') : t('stats.timeJustNow');
  if (abs < 3600_000) { const count = Math.floor(abs / 60_000); return future ? t('stats.timeMinutesLater', { count }) : t('stats.timeMinutesAgo', { count }); }
  if (abs < 86400_000) { const count = Math.floor(abs / 3600_000); return future ? t('stats.timeHoursLater', { count }) : t('stats.timeHoursAgo', { count }); }
  const count = Math.floor(abs / 86400_000); return future ? t('stats.timeDaysLater', { count }) : t('stats.timeDaysAgo', { count });
}

// ─── Mini Canvas Bar Chart ──────────────────────────────────────────────────

function BarChart({ data, colors, height = 220 }: { data: { label: string; value: number }[]; colors: string[]; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;
    const max = Math.max(...data.map(d => d.value), 1);
    const barW = Math.min(60, (W - 40) / data.length - 10);
    const startX = (W - data.length * (barW + 10) + 10) / 2;

    ctx.clearRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = 20 + (H - 90) * (1 - i / 4);
      ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(W - 10, y); ctx.stroke();
      ctx.fillStyle = '#71717a';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'right';
      ctx.fillText(String(Math.round(max * i / 4)), 26, y + 3);
    }

    data.forEach((d, i) => {
      const x = startX + i * (barW + 10);
      const barH = (d.value / max) * (H - 90);
      const y = H - 70 - barH;

      // Bar with gradient
      const grad = ctx.createLinearGradient(x, y, x, H - 70);
      grad.addColorStop(0, colors[i % colors.length]!);
      grad.addColorStop(1, colors[i % colors.length]! + '44');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, [4, 4, 0, 0]);
      ctx.fill();

      // Value on top
      ctx.fillStyle = '#e4e4e7';
      ctx.font = 'bold 12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(String(d.value), x + barW / 2, y - 6);

      // Label (rotated 45°)
      ctx.fillStyle = '#71717a';
      ctx.font = '10px system-ui';
      ctx.save();
      ctx.translate(x + barW / 2, H - 18);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = 'right';
      ctx.fillText(d.label, 0, 0);
      ctx.restore();
    });
  }, [data, colors, height]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: height }} />;
}

// ─── Horizontal Distribution Bar ────────────────────────────────────────────

function DistributionBar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const { t } = useI18n();
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return <div style={{ color: 'var(--color-text-tertiary)', fontSize: 13 }}>{t('common.noData')}</div>;
  return (
    <div>
      <div style={{ display: 'flex', height: 28, borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: 'var(--space-2)' }}>
        {segments.map((seg, i) => (
          <div
            key={i}
            style={{
              width: `${(seg.value / total) * 100}%`,
              background: seg.color,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 600, color: '#fff',
              minWidth: seg.value > 0 ? 24 : 0,
              transition: 'width var(--transition-smooth)',
            }}
          >
            {seg.value > 0 && ((seg.value / total) > 0.08 ? seg.value : '')}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        {segments.map((seg, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 12 }}>
            <div style={{ width: 10, height: 10, borderRadius: 'var(--radius-sm)', background: seg.color }} />
            <span style={{ color: 'var(--color-text-secondary)' }}>{seg.label}</span>
            <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{seg.value}</span>
            <span style={{ color: 'var(--color-text-tertiary)' }}>({total > 0 ? ((seg.value / total) * 100).toFixed(1) : 0}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Importance Histogram ───────────────────────────────────────────────────

function Histogram({ values, label, color }: { values: number[]; label: string; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || values.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;

    // Build 10 buckets [0,0.1), [0.1,0.2), ... [0.9,1.0]
    const buckets = new Array(10).fill(0);
    for (const v of values) {
      const idx = Math.min(Math.floor(v * 10), 9);
      buckets[idx]++;
    }
    const max = Math.max(...buckets, 1);
    const barW = (W - 50) / 10 - 2;

    ctx.clearRect(0, 0, W, H);

    // Y axis grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i <= 3; i++) {
      const y = 10 + (H - 40) * (1 - i / 3);
      ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(W - 5, y); ctx.stroke();
      ctx.fillStyle = '#71717a'; ctx.font = '9px system-ui'; ctx.textAlign = 'right';
      ctx.fillText(String(Math.round(max * i / 3)), 26, y + 3);
    }

    buckets.forEach((count, i) => {
      const x = 35 + i * (barW + 2);
      const barH = (count / max) * (H - 40);
      const y = H - 25 - barH;

      ctx.fillStyle = color + (count > 0 ? 'cc' : '33');
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, [2, 2, 0, 0]);
      ctx.fill();

      // X label
      ctx.fillStyle = '#71717a'; ctx.font = '9px system-ui'; ctx.textAlign = 'center';
      ctx.fillText((i / 10).toFixed(1), x + barW / 2, H - 8);
    });

    // Title
    ctx.fillStyle = '#71717a'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(label, W / 2, H - 0);
  }, [values, label, color]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: 140 }} />;
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function Stats() {
  const [stats, setStats] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [error, setError] = useState('');
  const [allMemories, setAllMemories] = useState<any[]>([]);
  const [components, setComponents] = useState<any[]>([]);
  const [connTest, setConnTest] = useState<any>(null);
  const [testing, setTesting] = useState(false);
  const [recallQuery, setRecallQuery] = useState('');
  const [recallResults, setRecallResults] = useState<any>(null);
  const [recalling, setRecalling] = useState(false);
  const [recallAgent, setRecallAgent] = useState('');
  const [relationsExpanded, setRelationsExpanded] = useState(false);
  const [fixedExpanded, setFixedExpanded] = useState(false);
  const [agents, setAgents] = useState<any[]>([]);
  const { t } = useI18n();

  useEffect(() => {
    Promise.all([getStats(), getHealth()])
      .then(([s, h]) => { setStats(s); setHealth(h); })
      .catch(e => setError(e.message));

    getComponentHealth()
      .then((r: any) => setComponents(r.components || []))
      .catch(() => {});

    listAgents()
      .then((r: any) => {
        const list = r.agents || [];
        setAgents(list);
        if (list.length > 0 && !recallAgent) setRecallAgent(list[0].id);
      })
      .catch(() => {});

    // Load sample memories for distribution histograms
    listMemories({ limit: '500', offset: '0' })
      .then((r: any) => setAllMemories(r.items || []))
      .catch(() => {});
  }, []);

  if (error) return <div className="card" style={{ color: 'var(--color-danger)' }}>{t('common.errorPrefix', { message: error })}</div>;
  if (!stats) return <div className="loading">{t('common.loading')}</div>;

  const layers = stats.layers || {};
  const categories = stats.categories || {};

  const layerSegments = [
    { label: t('stats.core'), value: layers.core || 0, color: '#818cf8' },
    { label: t('stats.working'), value: layers.working || 0, color: '#4ade80' },
    { label: t('stats.archive'), value: layers.archive || 0, color: '#a1a1aa' },
  ];

  const catData = Object.entries(categories).map(([cat, cnt]) => ({
    label: cat,
    value: cnt as number,
  }));

  const catColors = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6'];

  const importanceValues = allMemories.map(m => m.importance ?? 0);
  const decayValues = allMemories.map(m => m.decay_score ?? 0);
  const confidenceValues = allMemories.map(m => m.confidence ?? 0);

  const formatUptime = (seconds: number) => {
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  return (
    <div>
      <h1 className="page-title">{t('stats.title')}</h1>

      {/* Stat Cards */}
      <div className="card-grid">
        <div className="stat-card">
          <div className="label">{t('stats.totalMemories')}</div>
          <div className="value">{fmtNum(stats.total_memories || 0, t)}</div>
        </div>
        <div className="stat-card">
          <div className="label">{t('stats.core')}</div>
          <div className="value" style={{ color: 'var(--color-primary-hover)' }}>{layers.core || 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">{t('stats.working')}</div>
          <div className="value" style={{ color: 'var(--color-success)' }}>{layers.working || 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">{t('stats.archive')}</div>
          <div className="value" style={{ color: 'var(--color-text-tertiary)' }}>{layers.archive || 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">{t('stats.relations')}</div>
          <div className="value">{fmtNum(stats.total_relations || 0, t)}</div>
        </div>
        <div className="stat-card">
          <div className="label">{t('stats.accessLogs')}</div>
          <div className="value">{fmtNum(stats.total_access_logs || 0, t)}</div>
        </div>
      </div>

      {/* Layer Distribution */}
      <div className="card">
        <h3 style={{ marginBottom: 'var(--space-3)' }}>{t('stats.layerDistribution')}</h3>
        <DistributionBar segments={layerSegments} />
      </div>

      {/* Category Chart */}
      {catData.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 'var(--space-3)' }}>{t('stats.categories')}</h3>
          <BarChart data={catData} colors={catColors} height={180} />
        </div>
      )}

      {/* Score Distributions */}
      {allMemories.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 'var(--space-3)' }}>{t('stats.scoreDistributions')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--space-4)' }}>
            <div style={{ background: 'var(--color-base)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', border: '1px solid var(--color-border-subtle)' }}>
              <Histogram values={importanceValues} label={t('stats.importance')} color="#6366f1" />
            </div>
            <div style={{ background: 'var(--color-base)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', border: '1px solid var(--color-border-subtle)' }}>
              <Histogram values={decayValues} label={t('stats.decayScore')} color="#f59e0b" />
            </div>
            <div style={{ background: 'var(--color-base)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', border: '1px solid var(--color-border-subtle)' }}>
              <Histogram values={confidenceValues} label={t('stats.confidence')} color="#22c55e" />
            </div>
          </div>
        </div>
      )}

      {/* System Health */}
      {health && (
        <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
          <h3 style={{ marginBottom: 'var(--space-3)' }}>{t('stats.systemHealth')}</h3>
          <table>
            <tbody>
              <tr>
                <td>{t('stats.status')}</td>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span className={`status-dot ${health.status === 'ok' ? 'ok' : 'error'}`} />
                    <span style={{
                      padding: '2px 10px',
                      borderRadius: 'var(--radius-full)',
                      fontSize: 12,
                      fontWeight: 600,
                      background: health.status === 'ok' ? 'var(--color-success-muted)' : 'var(--color-danger-muted)',
                      color: health.status === 'ok' ? 'var(--color-success)' : 'var(--color-danger)',
                    }}>
                      {health.status}
                    </span>
                  </span>
                </td>
              </tr>
              <tr><td>{t('stats.version')}</td><td><span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{health.version}</span></td></tr>
              <tr><td>{t('stats.uptime')}</td><td><span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{formatUptime(health.uptime)}</span></td></tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Component Status */}
      {components.length > 0 && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
            <h3 style={{ margin: 0 }}>{t('stats.componentStatus')}</h3>
            <button
              className="btn sm secondary"
              onClick={async () => {
                setTesting(true); setConnTest(null);
                try { setConnTest(await testConnections()); } catch (e: any) { setConnTest({ _error: e.message }); }
                setTesting(false);
              }}
              disabled={testing}
              style={{ fontSize: 11, padding: '4px 12px' }}
            >
              {testing ? t('settings.testing') : t('settings.testConnection')}
            </button>
          </div>
          {connTest && !connTest._error && (
            <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
              {Object.entries(connTest).map(([key, val]: [string, any]) => (
                <div key={key} style={{
                  fontSize: 12, padding: '6px 12px', borderRadius: 'var(--radius-full)',
                  background: val.ok ? 'var(--color-success-muted)' : 'var(--color-danger-muted)',
                  border: `1px solid ${val.ok ? 'var(--color-success-border)' : 'var(--color-danger-border)'}`,
                  display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
                  fontWeight: 500,
                  transition: 'var(--transition-base)',
                }}>
                  <span className={`status-dot ${val.ok ? 'ok' : 'error'}`} style={{ marginRight: 0 }} />
                  <span style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 11 }}>{key}</span>
                  <span style={{ color: val.ok ? 'var(--color-success)' : 'var(--color-danger)', fontFamily: 'var(--font-mono)' }}>
                    {val.ok ? `${val.latencyMs}ms` : val.error || t('common.error')}
                  </span>
                </div>
              ))}
            </div>
          )}
          {connTest?._error && (
            <div style={{
              color: 'var(--color-danger)', fontSize: 12, marginBottom: 'var(--space-3)',
              padding: '8px 12px', background: 'var(--color-danger-muted)',
              borderRadius: 'var(--radius-md)', border: '1px solid var(--color-danger-border)',
            }}>
              {connTest._error}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--space-3)' }}>
            {components.map((c: any) => {
              const statusClass = c.status === 'ok' ? 'ok' : c.status === 'warning' ? 'warning' : c.status === 'error' || c.status === 'stopped' ? 'error' : 'inactive';
              const statusLabel = c.status === 'ok' ? t('stats.statusOk') : c.status === 'warning' ? t('stats.statusWarning') : c.status === 'error' ? t('stats.statusError') : c.status === 'stopped' ? t('stats.statusStopped') : c.status === 'not_configured' ? t('stats.statusNotConfigured') : t('stats.statusUnknown');
              const statusBg = c.status === 'ok' ? 'var(--color-success-muted)' : c.status === 'warning' ? 'var(--color-warning-muted)' : c.status === 'error' || c.status === 'stopped' ? 'var(--color-danger-muted)' : 'var(--color-overlay)';
              const statusFg = c.status === 'ok' ? 'var(--color-success)' : c.status === 'warning' ? 'var(--color-warning)' : c.status === 'error' || c.status === 'stopped' ? 'var(--color-danger)' : 'var(--color-text-tertiary)';
              const ago = c.lastRun ? timeAgo(c.lastRun, t) : null;
              return (
                <div key={c.id} style={{
                  background: 'var(--color-base)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-lg)',
                  padding: 'var(--space-4)',
                  transition: 'border-color var(--transition-base), box-shadow var(--transition-base)',
                  position: 'relative',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: `linear-gradient(135deg, ${statusFg}08 0%, transparent 60%)`,
                    pointerEvents: 'none',
                  }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)', position: 'relative' }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-text-primary)' }}>{c.name}</span>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center',
                      padding: '2px 10px', borderRadius: 'var(--radius-full)',
                      fontSize: 11, fontWeight: 600,
                      background: statusBg, color: statusFg,
                    }}>
                      <span className={`status-dot ${statusClass}`} />
                      {statusLabel}
                    </span>
                  </div>
                  {ago && (
                    <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-1)', position: 'relative' }}>
                      {t('stats.lastRun')}<span style={{ fontFamily: 'var(--font-mono)' }}>{ago}</span>
                    </div>
                  )}
                  {c.latencyMs != null && (
                    <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-1)', position: 'relative' }}>
                      {t('stats.latency')}<span style={{ fontFamily: 'var(--font-mono)' }}>{c.latencyMs}ms</span>
                    </div>
                  )}
                  {c.details && (
                    <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', position: 'relative' }}>
                      {c.id === 'extraction_llm' && <>
                        {t('stats.channel')}{c.details.channel}{t('stats.last24h', { count: c.details.last24h })}
                        {c.details.errorsLast24h > 0 && <span style={{ color: 'var(--color-danger)' }}>{t('stats.errors24h', { count: c.details.errorsLast24h })}</span>}
                      </>}
                      {c.id === 'lifecycle' && <>
                        {t('stats.trigger')}{c.details.trigger === 'scheduled' ? t('stats.triggerScheduled') : c.details.trigger === 'manual' ? t('stats.triggerManual') : c.details.trigger || '-'}
                        {' · '}{t('stats.promoted')}{c.details.promoted ?? 0} · {t('stats.archived')}{c.details.archived ?? 0}
                      </>}
                      {c.id === 'embedding' && <>
                        {t('stats.modelLabel')}{c.details.model}
                      </>}
                      {c.id === 'scheduler' && <>
                        {t('stats.schedule')}{c.details.schedule || '-'}
                        {c.details.nextRun && <>{t('stats.nextRun')}{timeAgo(c.details.nextRun, t, true)}</>}
                      </>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recall Tester */}
      <div className="card">
        <h3 style={{ marginBottom: 'var(--space-3)' }}>{t('stats.recallTester')}</h3>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', alignItems: 'center' }}>
          <select
            value={recallAgent}
            onChange={e => setRecallAgent(e.target.value)}
            style={{ fontSize: 13, padding: '6px 8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-base)', color: 'var(--color-text-primary)', width: 'auto', maxWidth: 140, flexShrink: 0, transition: 'border-color var(--transition-base)' }}
          >
            {agents.map((a: any) => (
              <option key={a.id} value={a.id}>{a.name || a.id}</option>
            ))}
          </select>
          <input
            type="text"
            value={recallQuery}
            onChange={e => setRecallQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && recallQuery.trim()) {
                setRecalling(true);
                recallApi({ query: recallQuery, agent_id: recallAgent || undefined, skip_filters: true })
                  .then((r: any) => { setRecallResults(r); setRecalling(false); })
                  .catch(() => { setRecallResults({ memories: [], meta: {} }); setRecalling(false); });
              }
            }}
            placeholder={t('stats.recallPlaceholder')}
            style={{ flex: 1, fontSize: 13, padding: '6px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-base)', color: 'var(--color-text-primary)', transition: 'border-color var(--transition-base), box-shadow var(--transition-base)' }}
          />
          <button
            className="btn primary sm"
            disabled={recalling || !recallQuery.trim()}
            onClick={async () => {
              setRecalling(true);
              try {
                const r = await recallApi({ query: recallQuery, agent_id: recallAgent || undefined, skip_filters: true });
                setRecallResults(r);
              } catch { setRecallResults({ memories: [], meta: {} }); }
              setRecalling(false);
            }}
            style={{ flexShrink: 0 }}
          >
            {recalling ? '...' : t('common.search')}
          </button>
        </div>
        {recallResults !== null && (() => {
          const memories = recallResults.memories || [];
          const meta = recallResults.meta || {};
          const injected = meta.injected_count ?? memories.length;
          const totalFound = meta.total_found ?? 0;
          const latency = meta.latency_ms ?? 0;
          // Parse fixed injection lines from context (persona lines before search results)
          const contextStr = recallResults.context || '';
          const contextLines = contextStr.split('\n').filter((l: string) => l.startsWith('['));
          const memoryIds = new Set(memories.map((m: any) => m.id));
          // Fixed lines are context lines whose content doesn't match any search result
          const fixedLines: string[] = [];
          for (const line of contextLines) {
            const lineContent = line.replace(/^\[[^\]]*\]\s*/, '');
            const isSearchResult = memories.some((m: any) => lineContent && m.content && m.content.startsWith(lineContent.slice(0, 30)));
            if (!isSearchResult) fixedLines.push(line);
          }
          const fixedCount = fixedLines.length;
          const searchCount = Math.max(0, injected - fixedCount);
          const relationsMatch = contextStr.match(/<cortex_relations>([\s\S]*?)<\/cortex_relations>/);
          const relationLines = relationsMatch
            ? relationsMatch[1].split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0)
            : [];
          return (
            <div>
              <div style={{
                fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)',
                display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center',
                padding: '8px 12px', background: 'var(--color-base)', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border-subtle)',
              }}>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{t('stats.recallFound', { total: totalFound })}</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{fixedCount > 0
                  ? t('stats.recallInjectedBreakdown', { search: searchCount, fixed: fixedCount })
                  : t('stats.recallInjected', { count: injected })
                }</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{latency}ms</span>
                {meta.relations_count ? (
                  <span
                    style={{ cursor: relationLines.length > 0 ? 'pointer' : 'default', userSelect: 'none', transition: 'color var(--transition-base)' }}
                    onClick={() => { if (relationLines.length > 0) setRelationsExpanded(!relationsExpanded); }}
                    title={relationLines.length > 0 ? (relationsExpanded ? 'Click to collapse' : 'Click to expand') : ''}
                  >
                    {meta.relations_count} {t('stats.recallRelations')} {relationLines.length > 0 ? (relationsExpanded ? '▾' : '▸') : ''}
                  </span>
                ) : null}
              </div>
              {relationsExpanded && relationLines.length > 0 && (
                <div style={{
                  fontSize: 12, marginBottom: 'var(--space-2)', padding: '8px 12px',
                  background: 'var(--color-base)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                  maxHeight: 200, overflowY: 'auto',
                  boxShadow: 'var(--shadow-sm)',
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 'var(--space-1)', color: 'var(--color-text-secondary)' }}>
                    {t('stats.recallRelationsTitle')}
                  </div>
                  {relationLines.map((line: string, i: number) => (
                    <div key={i} style={{ color: 'var(--color-text-primary)', lineHeight: 1.5, paddingLeft: 'var(--space-1)' }}>{line}</div>
                  ))}
                </div>
              )}
              {fixedLines.length > 0 && (
                <div
                  style={{
                    padding: '8px 12px', marginBottom: 'var(--space-1)',
                    background: 'var(--color-base)', border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)', fontSize: 12, borderStyle: 'dashed',
                    cursor: 'pointer', userSelect: 'none',
                    transition: 'border-color var(--transition-base)',
                  }}
                  onClick={() => setFixedExpanded(!fixedExpanded)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>
                      <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 700, marginRight: 'var(--space-2)', fontFamily: 'var(--font-mono)' }}>#0</span>
                      <span style={{ fontWeight: 600 }}>{t('stats.recallFixed')}</span>
                      <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 'var(--space-2)' }}>{fixedExpanded ? '▾' : '▸'}</span>
                    </span>
                    <span style={{ color: 'var(--color-text-tertiary)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>{fixedCount} {t('stats.recallFixedCount')}</span>
                  </div>
                  {fixedExpanded && fixedLines.map((line: string, i: number) => (
                    <div key={i} style={{ color: 'var(--color-text-primary)', lineHeight: 1.5, marginTop: i === 0 ? 'var(--space-1)' : 0 }}>{line}</div>
                  ))}
                </div>
              )}
              {memories.map((m: any, i: number) => (
                <div key={m.id || i} style={{
                  padding: '8px 12px', marginBottom: 'var(--space-1)',
                  background: 'var(--color-base)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)', fontSize: 12,
                  transition: 'border-color var(--transition-base)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-1)', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
                    <span>
                      <span style={{ color: 'var(--color-primary)', fontWeight: 700, marginRight: 'var(--space-2)', fontFamily: 'var(--font-mono)' }}>#{i + 1}</span>
                      <span style={{ fontWeight: 600 }}>{m.category}</span>
                    </span>
                    <span style={{ color: 'var(--color-text-tertiary)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                      {m.finalScore != null ? `score ${Number(m.finalScore).toFixed(3)}` : ''}
                      {m.importance != null ? ` · imp ${m.importance}` : ''}
                      {m.layer ? ` · ${m.layer}` : ''}
                    </span>
                  </div>
                  <div style={{ color: 'var(--color-text-primary)', lineHeight: 1.4 }}>{m.content}</div>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
