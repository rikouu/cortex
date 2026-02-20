import React, { useEffect, useState, useRef, useCallback } from 'react';
import { listRelations, createRelation, deleteRelation, search } from '../api/client.js';
import { useI18n } from '../i18n/index.js';

interface Relation {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  created_at: string;
}

interface Node {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export default function RelationGraph() {
  const [relations, setRelations] = useState<Relation[]>([]);
  const [filteredRelations, setFilteredRelations] = useState<Relation[]>([]);
  const [creating, setCreating] = useState(false);
  const [newRel, setNewRel] = useState({ subject: '', predicate: '', object: '', confidence: 0.8 });
  const [predicateFilter, setPredicateFilter] = useState('');
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [nodeMemories, setNodeMemories] = useState<any[]>([]);
  const [loadingMemories, setLoadingMemories] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const nodesRef = useRef<Map<string, Node>>(new Map());
  const dragRef = useRef<{ nodeId: string | null; offsetX: number; offsetY: number }>({ nodeId: null, offsetX: 0, offsetY: 0 });
  const selectedRef = useRef<string | null>(null);
  const { t } = useI18n();

  const load = () => {
    listRelations().then(setRelations);
  };

  useEffect(() => { load(); }, []);

  // Derive unique predicates
  const predicates = [...new Set(relations.map(r => r.predicate))];

  // Filter relations
  useEffect(() => {
    if (predicateFilter) {
      setFilteredRelations(relations.filter(r => r.predicate === predicateFilter));
    } else {
      setFilteredRelations(relations);
    }
  }, [relations, predicateFilter]);

