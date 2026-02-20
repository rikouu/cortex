import React, { useEffect, useState } from 'react';
import { getLifecycleLogs, runLifecycle, previewLifecycle, getConfig, listMemories } from '../api/client.js';

interface PreviewDetail {
  promoted: number;
  merged: number;
  archived: number;
  compressedToCore: number;
  expiredWorking: number;
}

export default function LifecycleMonitor() {
  const [logs, setLogs] = useState<any[]>([]);
  const [preview, setPreview] = useState<PreviewDetail | null>(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [layerStats, setLayerStats] = useState<{ working: number; core: number; archive: number }>({ working: 0, core: 0, archive: 0 });
  const [affectedMemories, setAffectedMemories] = useState<any[]>([]);
  const [showAffected, setShowAffected] = useState(false);

  useEffect(() => {
    getLifecycleLogs(30).then(setLogs);
    getConfig().then(setConfig).catch(() => {});
    // Get layer stats
    Promise.all([
      listMemories({ layer: 'working', limit: '1', offset: '0' }),
      listMemories({ layer: 'core', limit: '1', offset: '0' }),
      listMemories({ layer: 'archive', limit: '1', offset: '0' }),
    ]).then(([w, c, a]: any[]) => {
      setLayerStats({ working: w.total, core: c.total, archive: a.total });
    }).catch(() => {});
  }, []);

  const handlePreview = async () => {
    const result = await previewLifecycle();
    setPreview(result);

    // Load potentially affected working memories (low importance)
    try {
      const res = await listMemories({ layer: 'working', limit: '20', offset: '0' });
      setAffectedMemories(res.items || []);
    } catch {}
  };

  const handleRun = async () => {
    if (!confirm('Run lifecycle engine now? This will promote, merge, archive, and compress memories.')) return;
    setRunning(true);
    try {
      const result = await runLifecycle(false);
      setRunResult(result);
      getLifecycleLogs(30).then(setLogs);
      // Refresh layer stats
      Promise.all([
        listMemories({ layer: 'working', limit: '1', offset: '0' }),
        listMemories({ layer: 'core', limit: '1', offset: '0' }),
        listMemories({ layer: 'archive', limit: '1', offset: '0' }),
      ]).then(([w, c, a]: any[]) => {
        setLayerStats({ working: w.total, core: c.total, archive: a.total });
      }).catch(() => {});
    } catch (e: any) {
      alert(e.message);
    }
    setRunning(false);
  };

  // Parse cron for human-readable schedule
  const parseCron = (cron: string) => {
    if (!cron) return 'Not configured';
    const parts = cron.split(' ');
    if (parts.length !== 5) return cron;
    const [min, hour, dom, mon, dow] = parts;
    const dayMap: Record<string, string> = { '0': 'Sun', '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat' };

    let desc = '';
    if (min === '0' && hour !== '*' && dom === '*' && mon === '*' && dow === '*') {
      desc = `Daily at ${hour!.padStart(2, '0')}:00`;
    } else if (min !== '*' && hour !== '*' && dom === '*' && mon === '*' && dow !== '*') {
      const days = dow!.split(',').map(d => dayMap[d] || d).join(', ');
      desc = `${days} at ${hour!.padStart(2, '0')}:${min!.padStart(2, '0')}`;
    } else if (min === '*' && hour === '*') {
      desc = 'Every minute';
    } else {
      desc = cron;
    }
    return desc;
  };

  // Lifecycle action history stats
  const actionCounts: Record<string, number> = {};
  logs.forEach(l => {
    const action = l.action || 'unknown';
    actionCounts[action] = (actionCounts[action] || 0) + 1;
  });

  const totalOps = preview
    ? (preview.promoted + preview.merged + preview.archived + preview.compressedToCore + preview.expiredWorking)
    : 0;

  return (
    <div>
      <h1 className="page-title">Lifecycle Engine</h1>

      {/* Schedule & Config Info */}
      {config && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12 }}>Schedule & Configuration</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>SCHEDULE</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{parseCron(config.lifecycle?.schedule)}</div>
              <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{config.lifecycle?.schedule}</code>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>PROMOTION THRESHOLD</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{config.lifecycle?.promotionThreshold}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>importance score to promote working to core</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>ARCHIVE THRESHOLD</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{config.lifecycle?.archiveThreshold}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>decay score to archive core memories</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>DECAY LAMBDA</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{config.lifecycle?.decayLambda}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>exponential decay rate</div>
            </div>
          </div>
        </div>
      )}

      {/* Layer Distribution (before/after) */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 12 }}>Current Layer Distribution</h3>
        <div style={{ display: 'flex', height: 32, borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
          {[
            { label: 'Working', value: layerStats.working, color: '#4ade80' },
            { label: 'Core', value: layerStats.core, color: '#818cf8' },
            { label: 'Archive', value: layerStats.archive, color: '#a1a1aa' },
          ].map((seg, i) => {
            const total = layerStats.working + layerStats.core + layerStats.archive;
            return (
              <div key={i} style={{
                width: total > 0 ? `${(seg.value / total) * 100}%` : '33.3%',
                background: seg.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 600, color: '#fff', minWidth: seg.value > 0 ? 32 : 0,
              }}>
                {seg.value > 0 && `${seg.label}: ${seg.value}`}
              </div>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="toolbar">
        <button className="btn" onClick={handlePreview}>Preview (dry-run)</button>
        <button className="btn primary" onClick={handleRun} disabled={running}>
          {running ? 'Running...' : 'Run Now'}
        </button>
      </div>

      {/* Preview result */}
      {preview && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12 }}>Preview (Dry Run) — {totalOps} operations pending</h3>
          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
            <div className="stat-card">
              <div className="label">Would Promote</div>
              <div className="value" style={{ color: 'var(--success)' }}>{preview.promoted}</div>
            </div>
            <div className="stat-card">
              <div className="label">Would Merge</div>
              <div className="value" style={{ color: 'var(--info)' }}>{preview.merged}</div>
            </div>
            <div className="stat-card">
              <div className="label">Would Archive</div>
              <div className="value" style={{ color: 'var(--warning)' }}>{preview.archived}</div>
            </div>
            <div className="stat-card">
              <div className="label">Would Compress</div>
              <div className="value" style={{ color: 'var(--danger)' }}>{preview.compressedToCore}</div>
            </div>
            <div className="stat-card">
              <div className="label">Expired Working</div>
              <div className="value">{preview.expiredWorking}</div>
            </div>
          </div>

          {/* Show affected memories toggle */}
          {affectedMemories.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => setShowAffected(!showAffected)} style={{ fontSize: 12 }}>
                {showAffected ? 'Hide' : 'Show'} Working Memories ({affectedMemories.length})
              </button>
              {showAffected && (
                <div style={{ marginTop: 12 }}>
                  <table style={{ fontSize: 12 }}>
                    <thead>
                      <tr><th>Content</th><th>Importance</th><th>Decay</th><th>Age</th><th>Likely Action</th></tr>
                    </thead>
                    <tbody>
                      {affectedMemories.map((m: any) => {
                        const importance = m.importance ?? 0;
                        const decay = m.decay_score ?? 1;
                        let action = 'Keep';
                        if (importance >= (config?.lifecycle?.promotionThreshold ?? 0.6)) action = 'Promote';
                        else if (decay < (config?.lifecycle?.archiveThreshold ?? 0.2)) action = 'Expire';
                        const actionColor = action === 'Promote' ? 'var(--success)' : action === 'Expire' ? 'var(--danger)' : 'var(--text-muted)';
                        return (
                          <tr key={m.id}>
                            <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.content}</td>
                            <td>{importance.toFixed(2)}</td>
                            <td>{decay.toFixed(3)}</td>
                            <td>{m.created_at?.slice(0, 10)}</td>
                            <td style={{ color: actionColor, fontWeight: 600 }}>{action}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Run result */}
      {runResult && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--success)' }}>
          <h3 style={{ marginBottom: 12 }}>Last Run Result</h3>
          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
            <div className="stat-card"><div className="label">Promoted</div><div className="value">{runResult.promoted}</div></div>
            <div className="stat-card"><div className="label">Merged</div><div className="value">{runResult.merged}</div></div>
            <div className="stat-card"><div className="label">Archived</div><div className="value">{runResult.archived}</div></div>
            <div className="stat-card"><div className="label">Compressed</div><div className="value">{runResult.compressedToCore}</div></div>
            <div className="stat-card"><div className="label">Duration</div><div className="value">{runResult.durationMs}ms</div></div>
          </div>
          {runResult.errors?.length > 0 && (
            <div style={{ marginTop: 12, color: 'var(--danger)' }}>
              Errors: {runResult.errors.join(', ')}
            </div>
          )}
        </div>
      )}

      {/* History action summary */}
      {Object.keys(actionCounts).length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12 }}>Action Summary (last {logs.length} events)</h3>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {Object.entries(actionCounts).map(([action, count]) => (
              <div key={action} className="stat-card" style={{ padding: 12, minWidth: 100 }}>
                <div className="label">{action}</div>
                <div className="value" style={{ fontSize: 20 }}>{count}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History */}
      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Lifecycle History</h3>
        {logs.length === 0 ? (
          <div className="empty">No lifecycle events yet</div>
        ) : (
          <table>
            <thead>
              <tr><th>Action</th><th>Memory IDs</th><th>Details</th><th>Time</th></tr>
            </thead>
            <tbody>
              {logs.map((log: any) => (
                <tr key={log.id}>
                  <td><span className="badge" style={{ background: 'rgba(99,102,241,0.2)', color: '#818cf8' }}>{log.action}</span></td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.memory_ids}</td>
                  <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.details || '—'}</td>
                  <td>{log.executed_at?.slice(0, 19)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
