import React, { useEffect, useState } from 'react';
import { getLifecycleLogs, runLifecycle, previewLifecycle } from '../api/client.js';

export default function LifecycleMonitor() {
  const [logs, setLogs] = useState<any[]>([]);
  const [preview, setPreview] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<any>(null);

  useEffect(() => {
    getLifecycleLogs(20).then(setLogs);
  }, []);

  const handlePreview = async () => {
    const result = await previewLifecycle();
    setPreview(result);
  };

  const handleRun = async () => {
    if (!confirm('Run lifecycle engine now? This will promote, merge, archive, and compress memories.')) return;
    setRunning(true);
    try {
      const result = await runLifecycle(false);
      setRunResult(result);
      getLifecycleLogs(20).then(setLogs);
    } catch (e: any) {
      alert(e.message);
    }
    setRunning(false);
  };

  return (
    <div>
      <h1 className="page-title">Lifecycle Engine</h1>

      <div className="toolbar">
        <button className="btn" onClick={handlePreview}>👁️ Preview (dry-run)</button>
        <button className="btn primary" onClick={handleRun} disabled={running}>
          {running ? '⏳ Running...' : '▶️ Run Now'}
        </button>
      </div>

      {/* Preview result */}
      {preview && (
        <div className="card" style={{marginBottom: 16}}>
          <h3 style={{marginBottom: 12}}>Preview (Dry Run)</h3>
          <div className="card-grid" style={{gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))'}}>
            <div className="stat-card">
              <div className="label">Would Promote</div>
              <div className="value" style={{color: 'var(--success)'}}>{preview.promoted}</div>
            </div>
            <div className="stat-card">
              <div className="label">Would Merge</div>
              <div className="value" style={{color: 'var(--info)'}}>{preview.merged}</div>
            </div>
            <div className="stat-card">
              <div className="label">Would Archive</div>
              <div className="value" style={{color: 'var(--warning)'}}>{preview.archived}</div>
            </div>
            <div className="stat-card">
              <div className="label">Would Compress</div>
              <div className="value" style={{color: 'var(--danger)'}}>{preview.compressedToCore}</div>
            </div>
            <div className="stat-card">
              <div className="label">Expired Working</div>
              <div className="value">{preview.expiredWorking}</div>
            </div>
          </div>
        </div>
      )}

      {/* Run result */}
      {runResult && (
        <div className="card" style={{marginBottom: 16, borderColor: 'var(--success)'}}>
          <h3 style={{marginBottom: 12}}>✅ Last Run Result</h3>
          <div className="card-grid" style={{gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))'}}>
            <div className="stat-card"><div className="label">Promoted</div><div className="value">{runResult.promoted}</div></div>
            <div className="stat-card"><div className="label">Merged</div><div className="value">{runResult.merged}</div></div>
            <div className="stat-card"><div className="label">Archived</div><div className="value">{runResult.archived}</div></div>
            <div className="stat-card"><div className="label">Compressed</div><div className="value">{runResult.compressedToCore}</div></div>
            <div className="stat-card"><div className="label">Duration</div><div className="value">{runResult.durationMs}ms</div></div>
          </div>
          {runResult.errors?.length > 0 && (
            <div style={{marginTop: 12, color: 'var(--danger)'}}>
              Errors: {runResult.errors.join(', ')}
            </div>
          )}
        </div>
      )}

      {/* History */}
      <div className="card">
        <h3 style={{marginBottom: 12}}>Lifecycle History</h3>
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
                  <td><span className="badge" style={{background: 'rgba(99,102,241,0.2)', color: '#818cf8'}}>{log.action}</span></td>
                  <td style={{maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{log.memory_ids}</td>
                  <td style={{maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{log.details || '—'}</td>
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
