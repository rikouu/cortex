import React, { useEffect, useState } from 'react';
import { getMemory, updateMemory, search } from '../api/client.js';
import { useI18n } from '../i18n/index.js';

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
}

const CATEGORIES = ['identity', 'preference', 'decision', 'fact', 'entity', 'correction', 'todo', 'context', 'summary', 'skill', 'relationship', 'goal', 'insight', 'project_state'];

export default function MemoryDetail({ memoryId, onBack }: { memoryId: string; onBack: () => void }) {
  const [memory, setMemory] = useState<Memory | null>(null);
  const [chain, setChain] = useState<Memory[]>([]);
  const [similar, setSimilar] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ content: string; category: string; importance: number }>({ content: '', category: '', importance: 0 });
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  useEffect(() => {
    loadMemoryChain(memoryId);
  }, [memoryId]);

  const loadMemoryChain = async (id: string) => {
    setLoading(true);
    try {
      const mem = await getMemory(id);
      setMemory(mem);
      setDraft({ content: mem.content, category: mem.category, importance: mem.importance });

      // Build superseded_by chain
      const chainMems: Memory[] = [mem];
      let currentId = mem.superseded_by;
      const visited = new Set<string>([id]);
      while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        try {
          const next = await getMemory(currentId);
          if (next) { chainMems.push(next); currentId = next.superseded_by; } else break;
        } catch { break; }
      }
      setChain(chainMems);

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
      await updateMemory(memory.id, draft);
      const updated = await getMemory(memory.id);
      setMemory(updated);
      setEditing(false);
      setToast({ message: t('memoryDetail.toastUpdated'), type: 'success' });
    } catch (e: any) {
      setToast({ message: t('memoryDetail.toastSaveFailed', { message: e.message }), type: 'error' });
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

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 24, right: 24, zIndex: 200,
          padding: '12px 20px', borderRadius: 'var(--radius)',
          background: toast.type === 'success' ? 'var(--success)' : 'var(--danger)',
          color: '#fff', fontSize: 14, fontWeight: 500, boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          {toast.message}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <button className="btn" onClick={onBack}>{t('common.back')}</button>
        {!editing && <button className="btn primary" onClick={() => setEditing(true)}>{t('common.edit')}</button>}
      </div>
      <h1 className="page-title">{t('memoryDetail.title')}</h1>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <span className={`badge ${memory.layer}`}>{memory.layer}</span>
          <span className="badge">{memory.category}</span>
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
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => { setEditing(false); setDraft({ content: memory.content, category: memory.category, importance: memory.importance }); }}>{t('common.cancel')}</button>
              <button className="btn primary" onClick={handleSave}>{t('common.save')}</button>
            </div>
          </>
        ) : (
          <div style={{ marginBottom: 12 }}>
            <strong>{t('memoryDetail.contentLabel')}</strong>
            <div style={{ background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 8, marginTop: 4, whiteSpace: 'pre-wrap' }}>
              {memory.content}
            </div>
          </div>
        )}

        <table style={{ fontSize: 13 }}>
          <tbody>
            <tr><td style={{ color: 'var(--text-muted)', paddingRight: 16 }}>{t('memoryDetail.id')}</td><td style={{ fontFamily: 'monospace', fontSize: 11 }}>{memory.id}</td></tr>
            <tr><td style={{ color: 'var(--text-muted)' }}>{t('memoryDetail.importance')}</td><td>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {memory.importance?.toFixed(2)}
                <div style={{ flex: 1, maxWidth: 120, height: 6, background: 'var(--border)', borderRadius: 3 }}>
                  <div style={{ width: `${memory.importance * 100}%`, height: '100%', background: 'var(--primary)', borderRadius: 3 }} />
                </div>
              </div>
            </td></tr>
            <tr><td style={{ color: 'var(--text-muted)' }}>{t('memoryDetail.confidence')}</td><td>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {memory.confidence?.toFixed(2)}
                <div style={{ flex: 1, maxWidth: 120, height: 6, background: 'var(--border)', borderRadius: 3 }}>
                  <div style={{ width: `${memory.confidence * 100}%`, height: '100%', background: 'var(--success)', borderRadius: 3 }} />
                </div>
              </div>
            </td></tr>
            <tr><td style={{ color: 'var(--text-muted)' }}>{t('memoryDetail.decayScore')}</td><td>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {memory.decay_score?.toFixed(3)}
                <div style={{ flex: 1, maxWidth: 120, height: 6, background: 'var(--border)', borderRadius: 3 }}>
                  <div style={{ width: `${memory.decay_score * 100}%`, height: '100%', background: 'var(--warning)', borderRadius: 3 }} />
                </div>
              </div>
            </td></tr>
            <tr><td style={{ color: 'var(--text-muted)' }}>{t('memoryDetail.accessCount')}</td><td>{memory.access_count}</td></tr>
            <tr><td style={{ color: 'var(--text-muted)' }}>{t('memoryDetail.created')}</td><td>{memory.created_at}</td></tr>
            <tr><td style={{ color: 'var(--text-muted)' }}>{t('memoryDetail.updated')}</td><td>{memory.updated_at}</td></tr>
            {memory.agent_id && <tr><td style={{ color: 'var(--text-muted)' }}>{t('memoryDetail.agent')}</td><td>{memory.agent_id}</td></tr>}
            {memory.source && <tr><td style={{ color: 'var(--text-muted)' }}>{t('memoryDetail.source')}</td><td>{memory.source}</td></tr>}
            {memory.metadata && (
              <tr><td style={{ color: 'var(--text-muted)' }}>{t('memoryDetail.metadata')}</td><td><pre style={{ fontSize: 11, margin: 0 }}>{JSON.stringify(JSON.parse(memory.metadata), null, 2)}</pre></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Decay Curve */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 12 }}>{t('memoryDetail.decayCurve')}</h3>
        <div style={{ position: 'relative', height: 120, background: 'var(--bg)', borderRadius: 'var(--radius)', padding: '10px 10px 24px 36px' }}>
          {/* Y axis labels */}
          <div style={{ position: 'absolute', left: 4, top: 8, fontSize: 10, color: 'var(--text-muted)' }}>1.0</div>
          <div style={{ position: 'absolute', left: 4, bottom: 24, fontSize: 10, color: 'var(--text-muted)' }}>0.0</div>
          {/* Curve via SVG */}
          <svg width="100%" height="100%" viewBox="0 0 400 80" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
            {/* Grid */}
            <line x1="0" y1="0" x2="400" y2="0" stroke="rgba(255,255,255,0.05)" />
            <line x1="0" y1="40" x2="400" y2="40" stroke="rgba(255,255,255,0.05)" />
            <line x1="0" y1="80" x2="400" y2="80" stroke="rgba(255,255,255,0.05)" />
            {/* Decay curve */}
            <polyline
              fill="none"
              stroke="#f59e0b"
              strokeWidth="2"
              points={decayCurve.map(p => `${(p.day / 60) * 400},${(1 - p.score) * 80}`).join(' ')}
            />
            {/* Current position marker */}
            {(() => {
              const currentScore = memory.decay_score ?? 1;
              const dayEstimate = currentScore > 0 ? -Math.log(currentScore) / lambda : 60;
              const cx = Math.min((dayEstimate / 60) * 400, 400);
              const cy = (1 - currentScore) * 80;
              return <circle cx={cx} cy={cy} r="4" fill="#f59e0b" stroke="#fff" strokeWidth="1.5" />;
            })()}
          </svg>
          <div style={{ position: 'absolute', left: 36, bottom: 4, fontSize: 10, color: 'var(--text-muted)' }}>0d</div>
          <div style={{ position: 'absolute', right: 10, bottom: 4, fontSize: 10, color: 'var(--text-muted)' }}>60d</div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
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
              onClick={() => { loadMemoryChain(s.id); window.scrollTo(0, 0); }}
            >
              <div className="header">
                <span className={`badge ${s.layer}`}>{s.layer}</span>
                <span className="badge" style={{ background: 'rgba(59,130,246,0.2)', color: '#60a5fa' }}>{s.category}</span>
                {s.finalScore && (
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
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
            {chain.map((m, i) => (
              <div key={m.id} style={{ display: 'flex', marginBottom: 16 }}>
                <div style={{ width: 40, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: '50%',
                    background: i === 0 ? 'var(--primary)' : 'var(--border)',
                    border: '2px solid var(--primary)', zIndex: 1,
                  }} />
                  {i < chain.length - 1 && <div style={{ width: 2, flex: 1, background: 'var(--border)' }} />}
                </div>
                <div style={{
                  flex: 1, padding: 12, borderRadius: 8,
                  background: i === 0 ? 'rgba(99,102,241,0.1)' : 'rgba(0,0,0,0.15)',
                  border: i === 0 ? '1px solid var(--primary)' : '1px solid var(--border)',
                }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 6, fontSize: 12 }}>
                    <span className={`badge ${m.layer}`}>{m.layer}</span>
                    {i === 0 && <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{t('memoryDetail.current')}</span>}
                    {i > 0 && <span style={{ color: 'var(--text-muted)' }}>{t('memoryDetail.superseded')}</span>}
                    <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{m.created_at?.slice(0, 19)}</span>
                  </div>
                  <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{m.content}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'monospace' }}>{m.id}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
