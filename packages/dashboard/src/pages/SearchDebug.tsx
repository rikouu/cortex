import React, { useState } from 'react';
import { search } from '../api/client.js';

export default function SearchDebug() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [debug, setDebug] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await search({ query, debug: true, limit: 20 });
      setResults(res.results || []);
      setDebug(res.debug || null);
    } catch (e: any) {
      alert(e.message);
    }
    setLoading(false);
  };

  return (
    <div>
      <h1 className="page-title">Search Debug</h1>

      <div className="search-bar">
        <input
          placeholder="Search memories..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
        />
        <button className="btn primary" onClick={handleSearch} disabled={loading}>
          {loading ? '...' : '🔍 Search'}
        </button>
      </div>

      {debug && (
        <div className="card" style={{marginBottom: 16}}>
          <h3 style={{marginBottom: 8}}>Debug Info</h3>
          <div style={{display: 'flex', gap: 24, fontSize: 13}}>
            <span>Text results: {debug.textResultCount}</span>
            <span>Vector results: {debug.vectorResultCount}</span>
            <span>Fused: {debug.fusedCount}</span>
            <span>Text: {debug.timings?.textMs}ms</span>
            <span>Vector: {debug.timings?.vectorMs}ms</span>
            <span>Total: {debug.timings?.totalMs}ms</span>
          </div>
        </div>
      )}

      {results.length === 0 && !loading && query && (
        <div className="empty">No results found</div>
      )}

      {results.map((r, i) => (
        <div key={r.id} className="memory-card">
          <div className="header">
            <span style={{color: 'var(--text-muted)', fontSize: 12, fontWeight: 600}}>#{i + 1}</span>
            <span className={`badge ${r.layer}`}>{r.layer}</span>
            <span className="badge" style={{background: 'rgba(59,130,246,0.2)', color: '#60a5fa'}}>{r.category}</span>
            <span style={{marginLeft: 'auto', fontSize: 12, color: 'var(--primary)', fontWeight: 600}}>
              Score: {r.finalScore?.toFixed(4)}
            </span>
          </div>
          <div className="content">{r.content}</div>
          <div style={{marginTop: 10}}>
            <table style={{fontSize: 12}}>
              <tbody>
                <tr>
                  <td style={{color: 'var(--text-muted)'}}>Text Score</td>
                  <td>
                    <div className="score-bar">
                      <div className="bar"><div className="fill" style={{width: `${r.textScore * 100}%`}} /></div>
                      <span>{r.textScore?.toFixed(3)}</span>
                    </div>
                  </td>
                  <td style={{color: 'var(--text-muted)'}}>Vector Score</td>
                  <td>
                    <div className="score-bar">
                      <div className="bar"><div className="fill" style={{width: `${r.vectorScore * 100}%`, background: 'var(--success)'}} /></div>
                      <span>{r.vectorScore?.toFixed(3)}</span>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style={{color: 'var(--text-muted)'}}>Layer Weight</td><td>{r.layerWeight?.toFixed(2)}</td>
                  <td style={{color: 'var(--text-muted)'}}>Recency Boost</td><td>{r.recencyBoost?.toFixed(3)}</td>
                </tr>
                <tr>
                  <td style={{color: 'var(--text-muted)'}}>Access Boost</td><td>{r.accessBoost?.toFixed(2)}</td>
                  <td style={{color: 'var(--text-muted)'}}>Decay Score</td><td>{r.decay_score?.toFixed(3)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
