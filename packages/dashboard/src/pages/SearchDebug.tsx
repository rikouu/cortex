import React, { useState } from 'react';
import { search, getConfig, updateConfig } from '../api/client.js';
import { useI18n } from '../i18n/index.js';

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
  query: string;
  results: SearchResult[];
  debug: SearchDebugInfo | null;
}

export default function SearchDebug() {
  const [query, setQuery] = useState('');
  const [runs, setRuns] = useState<SearchRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showHelp, setShowHelp] = useState(false);

  // Weight tuning
  const [showTuner, setShowTuner] = useState(false);
  const [vectorWeight, setVectorWeight] = useState(0.7);
  const [textWeight, setTextWeight] = useState(0.3);
  const [weightsDirty, setWeightsDirty] = useState(false);

  const { t } = useI18n();

  const loadWeights = async () => {
    try {
      const cfg = await getConfig();
      setVectorWeight(cfg.search?.vectorWeight ?? 0.7);
      setTextWeight(cfg.search?.textWeight ?? 0.3);
      setWeightsDirty(false);
    } catch {}
  };

  const saveWeights = async () => {
    try {
      await updateConfig({ search: { vectorWeight, textWeight } });
      setWeightsDirty(false);
    } catch (e: any) {
      alert(t('searchDebug.saveFailed', { message: e.message }));
    }
  };

  const handleSearch = async (label?: string) => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await search({ query, debug: true, limit: 20 });
      const run: SearchRun = {
        label: label || `${t('searchDebug.run')} ${runs.length + 1}`,
        query,
        results: res.results || [],
        debug: res.debug || null,
      };

      if (compareMode) {
        setRuns(prev => [...prev, run]);
      } else {
        setRuns([run]);
      }

      // Update search history
      setSearchHistory(prev => {
        const next = [query, ...prev.filter(q => q !== query)].slice(0, 20);
        return next;
      });
    } catch (e: any) {
      alert(e.message);
    }
    setLoading(false);
  };

  const clearRuns = () => setRuns([]);

  const renderResultCard = (r: SearchResult, i: number) => (
    <div key={r.id} className="memory-card">
      <div className="header">
        <span style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 600 }}>#{i + 1}</span>
        <span className={`badge ${r.layer}`}>{r.layer}</span>
        <span className="badge" style={{ background: 'rgba(59,130,246,0.2)', color: '#60a5fa' }}>{r.category}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--primary)', fontWeight: 600 }}>
          {t('searchDebug.score')}: {r.finalScore?.toFixed(4)}
        </span>
      </div>
      <div className="content">{r.content}</div>
      <div style={{ marginTop: 10 }}>
        <table style={{ fontSize: 12 }}>
          <tbody>
            <tr>
              <td style={{ color: 'var(--text-muted)' }}>{t('searchDebug.textScore')}</td>
              <td>
                <div className="score-bar">
                  <div className="bar"><div className="fill" style={{ width: `${r.textScore * 100}%` }} /></div>
                  <span>{r.textScore?.toFixed(3)}</span>
                </div>
              </td>
              <td style={{ color: 'var(--text-muted)' }}>{t('searchDebug.vectorScore')}</td>
              <td>
                <div className="score-bar">
                  <div className="bar"><div className="fill" style={{ width: `${r.vectorScore * 100}%`, background: 'var(--success)' }} /></div>
                  <span>{r.vectorScore?.toFixed(3)}</span>
                </div>
              </td>
            </tr>
            <tr>
              <td style={{ color: 'var(--text-muted)' }}>{t('searchDebug.layerWeight')}</td><td>{r.layerWeight?.toFixed(2)}</td>
              <td style={{ color: 'var(--text-muted)' }}>{t('searchDebug.recencyBoost')}</td><td>{r.recencyBoost?.toFixed(3)}</td>
            </tr>
            <tr>
              <td style={{ color: 'var(--text-muted)' }}>{t('searchDebug.accessBoost')}</td><td>{r.accessBoost?.toFixed(2)}</td>
              <td style={{ color: 'var(--text-muted)' }}>{t('searchDebug.decayScore')}</td><td>{r.decay_score?.toFixed(3)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderDebug = (debug: SearchDebugInfo | null) => {
    if (!debug) return null;
    return (
      <div style={{ display: 'flex', gap: 24, fontSize: 13, padding: '8px 0', flexWrap: 'wrap' }}>
        <span>{t('searchDebug.text')}: {debug.textResultCount}</span>
        <span>{t('searchDebug.vector')}: {debug.vectorResultCount}</span>
        <span>{t('searchDebug.fused')}: {debug.fusedCount}</span>
        <span style={{ color: 'var(--text-muted)' }}>|</span>
        <span>{t('searchDebug.text')}: {debug.timings?.textMs}ms</span>
        <span>{t('searchDebug.vector')}: {debug.timings?.vectorMs}ms</span>
        <span>Fusion: {debug.timings?.fusionMs}ms</span>
        <span style={{ fontWeight: 600 }}>{t('searchDebug.totalTime')}: {debug.timings?.totalMs}ms</span>
      </div>
    );
  };

  return (
    <div>
      <h1 className="page-title">{t('searchDebug.title')}</h1>

      {/* Search bar */}
      <div className="search-bar" style={{ marginBottom: 8 }}>
        <input
          placeholder={t('searchDebug.searchPlaceholder')}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          list="search-history"
        />
        <datalist id="search-history">
          {searchHistory.map((q, i) => <option key={i} value={q} />)}
        </datalist>
        <button className="btn primary" onClick={() => handleSearch()} disabled={loading}>
          {loading ? '...' : t('common.search')}
        </button>
      </div>

      {/* Options row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={compareMode} onChange={e => setCompareMode(e.target.checked)} style={{ width: 'auto' }} />
          {t('searchDebug.compareMode')}
        </label>
        {compareMode && runs.length > 0 && (
          <button className="btn" onClick={clearRuns} style={{ fontSize: 12 }}>{t('searchDebug.clearComparisons')}</button>
        )}
        <button className="btn" onClick={() => { setShowTuner(!showTuner); if (!showTuner) loadWeights(); }} style={{ fontSize: 12 }}>
          {showTuner ? t('searchDebug.hide') : t('searchDebug.weightTuner')}
        </button>
        <button className="btn" onClick={() => setShowHelp(!showHelp)} style={{ fontSize: 12 }}>
          {showHelp ? t('searchDebug.hideHelp') : t('searchDebug.queryHelp')}
        </button>

        {/* Search history chips */}
        {searchHistory.length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginLeft: 8, flexWrap: 'wrap' }}>
            {searchHistory.slice(0, 8).map((q, i) => (
              <button
                key={i}
                className="btn"
                style={{ fontSize: 11, padding: '2px 8px', opacity: 0.7 }}
                onClick={() => { setQuery(q); }}
              >
                {q.length > 20 ? q.slice(0, 18) + '..' : q}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Query Help */}
      {showHelp && (
        <div className="card" style={{ marginBottom: 16, fontSize: 13 }}>
          <h3 style={{ marginBottom: 8 }}>{t('searchDebug.querySyntax')}</h3>
          <table style={{ fontSize: 12 }}>
            <tbody>
              <tr><td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{t('searchDebug.naturalLanguage')}</td><td>{t('searchDebug.naturalLanguageDesc')}</td></tr>
              <tr><td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{t('searchDebug.exactMatch')}</td><td>{t('searchDebug.exactMatchDesc')}</td></tr>
              <tr><td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{t('searchDebug.semantic')}</td><td>{t('searchDebug.semanticDesc')}</td></tr>
              <tr><td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{t('searchDebug.hybridFusion')}</td><td>{t('searchDebug.hybridFusionDesc')}</td></tr>
            </tbody>
          </table>
          <h4 style={{ marginTop: 12, marginBottom: 4 }}>{t('searchDebug.scoreFormula')}</h4>
          <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            final = fused * layerWeight * decayScore * (1 + recencyBoost) * (1 + accessBoost)
          </code>
        </div>
      )}

      {/* Weight Tuner */}
      {showTuner && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12 }}>{t('searchDebug.searchWeightTuner')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>{t('searchDebug.vectorWeight')} ({vectorWeight.toFixed(2)})</label>
              <input type="range" min="0" max="1" step="0.05" value={vectorWeight}
                onChange={e => { setVectorWeight(parseFloat(e.target.value)); setWeightsDirty(true); }} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>{t('searchDebug.textWeight')} ({textWeight.toFixed(2)})</label>
              <input type="range" min="0" max="1" step="0.05" value={textWeight}
                onChange={e => { setTextWeight(parseFloat(e.target.value)); setWeightsDirty(true); }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
            <button className="btn primary" onClick={saveWeights} disabled={!weightsDirty} style={{ fontSize: 12 }}>
              {t('searchDebug.saveWeights')}
            </button>
            {weightsDirty && <span style={{ fontSize: 12, color: 'var(--warning)' }}>{t('searchDebug.unsavedChanges')}</span>}
            <button className="btn" onClick={() => { setVectorWeight(0.7); setTextWeight(0.3); setWeightsDirty(true); }} style={{ fontSize: 12 }}>
              {t('searchDebug.resetToDefault')}
            </button>
          </div>
        </div>
      )}

      {/* Compare mode: side by side */}
      {compareMode && runs.length > 1 ? (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginBottom: 8 }}>{t('searchDebug.comparisonSummary')}</h3>
            <table style={{ fontSize: 13, width: '100%' }}>
              <thead>
                <tr>
                  <th>{t('searchDebug.run')}</th><th>{t('searchDebug.query')}</th>
                  <th>{t('searchDebug.text')}</th><th>{t('searchDebug.vector')}</th><th>{t('searchDebug.fused')}</th>
                  <th>{t('searchDebug.totalTime')}</th><th>{t('searchDebug.topScore')}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run, i) => (
                  <tr key={i}>
                    <td>{run.label}</td>
                    <td style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.query}</td>
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
            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ marginBottom: 8 }}>{t('searchDebug.resultOverlap')}</h3>
              {(() => {
                const ids0 = new Set(runs[0]!.results.map(r => r.id));
                const ids1 = new Set(runs[1]!.results.map(r => r.id));
                const common = [...ids0].filter(id => ids1.has(id));
                const only0 = [...ids0].filter(id => !ids1.has(id));
                const only1 = [...ids1].filter(id => !ids0.has(id));

                // Rank changes for common items
                const rank0 = new Map(runs[0]!.results.map((r, i) => [r.id, i + 1]));
                const rank1 = new Map(runs[1]!.results.map((r, i) => [r.id, i + 1]));

                return (
                  <div>
                    <div style={{ fontSize: 13, marginBottom: 12 }}>
                      <span style={{ color: 'var(--success)' }}>{t('searchDebug.common')}: {common.length}</span>
                      {' / '}
                      <span style={{ color: '#f59e0b' }}>{t('searchDebug.onlyIn', { label: runs[0]!.label })}: {only0.length}</span>
                      {' / '}
                      <span style={{ color: '#ef4444' }}>{t('searchDebug.onlyIn', { label: runs[1]!.label })}: {only1.length}</span>
                    </div>
                    {common.length > 0 && (
                      <table style={{ fontSize: 12 }}>
                        <thead><tr><th>{t('searchDebug.memory')}</th><th>{t('searchDebug.rankIn', { label: runs[0]!.label })}</th><th>{t('searchDebug.rankIn', { label: runs[1]!.label })}</th><th>{t('searchDebug.change')}</th></tr></thead>
                        <tbody>
                          {common.map(id => {
                            const r0 = rank0.get(id)!;
                            const r1 = rank1.get(id)!;
                            const diff = r0 - r1;
                            return (
                              <tr key={id}>
                                <td style={{ fontFamily: 'monospace', fontSize: 10 }}>{id.slice(0, 12)}..</td>
                                <td>#{r0}</td>
                                <td>#{r1}</td>
                                <td style={{ color: diff > 0 ? 'var(--success)' : diff < 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                                  {diff > 0 ? `+${diff}` : diff < 0 ? String(diff) : '='}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(runs.length, 3)}, 1fr)`, gap: 16 }}>
            {runs.map((run, ri) => (
              <div key={ri}>
                <h3 style={{ marginBottom: 8 }}>{run.label}: "{run.query}"</h3>
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
            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ marginBottom: 8 }}>{t('searchDebug.debugInfo')}</h3>
              {renderDebug(runs[0].debug)}
            </div>
          )}

          {runs[0]?.results.length === 0 && !loading && query && (
            <div className="empty">{t('searchDebug.noResults')}</div>
          )}

          {runs[0]?.results.map((r, i) => renderResultCard(r, i))}
        </>
      )}
    </div>
  );
}
