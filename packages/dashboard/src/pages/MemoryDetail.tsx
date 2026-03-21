import React, { useEffect, useState } from 'react';
import { getMemory, updateMemory, search, getMemoryChain, rollbackMemory } from '../api/client.js';
import { useI18n } from '../i18n/index.js';
import { toLocal } from '../utils/time.js';

interface Memory {
  id: string;
  layer: string;
  category: string;
  content: string;
  importance: number;
  confidence: number;
  decay_score: number;
  access_count: number;
  created_at: string;
  updated_at: string;
  superseded_by: string | null;
  metadata: string | null;
  agent_id?: string;
  source?: string;
  is_pinned?: number;
}

const CATEGORIES = ['identity', 'preference', 'decision', 'fact', 'entity', 'correction', 'todo', 'context', 'summary', 'skill', 'relationship', 'goal', 'insight', 'project_state', 'constraint', 'policy', 'agent_self_improvement', 'agent_user_habit', 'agent_relationship', 'agent_persona'];

/** Parse metadata JSON safely */
function parseMeta(m: Memory): Record<string, any> | null {
  if (!m.metadata) return null;
  try { return JSON.parse(m.metadata); } catch { return null; }
}

/** Simple word-level diff for two strings */
function computeDiff(oldText: string, newText: string): { type: 'same' | 'add' | 'remove'; text: string }[] {
  const oldWords = oldText.split(/(\s+)/);
  const newWords = newText.split(/(\s+)/);
  const result: { type: 'same' | 'add' | 'remove'; text: string }[] = [];

  // Simple LCS-based diff
  const m = oldWords.length;
  const n = newWords.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = oldWords[i - 1] === newWords[j - 1]
        ? dp[i - 1]![j - 1]! + 1
        : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }

  let i = m, j = n;
  const ops: { type: 'same' | 'add' | 'remove'; text: string }[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      ops.unshift({ type: 'same', text: oldWords[i - 1]! });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      ops.unshift({ type: 'add', text: newWords[j - 1]! });
      j--;
    } else {
      ops.unshift({ type: 'remove', text: oldWords[i - 1]! });
      i--;
    }
  }
  return ops;
}