  const handleCreate = async () => {
    await createRelation(newRel);
    setNewRel({ subject: '', predicate: '', object: '', confidence: 0.8 });
    setCreating(false);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('relations.confirmDelete'))) return;
    await deleteRelation(id);
    load();
  };

  // Load memories for selected node
  const loadNodeMemories = async (entityName: string) => {
    setLoadingMemories(true);
    try {
      const res = await search({ query: entityName, limit: 10, debug: false });
      setNodeMemories(res.results || []);
    } catch {
      setNodeMemories([]);
    }
    setLoadingMemories(false);
  };

  // Force-directed graph simulation
  const simulate = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || filteredRelations.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const nodes = nodesRef.current;
    const sel = selectedRef.current;

    // Build nodes from relations
    const nodeIds = new Set<string>();
    filteredRelations.forEach(r => { nodeIds.add(r.subject); nodeIds.add(r.object); });

    for (const id of nodeIds) {
      if (!nodes.has(id)) {
        nodes.set(id, { id, x: W / 2 + (Math.random() - 0.5) * 300, y: H / 2 + (Math.random() - 0.5) * 200, vx: 0, vy: 0 });
      }
    }
    for (const id of nodes.keys()) {
      if (!nodeIds.has(id)) nodes.delete(id);
    }

    const nodeArr = Array.from(nodes.values());
    const REPULSION = 3000;
    const ATTRACTION = 0.005;
    const DAMPING = 0.85;
    const CENTER_GRAVITY = 0.01;
    const IDEAL_DIST = 120;

    for (const n of nodeArr) {
      let fx = 0, fy = 0;
      fx += (W / 2 - n.x) * CENTER_GRAVITY;
      fy += (H / 2 - n.y) * CENTER_GRAVITY;

      for (const m of nodeArr) {
        if (m === n) continue;
        const dx = n.x - m.x;
        const dy = n.y - m.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = REPULSION / (dist * dist);
        fx += (dx / dist) * force;
        fy += (dy / dist) * force;
      }

      for (const r of filteredRelations) {
        let other: Node | undefined;
        if (r.subject === n.id) other = nodes.get(r.object);
        else if (r.object === n.id) other = nodes.get(r.subject);
        if (!other) continue;
        const dx = other.x - n.x;
        const dy = other.y - n.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const force = (dist - IDEAL_DIST) * ATTRACTION;
        fx += dx * force;
        fy += dy * force;
      }

      if (dragRef.current.nodeId !== n.id) {
        n.vx = (n.vx + fx) * DAMPING;
        n.vy = (n.vy + fy) * DAMPING;
        n.x += n.vx;
        n.y += n.vy;
      }
      n.x = Math.max(40, Math.min(W - 40, n.x));
      n.y = Math.max(40, Math.min(H - 40, n.y));
    }

    // Draw
    ctx.clearRect(0, 0, W, H);

    // Build connected set for selected node
    const connectedToSel = new Set<string>();
    if (sel) {
      connectedToSel.add(sel);
      filteredRelations.forEach(r => {
        if (r.subject === sel) connectedToSel.add(r.object);
        if (r.object === sel) connectedToSel.add(r.subject);
      });
    }

    // Edges — line width based on confidence
    for (const r of filteredRelations) {
      const s = nodes.get(r.subject);
      const o = nodes.get(r.object);
      if (!s || !o) continue;

      const isHighlighted = sel && (r.subject === sel || r.object === sel);
      const lineWidth = 1 + (r.confidence ?? 0.5) * 3;

      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(o.x, o.y);
      ctx.strokeStyle = isHighlighted ? 'rgba(99, 102, 241, 0.7)' : sel ? 'rgba(100, 100, 140, 0.15)' : 'rgba(100, 100, 140, 0.4)';
      ctx.lineWidth = isHighlighted ? lineWidth + 1 : lineWidth;
      ctx.stroke();

      // Arrow
      const angle = Math.atan2(o.y - s.y, o.x - s.x);
      const midX = (s.x + o.x) / 2;
      const midY = (s.y + o.y) / 2;
      ctx.beginPath();
      ctx.moveTo(midX + 8 * Math.cos(angle), midY + 8 * Math.sin(angle));
      ctx.lineTo(midX - 5 * Math.cos(angle - 0.5), midY - 5 * Math.sin(angle - 0.5));
      ctx.lineTo(midX - 5 * Math.cos(angle + 0.5), midY - 5 * Math.sin(angle + 0.5));
      ctx.fillStyle = isHighlighted ? 'rgba(99, 102, 241, 0.8)' : sel ? 'rgba(100, 100, 140, 0.2)' : 'rgba(100, 100, 140, 0.6)';
      ctx.fill();

      // Label
      ctx.fillStyle = isHighlighted ? '#a5b4fc' : sel ? '#555' : '#888';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(r.predicate, midX, midY - 8);
    }

    // Nodes
    for (const n of nodeArr) {
      const isSel = n.id === sel;
      const isConnected = connectedToSel.has(n.id);
      const dimmed = sel && !isConnected;

      // Node degree for size
      let degree = 0;
      filteredRelations.forEach(r => { if (r.subject === n.id || r.object === n.id) degree++; });
      const radius = Math.min(16 + degree * 2, 28);

      ctx.beginPath();
      ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? '#818cf8' : dimmed ? '#2a2e3a' : dragRef.current.nodeId === n.id ? '#6366f1' : '#4f46e5';
      ctx.fill();
      ctx.strokeStyle = isSel ? '#c7d2fe' : dimmed ? '#3a3e4a' : '#818cf8';
      ctx.lineWidth = isSel ? 3 : 2;
      ctx.stroke();

      ctx.fillStyle = dimmed ? '#555' : '#fff';
      ctx.font = `bold ${radius > 20 ? 12 : 11}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = n.id.length > 10 ? n.id.slice(0, 9) + '.' : n.id;
      ctx.fillText(label, n.x, n.y);
    }

    animRef.current = requestAnimationFrame(simulate);
  }, [filteredRelations]);

  // Keep selectedRef in sync
  useEffect(() => { selectedRef.current = selectedNode; }, [selectedNode]);

  useEffect(() => {
    if (filteredRelations.length > 0) {
      animRef.current = requestAnimationFrame(simulate);
    }
    return () => cancelAnimationFrame(animRef.current);
  }, [filteredRelations, simulate]);

  // Mouse interaction
  const getNodeAt = (x: number, y: number): string | null => {
    for (const [id, n] of nodesRef.current) {
      const dx = x - n.x;
      const dy = y - n.y;
      if (dx * dx + dy * dy < 600) return id;
    }
    return null;
  };

  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvasRef.current!.width / rect.width),
      y: (e.clientY - rect.top) * (canvasRef.current!.height / rect.height),
    };
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e);
    const nodeId = getNodeAt(x, y);
    if (nodeId) {
      const n = nodesRef.current.get(nodeId)!;
      dragRef.current = { nodeId, offsetX: n.x - x, offsetY: n.y - y };
    }
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragRef.current.nodeId) return;
    const { x, y } = getCanvasCoords(e);
    const n = nodesRef.current.get(dragRef.current.nodeId);
    if (n) { n.x = x + dragRef.current.offsetX; n.y = y + dragRef.current.offsetY; n.vx = 0; n.vy = 0; }
  };

  const onMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // If not dragged much, treat as click
    if (dragRef.current.nodeId) {
      const { x, y } = getCanvasCoords(e);
      const n = nodesRef.current.get(dragRef.current.nodeId);
      if (n) {
        const dx = n.x - (x + dragRef.current.offsetX);
        const dy = n.y - (y + dragRef.current.offsetY);
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
          // Click — select/deselect
          const clickedNode = dragRef.current.nodeId;
          if (selectedNode === clickedNode) {
            setSelectedNode(null);
            setNodeMemories([]);
          } else {
            setSelectedNode(clickedNode);
            loadNodeMemories(clickedNode);
          }
        }
      }
    }
    dragRef.current = { nodeId: null, offsetX: 0, offsetY: 0 };
  };

  const onMouseLeave = () => {
    dragRef.current = { nodeId: null, offsetX: 0, offsetY: 0 };
  };

  // Node stats
  const nodeSet = new Set<string>();
  filteredRelations.forEach(r => { nodeSet.add(r.subject); nodeSet.add(r.object); });

  // Node connections for selected node
  const selectedRelations = selectedNode
    ? filteredRelations.filter(r => r.subject === selectedNode || r.object === selectedNode)
    : [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>{t('relations.title')}</h1>
        <button className="btn primary" onClick={() => setCreating(true)}>{t('relations.newRelation')}</button>
      </div>

      {/* Filters */}
      {predicates.length > 0 && (
        <div className="toolbar">
          <select value={predicateFilter} onChange={e => setPredicateFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="">{t('relations.allPredicates', { count: predicates.length })}</option>
            {predicates.map(p => (
              <option key={p} value={p}>{p} ({relations.filter(r => r.predicate === p).length})</option>
            ))}
          </select>
          {selectedNode && (
            <button className="btn" onClick={() => { setSelectedNode(null); setNodeMemories([]); }} style={{ fontSize: 12 }}>
              {t('relations.deselect', { node: selectedNode })}
            </button>
          )}
          <span style={{ color: 'var(--text-muted)', fontSize: 13, marginLeft: 'auto' }}>
            {t('relations.nodeEdgeCount', { nodes: nodeSet.size, edges: filteredRelations.length })}
          </span>
        </div>
      )}

      {/* Force-directed graph */}
      {filteredRelations.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <canvas
            ref={canvasRef}
            width={900}
            height={500}
            style={{ width: '100%', height: 'auto', background: '#0f0f1a', borderRadius: 8, cursor: dragRef.current.nodeId ? 'grabbing' : 'grab' }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseLeave}
          />
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            {t('relations.graphHint')}
            {' '}{t('relations.lineThickness')}
          </p>
        </div>
      )}

      {/* Selected node detail panel */}
      {selectedNode && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12 }}>{t('relations.entity', { name: selectedNode })}</h3>

          {/* Connections */}
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>{t('relations.connections', { count: selectedRelations.length })}</h4>
            {selectedRelations.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{r.subject}</span>
                <span style={{ color: 'var(--primary)', fontSize: 12 }}>{r.predicate}</span>
                <span style={{ fontWeight: 600 }}>{r.object}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>{t('relations.conf')}: {r.confidence?.toFixed(2)}</span>
              </div>
            ))}
          </div>

          {/* Related memories */}
          <h4 style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>{t('relations.relatedMemories')}</h4>
          {loadingMemories ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('common.loading')}</div>
          ) : nodeMemories.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('relations.noMemories')}</div>
          ) : (
            nodeMemories.map((m: any) => (
              <div key={m.id} className="memory-card" style={{ padding: 10 }}>
                <div className="header">
                  <span className={`badge ${m.layer}`}>{m.layer}</span>
                  <span className="badge" style={{ background: 'rgba(59,130,246,0.2)', color: '#60a5fa' }}>{m.category}</span>
                </div>
                <div style={{ fontSize: 13 }}>{m.content?.slice(0, 200)}{m.content?.length > 200 ? '...' : ''}</div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Table view */}
      {filteredRelations.length === 0 ? (
        <div className="empty">{predicateFilter ? t('relations.noRelationsFiltered', { predicate: predicateFilter }) : t('relations.noRelations')}</div>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr><th>{t('relations.subject')}</th><th>{t('relations.predicate')}</th><th>{t('relations.object')}</th><th>{t('relations.confidence')}</th><th>{t('relations.created')}</th><th></th></tr>
            </thead>
            <tbody>
              {filteredRelations.map(r => (
                <tr key={r.id} style={{ background: selectedNode && (r.subject === selectedNode || r.object === selectedNode) ? 'rgba(99,102,241,0.1)' : undefined }}>
                  <td style={{ cursor: 'pointer', color: 'var(--primary)' }} onClick={() => { setSelectedNode(r.subject); loadNodeMemories(r.subject); }}>{r.subject}</td>
                  <td>{r.predicate}</td>
                  <td style={{ cursor: 'pointer', color: 'var(--primary)' }} onClick={() => { setSelectedNode(r.object); loadNodeMemories(r.object); }}>{r.object}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 40, height: 4, background: 'var(--border)', borderRadius: 2 }}>
                        <div style={{ width: `${(r.confidence ?? 0) * 100}%`, height: '100%', background: 'var(--primary)', borderRadius: 2 }} />
                      </div>
                      {r.confidence?.toFixed(2)}
                    </div>
                  </td>
                  <td>{r.created_at?.slice(0, 10)}</td>
                  <td><button className="btn danger" onClick={() => handleDelete(r.id)}>x</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create modal */}
      {creating && (
        <div className="modal-overlay" onClick={() => setCreating(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{t('relations.newRelationTitle')}</h2>
            <div className="form-group">
              <label>{t('relations.subject')}</label>
              <input value={newRel.subject} onChange={e => setNewRel({ ...newRel, subject: e.target.value })} placeholder={t('relations.subjectPlaceholder')} />
            </div>
            <div className="form-group">
              <label>{t('relations.predicate')}</label>
              <input value={newRel.predicate} onChange={e => setNewRel({ ...newRel, predicate: e.target.value })} placeholder={t('relations.predicatePlaceholder')} />
            </div>
            <div className="form-group">
              <label>{t('relations.object')}</label>
              <input value={newRel.object} onChange={e => setNewRel({ ...newRel, object: e.target.value })} placeholder={t('relations.objectPlaceholder')} />
            </div>
            <div className="form-group">
              <label>{t('relations.confidence')} ({newRel.confidence.toFixed(2)})</label>
              <input type="range" min="0" max="1" step="0.05" value={newRel.confidence}
                onChange={e => setNewRel({ ...newRel, confidence: parseFloat(e.target.value) })} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setCreating(false)}>{t('common.cancel')}</button>
              <button className="btn primary" onClick={handleCreate}
                disabled={!newRel.subject || !newRel.predicate || !newRel.object}>{t('common.create')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
