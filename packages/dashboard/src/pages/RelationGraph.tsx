import React, { useEffect, useState, useRef, useCallback } from 'react';
import { listRelations, createRelation, deleteRelation, search } from '../api/client.js';
import { useI18n } from '../i18n/index.js';
import { toLocal } from '../utils/time.js';

interface Relation {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  source: string;
  agent_id: string;
  extraction_count: number;
  expired: number;
  created_at: string;
  updated_at: string;
}

interface Node {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Transform {
  scale: number;
  offsetX: number;
  offsetY: number;
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
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [tooMany, setTooMany] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const nodesRef = useRef<Map<string, Node>>(new Map());
  const dragRef = useRef<{
    nodeId: string | null;
    offsetX: number;
    offsetY: number;
    isPanning: boolean;
    startX: number;
    startY: number;
    startTx: number;
    startTy: number;
  }>({ nodeId: null, offsetX: 0, offsetY: 0, isPanning: false, startX: 0, startY: 0, startTx: 0, startTy: 0 });
  const transformRef = useRef<Transform>({ scale: 1, offsetX: 0, offsetY: 0 });
  const alphaRef = useRef(1.0);
  const selectedRef = useRef<string | null>(null);
  const hasAutoFitRef = useRef(false);
  const { t } = useI18n();

  const load = () => {
    listRelations({ limit: '200', include_expired: '1' }).then((data: Relation[]) => {
      setRelations(data);
      setTooMany(data.length >= 200);
    });
  };

  useEffect(() => { load(); }, []);

  // Auto-refresh every 30s
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

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

  // Source badge component
  const sourceBadge = (source: string) => {
    const isExtraction = source === 'extraction' || source === 'flush';
    return (
      <span style={{
        fontSize: 10,
        padding: '1px 6px',
        borderRadius: 3,
        background: isExtraction ? 'rgba(34,197,94,0.15)' : 'rgba(99,102,241,0.15)',
        color: isExtraction ? '#22c55e' : '#818cf8',
        fontWeight: 500,
      }}>
        {isExtraction ? t('relations.sourceExtraction') : t('relations.sourceManual')}
      </span>
    );
  };

  // ── Coordinate helpers ──

  /** Convert mouse event to canvas pixel coordinates */
  const getCanvasPixel = (e: React.MouseEvent<HTMLCanvasElement> | MouseEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      cx: (e.clientX - rect.left) * (canvas.width / rect.width),
      cy: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  /** Convert canvas pixel coords to world (graph) coords */
  const canvasToWorld = (cx: number, cy: number) => {
    const t = transformRef.current;
    return {
      wx: (cx - t.offsetX) / t.scale,
      wy: (cy - t.offsetY) / t.scale,
    };
  };

  /** Convert world coords to canvas pixel coords */
  const worldToCanvas = (wx: number, wy: number) => {
    const t = transformRef.current;
    return {
      sx: wx * t.scale + t.offsetX,
      sy: wy * t.scale + t.offsetY,
    };
  };

  // ── Fit to view ──

  const fitToView = useCallback(() => {
    const nodes = nodesRef.current;
    const canvas = canvasRef.current;
    if (!canvas || nodes.size === 0) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes.values()) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    }

    const padding = 80;
    const graphW = maxX - minX + padding * 2;
    const graphH = maxY - minY + padding * 2;

    const scale = Math.min(canvas.width / graphW, canvas.height / graphH, 2.5);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    transformRef.current = {
      scale,
      offsetX: canvas.width / 2 - centerX * scale,
      offsetY: canvas.height / 2 - centerY * scale,
    };
  }, []);

  // ── Force-directed graph simulation ──

  const simulate = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || filteredRelations.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const nodes = nodesRef.current;
    const sel = selectedRef.current;
    const cam = transformRef.current;

    // Build nodes from relations
    const nodeIds = new Set<string>();
    filteredRelations.forEach(r => { nodeIds.add(r.subject); nodeIds.add(r.object); });

    for (const id of nodeIds) {
      if (!nodes.has(id)) {
        nodes.set(id, { id, x: (Math.random() - 0.5) * 400, y: (Math.random() - 0.5) * 300, vx: 0, vy: 0 });
      }
    }
    for (const id of nodes.keys()) {
      if (!nodeIds.has(id)) nodes.delete(id);
    }

    const nodeArr = Array.from(nodes.values());
    const REPULSION = 2000;
    const ATTRACTION = 0.008;
    const DAMPING = 0.55;
    const CENTER_GRAVITY = 0.02;
    const IDEAL_DIST = 140;
    const MAX_VELOCITY = 5;
    const ALPHA_DECAY = 0.995;
    const ALPHA_MIN = 0.001;

    // Cool down over time
    const alpha = alphaRef.current;
    alphaRef.current = Math.max(alpha * ALPHA_DECAY, ALPHA_MIN);

