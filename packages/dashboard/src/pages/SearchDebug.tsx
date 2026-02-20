import React, { useState } from 'react';
import { search } from '../api/client.js';

interface SearchResult {
  id: string;
  content: string;
  layer: string;
  category: string;
  importance: number;
  decay_score: number;
  textScore: number;
  vectorScore: number;
  fusedScore: number;
  layerWeight: number;
  recencyBoost: number;
  accessBoost: number;
  finalScore: number;
}

interface SearchDebugInfo {
  textResultCount: number;
  vectorResultCount: number;
  fusedCount: number;
  timings: { textMs: number; vectorMs: number; fusionMs: number; totalMs: number };
}

interface SearchRun {
  label: string;
  results: SearchResult[];
  debug: SearchDebugInfo | null;
}

export default function SearchDebug() {
  const [query, setQuery] = useState('');
  const [runs, setRuns] = useState<SearchRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [compareMode, setCompareMode] = useState(false);

  const handleSearch = async (label?: string) => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await search({ query, debug: true, limit: 20 });
      const run: SearchRun = {
        label: label || `Search ${runs.length + 1}`,
        results: res.results || [],
        debug: res.debug || null,
      };

      if (compareMode) {
        setRuns(prev => [...prev, run]);
      } else {
        setRuns([run]);
      }
    } catch (e: any) {
      alert(e.message);
    }
    setLoading(false);
  };

  const clearRuns = () => setRuns([]);

  const renderResultCard = (r: SearchResult, i: number) => (
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
  );

  const renderDebug = (debug: SearchDebugInfo | null) => {
    if (!debug) return null;
    return (
      <div style={{display: 'flex', gap: 24, fontSize: 13, padding: '8px 0'}}>
        <span>Text: {debug.textResultCount}</span>
        <span>Vector: {debug.vectorResultCount}</span>
        <span>Fused: {debug.fusedCount}</span>
        <span>Text: {debug.timings?.textMs}ms</span>
        <span>Vector: {debug.timings?.vectorMs}ms</span>
        <span>Total: {debug.timings?.totalMs}ms</span>
      </div>
    );
  };

  return (
    <div>
      <h1 className="page-title">Search Debug</h1>

      <div className="search-bar" style={{marginBottom: 8}}>
        <input
          placeholder="Search memories..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
        />
        <button className="btn primary" onClick={() => handleSearch()} disabled={loading}>
          {loading ? '...' : '🔍 Search'}
        </button>
      </div>

      <div style={{display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center'}}>
        <label style={{fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer'}}>
          <input
            type="checkbox"
            checked={compareMode}
            onChange={e => setCompareMode(e.target.checked)}
          />
          Compare mode
        </label>
        {compareMode && runs.length > 0 && (
          <button className="btn" onClick={clearRuns} style={{fontSize: 12}}>Clear comparisons</button>
        )}
        {compareMode && <span style={{fontSize: 12, color: 'var(--text-muted)'}}>Run multiple searches to compare side-by-side</span>}
      </div>

      {/* Compare mode: side by side */}
      {compareMode && runs.length > 1 ? (
        <div>
          <div className="card" style={{marginBottom: 16}}>
            <h3 style={{marginBottom: 8}}>Comparison Summary</h3>
            <table style={{fontSize: 13, width: '100%'}}>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Text Results</th>
                  <th>Vector Results</th>
                  <th>Fused</th>
                  <th>Total Time</th>
                  <th>Top Score</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run, i) => (
                  <tr key={i}>
                    <td>{run.label}</td>
                    <td>{run.debug?.textResultCount ?? '-'}</td>
                    <td>{run.debug?.vectorResultCount ?? '-'}</td>
                    <td>{run.debug?.fusedCount ?? '-'}</td>
                    <td>{run.debug?.timings?.totalMs ?? '-'}ms</td>
                    <td>{run.results[0]?.finalScore?.toFixed(4) ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Overlap analysis */}
          {runs.length === 2 && (
            <div className="card" style={{marginBottom: 16}}>
              <h3 style={{marginBottom: 8}}>Result Overlap</h3>
              {(() => {
                const ids0 = new Set(runs[0]!.results.map(r => r.id));
                const ids1 = new Set(runs[1]!.results.map(r => r.id));
                const common = [...ids0].filter(id => ids1.has(id));
                const only0 = [...ids0].filter(id => !ids1.has(id));
                const only1 = [...ids1].filter(id => !ids0.has(id));
                return (
                  <div style={{fontSize: 13}}>
                    <span style={{color: 'var(--success)'}}>Common: {common.length}</span>
                    {' • '}
                    <span style={{color: '#f59e0b'}}>Only in {runs[0]!.label}: {only0.length}</span>
                    {' • '}
                    <span style={{color: '#ef4444'}}>Only in {runs[1]!.label}: {only1.length}</span>
                  </div>
                );
              })()}
            </div>
          )}

          <div style={{display: 'grid', gridTemplateColumns: `repeat(${Math.min(runs.length, 3)}, 1fr)`, gap: 16}}>
            {runs.map((run, ri) => (
              <div key={ri}>
                <h3 style={{marginBottom: 8}}>{run.label}</h3>
                {renderDebug(run.debug)}
                {run.results.map((r, i) => renderResultCard(r, i))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Single result view */
        <>
          {runs[0]?.debug && (
            <div className="card" style={{marginBottom: 16}}>
              <h3 style={{marginBottom: 8}}>Debug Info</h3>
              {renderDebug(runs[0].debug)}
            </div>
          )}

          {runs[0]?.results.length === 0 && !loading && query && (
            <div className="empty">No results found</div>
          )}

          {runs[0]?.results.map((r, i) => renderResultCard(r, i))}
        </>
      )}
    </div>
  );
}
