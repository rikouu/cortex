import React, { useEffect, useState } from 'react';
import { getStats, getHealth } from '../api/client.js';

export default function Stats() {
  const [stats, setStats] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([getStats(), getHealth()])
      .then(([s, h]) => { setStats(s); setHealth(h); })
      .catch(e => setError(e.message));
  }, []);

  if (error) return <div className="card" style={{color: 'var(--danger)'}}>Error: {error}</div>;
  if (!stats) return <div className="loading">Loading...</div>;

  const layers = stats.layers || {};
  const categories = stats.categories || {};

  return (
    <div>
      <h1 className="page-title">Dashboard</h1>

      <div className="card-grid">
        <div className="stat-card">
          <div className="label">Total Memories</div>
          <div className="value">{stats.total_memories}</div>
        </div>
        <div className="stat-card">
          <div className="label">Core</div>
          <div className="value" style={{color: '#818cf8'}}>{layers.core || 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">Working</div>
          <div className="value" style={{color: '#4ade80'}}>{layers.working || 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">Archive</div>
          <div className="value" style={{color: '#a1a1aa'}}>{layers.archive || 0}</div>
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

      {health && (
        <div className="card">
          <h3 style={{marginBottom: 12}}>System Health</h3>
          <table>
            <tbody>
              <tr><td>Status</td><td><span style={{color: health.status === 'ok' ? 'var(--success)' : 'var(--danger)'}}>● {health.status}</span></td></tr>
              <tr><td>Version</td><td>{health.version}</td></tr>
              <tr><td>Uptime</td><td>{Math.floor(health.uptime)}s</td></tr>
              <tr><td>Timestamp</td><td>{health.timestamp}</td></tr>
            </tbody>
          </table>
        </div>
      )}

      {Object.keys(categories).length > 0 && (
        <div className="card">
          <h3 style={{marginBottom: 12}}>Categories</h3>
          <table>
            <thead><tr><th>Category</th><th>Count</th></tr></thead>
            <tbody>
              {Object.entries(categories).map(([cat, cnt]) => (
                <tr key={cat}><td>{cat}</td><td>{cnt as number}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