    for (const n of nodeArr) {
      let fx = 0, fy = 0;

      // Center gravity toward origin (world 0,0)
      fx += (0 - n.x) * CENTER_GRAVITY;
      fy += (0 - n.y) * CENTER_GRAVITY;

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
        n.vx = (n.vx + fx * alpha) * DAMPING;
        n.vy = (n.vy + fy * alpha) * DAMPING;

        // Clamp velocity
        const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
        if (speed > MAX_VELOCITY) {
          n.vx = (n.vx / speed) * MAX_VELOCITY;
          n.vy = (n.vy / speed) * MAX_VELOCITY;
        } else if (speed < 0.1) {
          n.vx = 0;
          n.vy = 0;
        }

        n.x += n.vx;
        n.y += n.vy;
      }
      // No boundary clamp — camera handles visibility
    }

    // ── Draw ──
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

      const { sx: sx1, sy: sy1 } = worldToCanvas(s.x, s.y);
      const { sx: sx2, sy: sy2 } = worldToCanvas(o.x, o.y);

      const isHighlighted = sel && (r.subject === sel || r.object === sel);
      const baseWidth = 1 + (r.confidence ?? 0.5) * 3;

      ctx.beginPath();
      ctx.moveTo(sx1, sy1);
      ctx.lineTo(sx2, sy2);
      ctx.strokeStyle = isHighlighted ? 'rgba(99, 102, 241, 0.7)' : sel ? 'rgba(100, 100, 140, 0.15)' : 'rgba(100, 100, 140, 0.4)';
      ctx.lineWidth = isHighlighted ? baseWidth + 1 : baseWidth;
      ctx.stroke();

      // Arrow at midpoint
      const angle = Math.atan2(sy2 - sy1, sx2 - sx1);
      const midX = (sx1 + sx2) / 2;
      const midY = (sy1 + sy2) / 2;
      ctx.beginPath();
      ctx.moveTo(midX + 8 * Math.cos(angle), midY + 8 * Math.sin(angle));
      ctx.lineTo(midX - 5 * Math.cos(angle - 0.5), midY - 5 * Math.sin(angle - 0.5));
      ctx.lineTo(midX - 5 * Math.cos(angle + 0.5), midY - 5 * Math.sin(angle + 0.5));
      ctx.fillStyle = isHighlighted ? 'rgba(99, 102, 241, 0.8)' : sel ? 'rgba(100, 100, 140, 0.2)' : 'rgba(100, 100, 140, 0.6)';
      ctx.fill();

      // Edge label
      ctx.fillStyle = isHighlighted ? '#a5b4fc' : sel ? '#555' : '#888';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(r.predicate, midX, midY - 8);
    }

    // Nodes — constant screen-space size
    for (const n of nodeArr) {
      const { sx, sy } = worldToCanvas(n.x, n.y);
      const isSel = n.id === sel;
      const isConnected = connectedToSel.has(n.id);
      const dimmed = sel && !isConnected;

      // Node degree for size
      let degree = 0;
      filteredRelations.forEach(r => { if (r.subject === n.id || r.object === n.id) degree++; });
      const radius = Math.min(16 + degree * 2, 28);

      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
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
      ctx.fillText(label, sx, sy);
    }

    // Zoom indicator
    const zoomPct = Math.round(cam.scale * 100);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${zoomPct}%`, W - 10, H - 10);

    animRef.current = requestAnimationFrame(simulate);
  }, [filteredRelations]);

  // Keep selectedRef in sync
  useEffect(() => { selectedRef.current = selectedNode; }, [selectedNode]);

  useEffect(() => {
    if (filteredRelations.length > 0) {
      alphaRef.current = 1.0; // reheat on data change
      animRef.current = requestAnimationFrame(simulate);
    }
    return () => cancelAnimationFrame(animRef.current);
  }, [filteredRelations, simulate]);

  // Auto-fit after initial physics settle
  useEffect(() => {
    if (filteredRelations.length > 0 && !hasAutoFitRef.current) {
      const timer = setTimeout(() => {
        fitToView();
        hasAutoFitRef.current = true;
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [filteredRelations, fitToView]);

  // Reset auto-fit flag when filter changes
  useEffect(() => {
    hasAutoFitRef.current = false;
  }, [predicateFilter]);

  // ── Mouse interaction ──

  const getNodeAt = (wx: number, wy: number): string | null => {
    // Hit test in world coords; use a generous radius
    for (const [id, n] of nodesRef.current) {
      const dx = wx - n.x;
      const dy = wy - n.y;
      // 30px radius in world space (roughly matches visual node size)
      if (dx * dx + dy * dy < 900) return id;
    }
    return null;
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { cx, cy } = getCanvasPixel(e);
    const { wx, wy } = canvasToWorld(cx, cy);
    const nodeId = getNodeAt(wx, wy);

    if (nodeId) {
      // Start dragging a node
      const n = nodesRef.current.get(nodeId)!;
      dragRef.current = {
        nodeId,
        offsetX: n.x - wx,
        offsetY: n.y - wy,
        isPanning: false,
        startX: 0, startY: 0, startTx: 0, startTy: 0,
      };
    } else {
      // Start panning
      const t = transformRef.current;
      dragRef.current = {
        nodeId: null,
        offsetX: 0, offsetY: 0,
        isPanning: true,
        startX: cx,
        startY: cy,
        startTx: t.offsetX,
        startTy: t.offsetY,
      };
    }
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    const { cx, cy } = getCanvasPixel(e);

    if (d.nodeId) {
      // Dragging a node
      const { wx, wy } = canvasToWorld(cx, cy);
      const n = nodesRef.current.get(d.nodeId);
      if (n) {
        n.x = wx + d.offsetX;
        n.y = wy + d.offsetY;
        n.vx = 0;
        n.vy = 0;
      }
    } else if (d.isPanning) {
      // Panning the camera
      transformRef.current = {
        ...transformRef.current,
        offsetX: d.startTx + (cx - d.startX),
        offsetY: d.startTy + (cy - d.startY),
      };
    }
  };

  const onMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;

    if (d.nodeId) {
      // Check if it was a click (minimal movement)
      const { cx, cy } = getCanvasPixel(e);
      const { wx, wy } = canvasToWorld(cx, cy);
      const n = nodesRef.current.get(d.nodeId);
      if (n) {
        const dx = n.x - (wx + d.offsetX);
        const dy = n.y - (wy + d.offsetY);
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
          // Click — select/deselect
          const clickedNode = d.nodeId;
          if (selectedNode === clickedNode) {
            setSelectedNode(null);
            setNodeMemories([]);
          } else {
            setSelectedNode(clickedNode);
            loadNodeMemories(clickedNode);
          }
        }
      }
      alphaRef.current = Math.max(alphaRef.current, 0.3); // reheat after drag
    }

    dragRef.current = { nodeId: null, offsetX: 0, offsetY: 0, isPanning: false, startX: 0, startY: 0, startTx: 0, startTy: 0 };
  };

  const onMouseLeave = () => {
    dragRef.current = { nodeId: null, offsetX: 0, offsetY: 0, isPanning: false, startX: 0, startY: 0, startTx: 0, startTy: 0 };
  };

  // ── Wheel zoom ──

  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const cy = (e.clientY - rect.top) * (canvas.height / rect.height);

    const t = transformRef.current;
    const zoomFactor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newScale = Math.min(Math.max(t.scale * zoomFactor, 0.1), 8);

    // Zoom centered on cursor: keep world point under cursor fixed
    const wx = (cx - t.offsetX) / t.scale;
    const wy = (cy - t.offsetY) / t.scale;

    transformRef.current = {
      scale: newScale,
      offsetX: cx - wx * newScale,
      offsetY: cy - wy * newScale,
    };
  }, []);

  // Attach wheel handler with passive:false to allow preventDefault
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const cy = (e.clientY - rect.top) * (canvas.height / rect.height);

      const t = transformRef.current;
      const zoomFactor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const newScale = Math.min(Math.max(t.scale * zoomFactor, 0.1), 8);

      const wx = (cx - t.offsetX) / t.scale;
      const wy = (cy - t.offsetY) / t.scale;

      transformRef.current = {
        scale: newScale,
        offsetX: cx - wx * newScale,
        offsetY: cy - wy * newScale,
      };
    };
    canvas.addEventListener('wheel', handler, { passive: false });
    return () => canvas.removeEventListener('wheel', handler);
  }, [filteredRelations]);

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
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn" onClick={fitToView} style={{ fontSize: 12, padding: '4px 10px' }}>
              {t('relations.fit')}
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
              {t('relations.autoRefresh')}
            </label>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              {t('relations.nodeEdgeCount', { nodes: nodeSet.size, edges: filteredRelations.length })}
            </span>
          </div>
        </div>
      )}

      {/* Force-directed graph */}
      {filteredRelations.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <canvas
            ref={canvasRef}
            width={900}
            height={500}
            style={{ width: '100%', height: 'auto', background: '#0f0f1a', borderRadius: 8, cursor: dragRef.current.nodeId ? 'grabbing' : dragRef.current.isPanning ? 'grabbing' : 'grab' }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseLeave}
          />
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            {t('relations.graphHint')}
            {' '}{t('relations.lineThickness')}
            {' '}{t('relations.zoomHint')}
          </p>
          {tooMany && (
            <p style={{ fontSize: 12, color: '#f59e0b', marginTop: 4 }}>
              {t('relations.tooMany')}
            </p>
          )}
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
                {sourceBadge(r.source)}
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
              <tr><th>{t('relations.subject')}</th><th>{t('relations.predicate')}</th><th>{t('relations.object')}</th><th>{t('relations.confidence')}</th><th>{t('relations.extractionCount')}</th><th>{t('relations.source')}</th><th>{t('relations.created')}</th><th></th></tr>
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
                  <td>
                    {r.extraction_count ?? 1}
                    {r.expired ? <span style={{ marginLeft: 4, fontSize: 10, color: '#f59e0b' }}>{t('relations.expired')}</span> : null}
                  </td>
                  <td>{sourceBadge(r.source)}</td>
                  <td>{toLocal(r.created_at, 'date')}</td>
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
