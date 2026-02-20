import React, { useEffect, useState, useRef } from 'react';
import { getStats, getHealth, listMemories } from '../api/client.js';

// ─── Mini Canvas Bar Chart ──────────────────────────────────────────────────

function BarChart({ data, colors, height = 160 }: { data: { label: string; value: number }[]; colors: string[]; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width;
    const H = canvas.height;
    const max = Math.max(...data.map(d => d.value), 1);
    const barW = Math.min(60, (W - 40) / data.length - 10);
    const startX = (W - data.length * (barW + 10) + 10) / 2;

    ctx.clearRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = 20 + (H - 50) * (1 - i / 4);
      ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(W - 10, y); ctx.stroke();
      ctx.fillStyle = '#71717a';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'right';
      ctx.fillText(String(Math.round(max * i / 4)), 26, y + 3);
    }

    data.forEach((d, i) => {
      const x = startX + i * (barW + 10);
      const barH = (d.value / max) * (H - 50);
      const y = H - 30 - barH;

      // Bar with gradient
      const grad = ctx.createLinearGradient(x, y, x, H - 30);
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

      // Label
      ctx.fillStyle = '#71717a';
      ctx.font = '11px system-ui';
      ctx.fillText(d.label, x + barW / 2, H - 10);
    });
  }, [data, colors, height]);

  return <canvas ref={canvasRef} width={500} height={height} style={{ width: '100%', height: 'auto' }} />;
}

// ─── Horizontal Distribution Bar ────────────────────────────────────────────

function DistributionBar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No data</div>;
  return (
    <div>
      <div style={{ display: 'flex', height: 28, borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
        {segments.map((seg, i) => (
          <div
            key={i}
            style={{
              width: `${(seg.value / total) * 100}%`,
              background: seg.color,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 600, color: '#fff',
              minWidth: seg.value > 0 ? 24 : 0,
              transition: 'width 0.3s',
            }}
          >
            {seg.value > 0 && ((seg.value / total) > 0.08 ? seg.value : '')}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {segments.map((seg, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: seg.color }} />
            <span style={{ color: 'var(--text-muted)' }}>{seg.label}</span>
            <span style={{ fontWeight: 600 }}>{seg.value}</span>
            <span style={{ color: 'var(--text-muted)' }}>({total > 0 ? ((seg.value / total) * 100).toFixed(1) : 0}%)</span>
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
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width;
    const H = canvas.height;

    // Build 10 buckets [0,0.1), [0.1,0.2), ... [0.9,1.0]
    const buckets = new Array(10).fill(0);
    for (const v of values) {
      const idx = Math.min(Math.floor(v * 10), 9);
      buckets[idx]++;
    }
    const max = Math.max(...buckets, 1);
    const barW = (W - 50) / 10 - 2;

    ctx.clearRect(0, 0, W, H);

    // Y axis
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
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

  return <canvas ref={canvasRef} width={300} height={140} style={{ width: '100%', height: 'auto' }} />;
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function Stats() {
  const [stats, setStats] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [error, setError] = useState('');
  const [allMemories, setAllMemories] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([getStats(), getHealth()])
      .then(([s, h]) => { setStats(s); setHealth(h); })
      .catch(e => setError(e.message));

    // Load sample memories for distribution histograms
    listMemories({ limit: '500', offset: '0' })
      .then((r: any) => setAllMemories(r.items || []))
      .catch(() => {});
  }, []);

  if (error) return <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>;
  if (!stats) return <div className="loading">Loading...</div>;

  const layers = stats.layers || {};
  const categories = stats.categories || {};

  const layerSegments = [
    { label: 'Core', value: layers.core || 0, color: '#818cf8' },
    { label: 'Working', value: layers.working || 0, color: '#4ade80' },
    { label: 'Archive', value: layers.archive || 0, color: '#a1a1aa' },
  ];

  const catData = Object.entries(categories).map(([cat, cnt]) => ({
    label: cat.length > 10 ? cat.slice(0, 9) + '.' : cat,
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
      <h1 className="page-title">Dashboard</h1>

      {/* Stat Cards */}
      <div className="card-grid">
        <div className="stat-card">
          <div className="label">Total Memories</div>
          <div className="value">{stats.total_memories}</div>
        </div>
        <div className="stat-card">
          <div className="label">Core</div>
          <div className="value" style={{ color: '#818cf8' }}>{layers.core || 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">Working</div>
          <div className="value" style={{ color: '#4ade80' }}>{layers.working || 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">Archive</div>
          <div className="value" style={{ color: '#a1a1aa' }}>{layers.archive || 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">Relations</div>
          <div className="value">{stats.total_relations}</div>
        </div>
        <div className="stat-card">
          <div className="label">Access Logs</div>
          <div className="value">{stats.total_access_logs}</div>
        </div>
      </div>

      {/* Layer Distribution */}
      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Layer Distribution</h3>
        <DistributionBar segments={layerSegments} />
      </div>

      {/* Category Chart */}
      {catData.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Categories</h3>
          <BarChart data={catData} colors={catColors} height={180} />
        </div>
      )}

      {/* Score Distributions */}
      {allMemories.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Score Distributions</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
            <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius)', padding: 12 }}>
              <Histogram values={importanceValues} label="Importance" color="#6366f1" />
            </div>
            <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius)', padding: 12 }}>
              <Histogram values={decayValues} label="Decay Score" color="#f59e0b" />
            </div>
            <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius)', padding: 12 }}>
              <Histogram values={confidenceValues} label="Confidence" color="#22c55e" />
            </div>
          </div>
        </div>
      )}

      {/* System Health */}
      {health && (
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>System Health</h3>
          <table>
            <tbody>
              <tr><td>Status</td><td><span style={{ color: health.status === 'ok' ? 'var(--success)' : 'var(--danger)' }}>● {health.status}</span></td></tr>
              <tr><td>Version</td><td>{health.version}</td></tr>
              <tr><td>Uptime</td><td>{formatUptime(health.uptime)}</td></tr>
              <tr><td>Timestamp</td><td>{health.timestamp}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