export default function MemoryDetail({ memoryId, onBack }: { memoryId: string; onBack: () => void }) {
  const [memory, setMemory] = useState<Memory | null>(null);
  const [chain, setChain] = useState<Memory[]>([]);
  const [similar, setSimilar] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ content: string; category: string; importance: number; is_pinned: boolean }>({ content: '', category: '', importance: 0, is_pinned: false });
  const [diffPair, setDiffPair] = useState<[Memory, Memory] | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  useEffect(() => {
    loadMemoryData(memoryId);
  }, [memoryId]);

  const loadMemoryData = async (id: string) => {
    setLoading(true);
    try {
      const mem = await getMemory(id);
      setMemory(mem);
      setDraft({ content: mem.content, category: mem.category, importance: mem.importance, is_pinned: !!mem.is_pinned });

      // Load version chain via API (single call)
      try {
        const chainRes = await getMemoryChain(id);
        setChain(chainRes.chain || []);
      } catch {
        setChain([mem]);
      }

      // Find similar memories
      try {
        const snippet = mem.content.slice(0, 100);
        const res = await search({ query: snippet, limit: 6, debug: false });
        setSimilar((res.results || []).filter((r: any) => r.id !== id).slice(0, 5));
      } catch { setSimilar([]); }
    } catch (e: any) {
      console.error(e);
    }
    setLoading(false);
  };

  const handleSave = async () => {
    if (!memory) return;
    try {
      await updateMemory(memory.id, { ...draft, is_pinned: draft.is_pinned ? 1 : 0 });
      const updated = await getMemory(memory.id);
      setMemory(updated);
      setEditing(false);
      setToast({ message: t('memoryDetail.toastUpdated'), type: 'success' });
    } catch (e: any) {
      setToast({ message: t('memoryDetail.toastSaveFailed', { message: e.message }), type: 'error' });
    }
  };

  const handleRollback = async (targetId: string) => {
    if (!memory) return;
    if (!confirm(t('memoryDetail.rollbackConfirm'))) return;
    try {
      const res = await rollbackMemory(memory.id, targetId);
      if (res.ok) {
        setToast({ message: t('memoryDetail.rollbackSuccess'), type: 'success' });
        loadMemoryData(res.restored.id);
      }
    } catch (e: any) {
      setToast({ message: e.message, type: 'error' });
    }
  };

  if (loading) return <div className="empty">{t('common.loading')}</div>;
  if (!memory) return <div className="empty">{t('memoryDetail.notFound')}</div>;

  // Decay visualization — simulate decay curve
  const decayCurve: { day: number; score: number }[] = [];
  const lambda = 0.03;
  for (let d = 0; d <= 60; d += 2) {
    decayCurve.push({ day: d, score: Math.exp(-lambda * d) });
  }

  // Determine the latest version in the chain
  const latestInChain = chain.length > 0 ? chain[chain.length - 1] : null;
  const isLatest = latestInChain?.id === memory.id;

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 24, right: 24, zIndex: 200,
          padding: '12px 20px', borderRadius: 'var(--radius-md)',
          background: toast.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)',
          color: '#fff', fontSize: 14, fontWeight: 500, boxShadow: 'var(--shadow-lg)',
        }}>
          {toast.message}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <button className="btn" onClick={onBack}>{t('common.back')}</button>
        <div style={{ display: 'flex', gap: 8 }}>
          {!isLatest && latestInChain && (
            <button className="btn" style={{ background: 'var(--color-success)', color: '#fff' }}
              onClick={() => { loadMemoryData(latestInChain.id); window.scrollTo(0, 0); }}>
              {t('memoryDetail.latestVersion')}
            </button>
          )}
          {!editing && <button className="btn primary" onClick={() => setEditing(true)}>{t('common.edit')}</button>}
        </div>
      </div>
      <h1 className="page-title">{t('memoryDetail.title')}</h1>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <span className={`badge ${memory.layer}`}>{memory.layer}</span>
          <span className="badge">{memory.category}</span>
          {memory.is_pinned ? <span className="badge" style={{ background: 'var(--color-warning-muted)', color: 'var(--color-warning)' }}>{t('memoryDetail.pinned')}</span> : null}
        </div>

        {editing ? (
          <>
            <div className="form-group">
              <label>{t('memoryDetail.category')}</label>
              <select value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>{t('memoryDetail.content')}</label>
              <textarea rows={5} value={draft.content} onChange={e => setDraft({ ...draft, content: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('memoryDetail.importance')} ({draft.importance.toFixed(2)})</label>
              <input type="range" min="0" max="1" step="0.05" value={draft.importance}
                onChange={e => setDraft({ ...draft, importance: parseFloat(e.target.value) })} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <label style={{ fontWeight: 500 }}>{t('memoryDetail.pinLabel')}</label>
              <div
                onClick={() => setDraft({ ...draft, is_pinned: !draft.is_pinned })}
                style={{
                  width: 40, height: 22, borderRadius: 11,
                  background: draft.is_pinned ? 'var(--color-primary)' : 'var(--color-border)',
                  position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
                }}
              >
                <div style={{
                  width: 18, height: 18, borderRadius: '50%',
                  background: '#fff', position: 'absolute', top: 2,
                  left: draft.is_pinned ? 20 : 2, transition: 'left 0.2s',
                }} />
              </div>
              <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('memoryDetail.pinDesc')}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => { setEditing(false); setDraft({ content: memory.content, category: memory.category, importance: memory.importance, is_pinned: !!memory.is_pinned }); }}>{t('common.cancel')}</button>
              <button className="btn primary" onClick={handleSave}>{t('common.save')}</button>
            </div>
          </>
        ) : (
          <div style={{ marginBottom: 12 }}>
            <strong>{t('memoryDetail.contentLabel')}</strong>
            <div style={{ background: 'var(--color-base)', padding: 12, borderRadius: 8, marginTop: 4, whiteSpace: 'pre-wrap' }}>
              {memory.content}
            </div>
          </div>
        )}

        <table style={{ fontSize: 13 }}>
          <tbody>
            <tr><td style={{ color: 'var(--color-text-secondary)', paddingRight: 16 }}>{t('memoryDetail.id')}</td><td style={{ fontFamily: 'monospace', fontSize: 11 }}>{memory.id}</td></tr>
            <tr><td style={{ color: 'var(--color-text-secondary)' }}>{t('memoryDetail.importance')}</td><td>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {memory.importance?.toFixed(2)}
                <div style={{ flex: 1, maxWidth: 120, height: 6, background: 'var(--color-border)', borderRadius: 3 }}>
                  <div style={{ width: `${memory.importance * 100}%`, height: '100%', background: 'var(--color-primary)', borderRadius: 3 }} />
                </div>
              </div>
            </td></tr>
            <tr><td style={{ color: 'var(--color-text-secondary)' }}>{t('memoryDetail.confidence')}</td><td>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {memory.confidence?.toFixed(2)}
                <div style={{ flex: 1, maxWidth: 120, height: 6, background: 'var(--color-border)', borderRadius: 3 }}>
                  <div style={{ width: `${memory.confidence * 100}%`, height: '100%', background: 'var(--color-success)', borderRadius: 3 }} />
                </div>
              </div>
            </td></tr>
            <tr><td style={{ color: 'var(--color-text-secondary)' }}>{t('memoryDetail.decayScore')}</td><td>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {memory.decay_score?.toFixed(3)}
                <div style={{ flex: 1, maxWidth: 120, height: 6, background: 'var(--color-border)', borderRadius: 3 }}>
                  <div style={{ width: `${memory.decay_score * 100}%`, height: '100%', background: 'var(--color-warning)', borderRadius: 3 }} />
                </div>
              </div>
            </td></tr>
            <tr><td style={{ color: 'var(--color-text-secondary)' }}>{t('memoryDetail.accessCount')}</td><td>{memory.access_count}</td></tr>
            <tr><td style={{ color: 'var(--color-text-secondary)' }}>{t('memoryDetail.created')}</td><td>{toLocal(memory.created_at)}</td></tr>
            <tr><td style={{ color: 'var(--color-text-secondary)' }}>{t('memoryDetail.updated')}</td><td>{toLocal(memory.updated_at)}</td></tr>
            {memory.agent_id && <tr><td style={{ color: 'var(--color-text-secondary)' }}>{t('memoryDetail.agent')}</td><td>{memory.agent_id}</td></tr>}
            {memory.source && <tr><td style={{ color: 'var(--color-text-secondary)' }}>{t('memoryDetail.source')}</td><td>{memory.source}</td></tr>}
            {memory.metadata && (
              <tr><td style={{ color: 'var(--color-text-secondary)' }}>{t('memoryDetail.metadata')}</td><td><pre style={{ fontSize: 11, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxWidth: '100%' }}>{JSON.stringify(JSON.parse(memory.metadata), null, 2)}</pre></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Decay Curve */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 12 }}>{t('memoryDetail.decayCurve')}</h3>
        <div style={{ position: 'relative', height: 120, background: 'var(--color-base)', borderRadius: 'var(--radius-md)', padding: '10px 10px 24px 36px' }}>
          {/* Y axis labels */}
          <div style={{ position: 'absolute', left: 4, top: 8, fontSize: 10, color: 'var(--color-text-secondary)' }}>1.0</div>
          <div style={{ position: 'absolute', left: 4, bottom: 24, fontSize: 10, color: 'var(--color-text-secondary)' }}>0.0</div>
          {/* Curve via SVG */}
          <svg width="100%" height="100%" viewBox="0 0 400 80" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
            {/* Grid */}
            <line x1="0" y1="0" x2="400" y2="0" stroke="rgba(255,255,255,0.05)" />
            <line x1="0" y1="40" x2="400" y2="40" stroke="rgba(255,255,255,0.05)" />
            <line x1="0" y1="80" x2="400" y2="80" stroke="rgba(255,255,255,0.05)" />
            {/* Decay curve */}
            <polyline
              fill="none"
              stroke="var(--color-warning)"
              strokeWidth="2"
              points={decayCurve.map(p => `${(p.day / 60) * 400},${(1 - p.score) * 80}`).join(' ')}
            />
            {/* Current position marker */}
            {(() => {
              const currentScore = memory.decay_score ?? 1;
              const dayEstimate = currentScore > 0 ? -Math.log(currentScore) / lambda : 60;
              const cx = Math.min((dayEstimate / 60) * 400, 400);
              const cy = (1 - currentScore) * 80;
              return <circle cx={cx} cy={cy} r="4" fill="var(--color-warning)" stroke="#fff" strokeWidth="1.5" />;
            })()}
          </svg>
          <div style={{ position: 'absolute', left: 36, bottom: 4, fontSize: 10, color: 'var(--color-text-secondary)' }}>0d</div>
          <div style={{ position: 'absolute', right: 10, bottom: 4, fontSize: 10, color: 'var(--color-text-secondary)' }}>60d</div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 6 }}>
          {t('memoryDetail.currentDecay', { score: memory.decay_score?.toFixed(3), days: memory.decay_score > 0 ? Math.round(-Math.log(memory.decay_score) / lambda) : '60+' })}
        </p>
      </div>

      {/* Similar Memories */}
      {similar.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12 }}>{t('memoryDetail.relatedMemories')}</h3>
          {similar.map((s: any) => (
            <div
              key={s.id}
              className="memory-card"
              style={{ cursor: 'pointer' }}
              onClick={() => { loadMemoryData(s.id); window.scrollTo(0, 0); }}
            >
              <div className="header">
                <span className={`badge ${s.layer}`}>{s.layer}</span>
                <span className="badge" style={{ background: 'var(--color-info-muted)', color: 'var(--color-info)' }}>{s.category}</span>
                {s.finalScore && (
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-text-secondary)' }}>
                    {t('memoryDetail.similarity')}: {(s.finalScore * 100).toFixed(1)}%
                  </span>
                )}
              </div>
              <div className="content" style={{ fontSize: 13 }}>{s.content?.slice(0, 200)}{s.content?.length > 200 ? '...' : ''}</div>
            </div>
          ))}
        </div>
      )}

      {/* Revision Chain */}
      {chain.length > 1 && (
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>{t('memoryDetail.revisionChain', { count: chain.length })}</h3>
          <div style={{ position: 'relative' }}>
            {chain.map((m, i) => {
              const isCurrent = m.id === memory.id;
              const isLatestVersion = i === chain.length - 1;
              const meta = parseMeta(m);
              const updateType = meta?.smart_update_type as string | undefined;
              const updateReasoning = meta?.update_reasoning as string | undefined;

              // Determine highlight color
              let borderColor = 'var(--color-border)';
              let bgColor = 'var(--color-base)';
              if (isCurrent) { borderColor = 'var(--color-primary)'; bgColor = 'var(--color-primary-muted)'; }
              else if (isLatestVersion) { borderColor = 'var(--color-success)'; bgColor = 'var(--color-success-muted)'; }

              return (
                <div key={m.id} style={{ display: 'flex', marginBottom: 16, cursor: isCurrent ? 'default' : 'pointer' }}
                  onClick={() => { if (!isCurrent) { loadMemoryData(m.id); window.scrollTo(0, 0); } }}>
                  <div style={{ width: 40, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{
                      width: 16, height: 16, borderRadius: '50%',
                      background: isCurrent ? 'var(--color-primary)' : isLatestVersion ? 'var(--color-success)' : 'var(--color-border)',
                      border: `2px solid ${isCurrent ? 'var(--color-primary)' : isLatestVersion ? 'var(--color-success)' : 'var(--color-border)'}`,
                      zIndex: 1,
                    }} />
                    {i < chain.length - 1 && <div style={{ width: 2, flex: 1, background: 'var(--color-border)' }} />}
                  </div>
                  <div style={{
                    flex: 1, padding: 12, borderRadius: 8,
                    background: bgColor,
                    border: `1px solid ${borderColor}`,
                  }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 6, fontSize: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span className={`badge ${m.layer}`}>{m.layer}</span>
                      {isCurrent && <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>{t('memoryDetail.current')}</span>}
                      {isLatestVersion && !isCurrent && <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>{t('memoryDetail.latestVersion')}</span>}
                      {!isLatestVersion && !isCurrent && <span style={{ color: 'var(--color-text-secondary)' }}>{t('memoryDetail.superseded')}</span>}
                      {/* Smart update type badge */}
                      {updateType === 'merge' && (
                        <span style={{ background: 'var(--color-success-muted)', color: 'var(--color-success)', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                          {t('memoryDetail.merged')}
                        </span>
                      )}
                      {updateType === 'replace' && (
                        <span style={{ background: 'var(--color-warning-muted)', color: 'var(--color-warning)', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                          {t('memoryDetail.replaced')}
                        </span>
                      )}
                      <span style={{ color: 'var(--color-text-secondary)', marginLeft: 'auto' }}>{toLocal(m.created_at)}</span>
                    </div>
                    <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{m.content}</div>
                    {updateReasoning && (
                      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 6, fontStyle: 'italic' }}>
                        {t('memoryDetail.updateReason')}: {updateReasoning}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 4, fontFamily: 'monospace', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{m.id}</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {i > 0 && (
                          <button className="btn" style={{ fontSize: 10, padding: '2px 8px' }}
                            onClick={(e) => { e.stopPropagation(); setDiffPair([chain[i - 1]!, m]); }}>
                            {t('memoryDetail.diff')}
                          </button>
                        )}
                        {!isLatestVersion && (
                          <button className="btn" style={{ fontSize: 10, padding: '2px 8px', background: 'var(--color-warning-muted)', color: 'var(--color-warning)' }}
                            onClick={(e) => { e.stopPropagation(); handleRollback(m.id); }}>
                            {t('memoryDetail.rollback')}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Diff Modal */}
      {diffPair && (
        <div className="modal-overlay" onClick={() => setDiffPair(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 700, maxHeight: '80vh', overflow: 'auto' }}>
            <h3 style={{ marginBottom: 12 }}>{t('memoryDetail.diffTitle')}</h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, fontSize: 12, color: 'var(--color-text-secondary)' }}>
              <span>v{chain.indexOf(diffPair[0]) + 1} → v{chain.indexOf(diffPair[1]) + 1}</span>
            </div>
            <div style={{ background: 'var(--color-base)', padding: 12, borderRadius: 8, fontSize: 13, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
              {computeDiff(diffPair[0].content, diffPair[1].content).map((part, i) => (
                <span key={i} style={{
                  background: part.type === 'add' ? 'var(--color-success-muted)' : part.type === 'remove' ? 'var(--color-danger-muted)' : 'transparent',
                  textDecoration: part.type === 'remove' ? 'line-through' : 'none',
                  color: part.type === 'add' ? 'var(--color-success)' : part.type === 'remove' ? '#f87171' : 'var(--color-text-primary)',
                }}>{part.text}</span>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" onClick={() => setDiffPair(null)}>{t('common.close')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
