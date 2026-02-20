import React, { useEffect, useState, useCallback } from 'react';
import { listMemories, createMemory, updateMemory, deleteMemory } from '../api/client.js';
import MemoryDetail from './MemoryDetail.js';

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
  agent_id: string;
  source: string | null;
}

export default function MemoryBrowser() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [total, setTotal] = useState(0);
  const [layer, setLayer] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Memory | null>(null);
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [newMem, setNewMem] = useState({ layer: 'core', category: 'fact', content: '', importance: 0.5 });
  const limit = 20;

  const load = useCallback(() => {
    const params: Record<string, string> = { limit: String(limit), offset: String(page * limit) };
    if (layer) params.layer = layer;
    if (category) params.category = category;
    listMemories(params).then((r: any) => {
      setMemories(r.items);
      setTotal(r.total);
    });
  }, [layer, category, page]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this memory?')) return;
    await deleteMemory(id);
    load();
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    await updateMemory(editing.id, {
      content: editing.content,
      category: editing.category,
      importance: editing.importance,
    });
    setEditing(null);
    load();
  };

  const handleCreate = async () => {
    await createMemory(newMem);
    setCreating(false);
    setNewMem({ layer: 'core', category: 'fact', content: '', importance: 0.5 });
    load();
  };

  return (
    <div>
      {detailId ? (
        <MemoryDetail memoryId={detailId} onBack={() => setDetailId(null)} />
      ) : (
      <>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16}}>
        <h1 className="page-title" style={{marginBottom: 0}}>Memories</h1>
        <button className="btn primary" onClick={() => setCreating(true)}>+ New Memory</button>
      </div>

      <div className="toolbar">
        <select value={layer} onChange={e => { setLayer(e.target.value); setPage(0); }}>
          <option value="">All Layers</option>
          <option value="core">Core</option>
          <option value="working">Working</option>
          <option value="archive">Archive</option>
        </select>
        <select value={category} onChange={e => { setCategory(e.target.value); setPage(0); }}>
          <option value="">All Categories</option>
          {['identity','preference','decision','fact','entity','correction','todo','context','summary'].map(c =>
            <option key={c} value={c}>{c}</option>
          )}
        </select>
        <span style={{color: 'var(--text-muted)', fontSize: 13}}>{total} total</span>
      </div>

      {memories.length === 0 ? (
        <div className="empty">No memories found</div>
      ) : (
        memories.map(m => (
          <div key={m.id} className="memory-card">
            <div className="header">
              <span className={`badge ${m.layer}`}>{m.layer}</span>
              <span className="badge" style={{background: 'rgba(59,130,246,0.2)', color: '#60a5fa'}}>{m.category}</span>
              <span style={{marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)'}}>{m.created_at?.slice(0, 16)}</span>
            </div>
            <div className="content">{m.content}</div>
            <div className="meta">
              <span>Importance: {m.importance?.toFixed(2)}</span>
              <span>Decay: {m.decay_score?.toFixed(2)}</span>
              <span>Access: {m.access_count}</span>
              <span>Agent: {m.agent_id}</span>
              <div style={{marginLeft: 'auto', display: 'flex', gap: 8}}>
                <button className="btn" onClick={() => setDetailId(m.id)} style={{fontSize: 12}}>View</button>
                <button className="btn" onClick={() => setEditing({...m})}>Edit</button>
                <button className="btn danger" onClick={() => handleDelete(m.id)}>Delete</button>
              </div>
            </div>
          </div>
        ))
      )}

      {total > limit && (
        <div style={{display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16}}>
          <button className="btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
          <span style={{padding: '8px 16px', color: 'var(--text-muted)'}}>Page {page + 1} of {Math.ceil(total / limit)}</span>
          <button className="btn" disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}

      {/* Edit Modal */}
      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Edit Memory</h2>
            <div className="form-group">
              <label>Category</label>
              <select value={editing.category} onChange={e => setEditing({...editing, category: e.target.value})}>
                {['identity','preference','decision','fact','entity','correction','todo','context','summary'].map(c =>
                  <option key={c} value={c}>{c}</option>
                )}
              </select>
            </div>
            <div className="form-group">
              <label>Content</label>
              <textarea rows={4} value={editing.content} onChange={e => setEditing({...editing, content: e.target.value})} />
            </div>
            <div className="form-group">
              <label>Importance ({editing.importance?.toFixed(2)})</label>
              <input type="range" min="0" max="1" step="0.05" value={editing.importance}
                onChange={e => setEditing({...editing, importance: parseFloat(e.target.value)})} />
            </div>
            <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end'}}>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn primary" onClick={handleSaveEdit}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {creating && (
        <div className="modal-overlay" onClick={() => setCreating(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>New Memory</h2>
            <div className="form-group">
              <label>Layer</label>
              <select value={newMem.layer} onChange={e => setNewMem({...newMem, layer: e.target.value})}>
                <option value="core">Core</option>
                <option value="working">Working</option>
              </select>
            </div>
            <div className="form-group">
              <label>Category</label>
              <select value={newMem.category} onChange={e => setNewMem({...newMem, category: e.target.value})}>
                {['identity','preference','decision','fact','entity','correction','todo','context','summary'].map(c =>
                  <option key={c} value={c}>{c}</option>
                )}
              </select>
            </div>
            <div className="form-group">
              <label>Content</label>
              <textarea rows={4} value={newMem.content} onChange={e => setNewMem({...newMem, content: e.target.value})} />
            </div>
            <div className="form-group">
              <label>Importance ({newMem.importance.toFixed(2)})</label>
              <input type="range" min="0" max="1" step="0.05" value={newMem.importance}
                onChange={e => setNewMem({...newMem, importance: parseFloat(e.target.value)})} />
            </div>
            <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end'}}>
              <button className="btn" onClick={() => setCreating(false)}>Cancel</button>
              <button className="btn primary" onClick={handleCreate} disabled={!newMem.content.trim()}>Create</button>
            </div>
          </div>
              </div>
      )}
      </>
      )}
    </div>
  );
}
