import React, { useEffect, useState, useCallback } from 'react';
import { listMemories, createMemory, updateMemory, deleteMemory, search, triggerImport } from '../api/client.js';
import MemoryDetail from './MemoryDetail.js';
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
  agent_id: string;
  source: string | null;
  superseded_by: string | null;
  is_pinned?: number;
}

type SortField = 'created_at' | 'importance' | 'decay_score' | 'access_count' | 'confidence';
type SortDir = 'desc' | 'asc';

const CATEGORIES = ['identity', 'preference', 'decision', 'fact', 'entity', 'correction', 'todo', 'context', 'summary', 'skill', 'relationship', 'goal', 'insight', 'project_state', 'constraint', 'policy', 'agent_self_improvement', 'agent_user_habit', 'agent_relationship', 'agent_persona'];

export default function MemoryBrowser() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [total, setTotal] = useState(0);
  const [layer, setLayer] = useState('');
  const [category, setCategory] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Memory | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFormat, setImportFormat] = useState('json');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState('');
  const [bulkCategory, setBulkCategory] = useState('fact');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [newMem, setNewMem] = useState({ layer: 'core', category: 'fact', content: '', importance: 0.5 });
  const limit = 20;
  const { t } = useI18n();

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const load = useCallback(() => {
    if (isSearchMode && searchQuery.trim()) {
      search({ query: searchQuery, limit: 50, debug: false }).then((r: any) => {
        let results = (r.results || []) as Memory[];
        // Apply client-side filters
        if (layer) results = results.filter(m => m.layer === layer);
        if (category) results = results.filter(m => m.category === category);
        // Sort
        results.sort((a: any, b: any) => {
          const va = a[sortField] ?? 0;
          const vb = b[sortField] ?? 0;
          if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
          return sortDir === 'asc' ? va - vb : vb - va;
        });
        setMemories(results.slice(page * limit, (page + 1) * limit));
        setTotal(results.length);
      });
    } else {
      const params: Record<string, string> = { limit: String(limit), offset: String(page * limit) };
      if (layer) params.layer = layer;
      if (category) params.category = category;
      listMemories(params).then((r: any) => {
        let items = r.items as Memory[];
        if (sortField !== 'created_at' || sortDir !== 'desc') {
          items = [...items].sort((a: any, b: any) => {
            const va = a[sortField] ?? 0;
            const vb = b[sortField] ?? 0;
            if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            return sortDir === 'asc' ? va - vb : vb - va;
          });
        }
        setMemories(items);
        setTotal(r.total);
      });
    }
  }, [layer, category, page, searchQuery, isSearchMode, sortField, sortDir]);

  useEffect(() => { load(); }, [load]);

  const handleSearch = () => {
    if (searchQuery.trim()) {
      setIsSearchMode(true);
      setPage(0);
    } else {
      setIsSearchMode(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setIsSearchMode(false);
    setPage(0);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('memories.confirmDelete'))) return;
    try {
      await deleteMemory(id);
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
      setToast({ message: t('memories.toastDeleted', { count: 1 }), type: 'success' });
      load();
    } catch (e: any) {
      setToast({ message: e.message || 'Delete failed', type: 'error' });
    }
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

  const handleImport = async () => {
    try {
      let data: any;
      if (importFormat === 'json') {
        const parsed = JSON.parse(importText);
        data = { format: 'json', memories: Array.isArray(parsed) ? parsed : parsed.memories || [parsed] };
      } else {
        data = { format: 'memory_md', content: importText };
      }
      const result = await triggerImport(data);
      setToast({ message: t('memories.toastImported', { imported: result.imported, skipped: result.skipped }), type: 'success' });
      setImporting(false);
      setImportText('');
      load();
    } catch (e: any) {
      setToast({ message: t('memories.toastImportFailed', { message: e.message }), type: 'error' });
    }
  };

  // Bulk operations
  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === memories.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(memories.map(m => m.id)));
    }
  };

  const handleBulkAction = async () => {
    if (selected.size === 0) return;
    const ids = [...selected];

    if (bulkAction === 'delete') {
      if (!confirm(t('memories.confirmBulkDelete', { count: ids.length }))) return;
      let deleted = 0;
      for (const id of ids) {
        try { await deleteMemory(id); deleted++; } catch {}
      }
      if (deleted > 0) {
        setToast({ message: t('memories.toastDeleted', { count: deleted }), type: 'success' });
      } else {
        setToast({ message: t('memories.toastDeleteFailed'), type: 'error' });
      }
    } else if (bulkAction === 'category') {
      let updated = 0;
      for (const id of ids) {
        try { await updateMemory(id, { category: bulkCategory }); updated++; } catch {}
      }
      if (updated > 0) {
        setToast({ message: t('memories.toastCategoryUpdated', { count: updated, category: bulkCategory }), type: 'success' });
      } else {
        setToast({ message: t('memories.toastUpdateFailed'), type: 'error' });
      }
    }

    setSelected(new Set());
    setBulkAction('');
    load();
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return ' ↕';
    return sortDir === 'desc' ? ' ↓' : ' ↑';
  };

  const sortLabel = (field: SortField) => {
    if (field === 'created_at') return t('memories.date');
    if (field === 'access_count') return t('memories.access');
    if (field === 'importance') return t('memories.importance');
    if (field === 'decay_score') return t('memories.decayScore');
    return field;
  };

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

      {detailId ? (
        <MemoryDetail memoryId={detailId} onBack={() => { setDetailId(null); load(); }} />
      ) : (
      <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>{t('memories.title')}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => setImporting(true)}>{t('common.import')}</button>
          <button className="btn primary" onClick={() => setCreating(true)}>{t('memories.newMemory')}</button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="search-bar" style={{ marginBottom: 8 }}>
        <input
          placeholder={t('memories.searchPlaceholder')}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
        />
        {isSearchMode && (
          <button className="btn" onClick={clearSearch}>{t('common.clear')}</button>
        )}
        <button className="btn primary" onClick={handleSearch}>{t('common.search')}</button>
      </div>

      {/* Filters + Sort */}
      <div className="toolbar">
        <select value={layer} onChange={e => { setLayer(e.target.value); setPage(0); }}>
          <option value="">{t('memories.allLayers')}</option>
          <option value="core">Core</option>
          <option value="working">Working</option>
          <option value="archive">Archive</option>
        </select>
        <select value={category} onChange={e => { setCategory(e.target.value); setPage(0); }}>
          <option value="">{t('memories.allCategories')}</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
          {(['created_at', 'importance', 'decay_score', 'access_count'] as SortField[]).map(f => (
            <button
              key={f}
              className="btn"
              style={{
                fontSize: 11, padding: '4px 8px',
                background: sortField === f ? 'var(--primary)' : undefined,
                borderColor: sortField === f ? 'var(--primary)' : undefined,
              }}
              onClick={() => toggleSort(f)}
            >
              {sortLabel(f)}{sortIcon(f)}
            </button>
          ))}
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: 13, marginLeft: 'auto' }}>
          {isSearchMode && t('memories.searchPrefix')}{t('common.total', { count: total })}
        </span>
      </div>

      {/* Bulk Actions */}
      {selected.size > 0 && (
        <div className="card" style={{ padding: '10px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{t('common.selected', { count: selected.size })}</span>
          <select value={bulkAction} onChange={e => setBulkAction(e.target.value)} style={{ width: 'auto' }}>
            <option value="">{t('memories.bulkAction')}</option>
            <option value="delete">{t('memories.deleteSelected')}</option>
            <option value="category">{t('memories.changeCategory')}</option>
          </select>
          {bulkAction === 'category' && (
            <select value={bulkCategory} onChange={e => setBulkCategory(e.target.value)} style={{ width: 'auto' }}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {bulkAction && (
            <button className="btn primary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={handleBulkAction}>{t('common.apply')}</button>
          )}
          <button className="btn" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => setSelected(new Set())}>{t('common.clear')}</button>
        </div>
      )}

      {/* Memory List */}
      {memories.length === 0 ? (
        <div className="empty">{t('memories.noMemories')}</div>
      ) : (
        <>
          {/* Select all */}
          <div style={{ padding: '4px 0 8px', fontSize: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'var(--text-muted)' }}>
              <input type="checkbox" checked={selected.size === memories.length && memories.length > 0} onChange={toggleSelectAll} style={{ width: 'auto' }} />
              {t('memories.selectAll')}
            </label>
          </div>
          {memories.map(m => (
            <div key={m.id} className="memory-card" style={{ borderColor: selected.has(m.id) ? 'var(--primary)' : undefined }}>
              <div className="header">
                <input
                  type="checkbox"
                  checked={selected.has(m.id)}
                  onChange={() => toggleSelect(m.id)}
                  style={{ width: 'auto', marginRight: 4 }}
                />
                <span className={`badge ${m.layer}`}>{m.layer}</span>
                <span className="badge" style={{ background: 'rgba(59,130,246,0.2)', color: '#60a5fa' }}>{m.category}</span>
                {m.is_pinned ? <span className="badge" style={{ background: 'rgba(255,170,0,0.2)', color: '#b8860b' }}>{t('memoryDetail.pinned')}</span> : null}
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{m.created_at?.slice(0, 16)}</span>
              </div>
              <div className="content">{m.content}</div>
              <div className="meta">
                <span>{t('memories.imp')}: {m.importance?.toFixed(2)}</span>
                <span>{t('memories.decay')}: {m.decay_score?.toFixed(2)}</span>
                <span>{t('memories.access')}: {m.access_count}</span>
                <span>{t('memories.agent')}: {m.agent_id}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button className="btn" onClick={() => setDetailId(m.id)} style={{ fontSize: 12 }}>{t('common.view')}</button>
                  <button className="btn" onClick={() => setEditing({ ...m })}>{t('common.edit')}</button>
                  <button className="btn danger" onClick={() => handleDelete(m.id)}>{t('common.delete')}</button>
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {/* Pagination */}
      {total > limit && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
          <button className="btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>{t('common.prev')}</button>
          <span style={{ padding: '8px 16px', color: 'var(--text-muted)' }}>{t('common.page', { current: page + 1, total: Math.ceil(total / limit) })}</span>
          <button className="btn" disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}>{t('common.next')}</button>
        </div>
      )}

      {/* Edit Modal */}
      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{t('memories.editMemory')}</h2>
            <div className="form-group">
              <label>{t('memories.category')}</label>
              <select value={editing.category} onChange={e => setEditing({ ...editing, category: e.target.value })}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>{t('memories.content')}</label>
              <textarea rows={4} value={editing.content} onChange={e => setEditing({ ...editing, content: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('memories.importanceLabel')} ({editing.importance?.toFixed(2)})</label>
              <input type="range" min="0" max="1" step="0.05" value={editing.importance}
                onChange={e => setEditing({ ...editing, importance: parseFloat(e.target.value) })} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setEditing(null)}>{t('common.cancel')}</button>
              <button className="btn primary" onClick={handleSaveEdit}>{t('common.save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {creating && (
        <div className="modal-overlay" onClick={() => setCreating(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{t('memories.newMemoryTitle')}</h2>
            <div className="form-group">
              <label>{t('memories.layer')}</label>
              <select value={newMem.layer} onChange={e => setNewMem({ ...newMem, layer: e.target.value })}>
                <option value="core">Core</option>
                <option value="working">Working</option>
              </select>
            </div>
            <div className="form-group">
              <label>{t('memories.category')}</label>
              <select value={newMem.category} onChange={e => setNewMem({ ...newMem, category: e.target.value })}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>{t('memories.content')}</label>
              <textarea rows={4} value={newMem.content} onChange={e => setNewMem({ ...newMem, content: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('memories.importanceLabel')} ({newMem.importance.toFixed(2)})</label>
              <input type="range" min="0" max="1" step="0.05" value={newMem.importance}
                onChange={e => setNewMem({ ...newMem, importance: parseFloat(e.target.value) })} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setCreating(false)}>{t('common.cancel')}</button>
              <button className="btn primary" onClick={handleCreate} disabled={!newMem.content.trim()}>{t('common.create')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {importing && (
        <div className="modal-overlay" onClick={() => setImporting(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{t('memories.importMemories')}</h2>
            <div className="form-group">
              <label>{t('memories.format')}</label>
              <select value={importFormat} onChange={e => setImportFormat(e.target.value)}>
                <option value="json">{t('memories.jsonFormat')}</option>
                <option value="memory_md">{t('memories.markdownFormat')}</option>
              </select>
            </div>
            <div className="form-group">
              <label>{importFormat === 'json' ? t('memories.jsonPlaceholderLabel') : t('memories.mdPlaceholderLabel')}</label>
              <textarea
                rows={10}
                value={importText}
                onChange={e => setImportText(e.target.value)}
                placeholder={importFormat === 'json'
                  ? '[{"layer":"core","category":"fact","content":"...","importance":0.7}]'
                  : '## Facts\n- User prefers dark mode\n- User lives in Tokyo\n\n## Preferences\n- Likes Japanese food'}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setImporting(false)}>{t('common.cancel')}</button>
              <button className="btn primary" onClick={handleImport} disabled={!importText.trim()}>{t('common.import')}</button>
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
