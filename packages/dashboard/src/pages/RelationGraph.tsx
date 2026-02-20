import React, { useEffect, useState, useRef, useCallback } from 'react';
import { listRelations, createRelation, deleteRelation } from '../api/client.js';

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
  const [creating, setCreating] = useState(false);
  const [newRel, setNewRel] = useState({ subject: '', predicate: '', object: '', confidence: 0.8 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const nodesRef = useRef<Map<string, Node>>(new Map());
  const dragRef = useRef<{ nodeId: string | null; offsetX: number; offsetY: number }>({ nodeId: null, offsetX: 0, offsetY: 0 });

  const load = () => {
    listRelations().then(setRelations);
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    await createRelation(newRel);
    setNewRel({ subject: '', predicate: '', object: '', confidence: 0.8 });
    setCreating(false);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this relation?')) return;
    await deleteRelation(id);
    load();
  };

  // Force-directed graph simulation
  const simulate = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || relations.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const nodes = nodesRef.current;

    // Build nodes from relations
    const nodeIds = new Set<string>();
    relations.forEach(r => { nodeIds.add(r.subject); nodeIds.add(r.object); });

    // Initialize new nodes
    for (const id of nodeIds) {
      if (!nodes.has(id)) {
        nodes.set(id, {
          id,
          x: W / 2 + (Math.random() - 0.5) * 300,
          y: H / 2 + (Math.random() - 0.5) * 200,
          vx: 0,
          vy: 0,
        });
      }
    }

    // Remove stale nodes
    for (const id of nodes.keys()) {
      if (!nodeIds.has(id)) nodes.delete(id);
    }

    const nodeArr = Array.from(nodes.values());
    const REPULSION = 3000;
    const ATTRACTION = 0.005;
    const DAMPING = 0.85;
    const CENTER_GRAVITY = 0.01;
    const IDEAL_DIST = 120;

    // Forces
    for (const n of nodeArr) {
      let fx = 0, fy = 0;

      // Center gravity
      fx += (W / 2 - n.x) * CENTER_GRAVITY;
      fy += (H / 2 - n.y) * CENTER_GRAVITY;

      // Repulsion from other nodes
      for (const m of nodeArr) {
        if (m === n) continue;
        const dx = n.x - m.x;
        const dy = n.y - m.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = REPULSION / (dist * dist);
        fx += (dx / dist) * force;
        fy += (dy / dist) * force;
      }

      // Attraction along edges
      for (const r of relations) {
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

      // Bounds
      n.x = Math.max(40, Math.min(W - 40, n.x));
      n.y = Math.max(40, Math.min(H - 40, n.y));
    }

    // Draw
    ctx.clearRect(0, 0, W, H);

    // Edges
    for (const r of relations) {
      const s = nodes.get(r.subject);
      const o = nodes.get(r.object);
      if (!s || !o) continue;

      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(o.x, o.y);
      ctx.strokeStyle = 'rgba(100, 100, 140, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Arrow
      const angle = Math.atan2(o.y - s.y, o.x - s.x);
      const midX = (s.x + o.x) / 2;
      const midY = (s.y + o.y) / 2;
      ctx.beginPath();
      ctx.moveTo(midX + 8 * Math.cos(angle), midY + 8 * Math.sin(angle));
      ctx.lineTo(midX - 5 * Math.cos(angle - 0.5), midY - 5 * Math.sin(angle - 0.5));
      ctx.lineTo(midX - 5 * Math.cos(angle + 0.5), midY - 5 * Math.sin(angle + 0.5));
      ctx.fillStyle = 'rgba(100, 100, 140, 0.6)';
      ctx.fill();

      // Label
      ctx.fillStyle = '#888';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(r.predicate, midX, midY - 8);
    }

    // Nodes
    for (const n of nodeArr) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, 20, 0, Math.PI * 2);
      ctx.fillStyle = dragRef.current.nodeId === n.id ? '#6366f1' : '#4f46e5';
      ctx.fill();
      ctx.strokeStyle = '#818cf8';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = n.id.length > 8 ? n.id.slice(0, 7) + '…' : n.id;
      ctx.fillText(label, n.x, n.y);
    }

    animRef.current = requestAnimationFrame(simulate);
  }, [relations]);

  useEffect(() => {
    if (relations.length > 0) {
      animRef.current = requestAnimationFrame(simulate);
    }
    return () => cancelAnimationFrame(animRef.current);
  }, [relations, simulate]);

  // Mouse interaction for dragging
  const getNodeAt = (x: number, y: number): string | null => {
    for (const [id, n] of nodesRef.current) {
      const dx = x - n.x;
      const dy = y - n.y;
      if (dx * dx + dy * dy < 400) return id;
    }
    return null;
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvasRef.current!.width / rect.width);
    const y = (e.clientY - rect.top) * (canvasRef.current!.height / rect.height);
    const nodeId = getNodeAt(x, y);
    if (nodeId) {
      const n = nodesRef.current.get(nodeId)!;
      dragRef.current = { nodeId, offsetX: n.x - x, offsetY: n.y - y };
    }
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragRef.current.nodeId) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvasRef.current!.width / rect.width);
    const y = (e.clientY - rect.top) * (canvasRef.current!.height / rect.height);
    const n = nodesRef.current.get(dragRef.current.nodeId);
    if (n) {
      n.x = x + dragRef.current.offsetX;
      n.y = y + dragRef.current.offsetY;
      n.vx = 0;
      n.vy = 0;
    }
  };

  const onMouseUp = () => {
    dragRef.current = { nodeId: null, offsetX: 0, offsetY: 0 };
  };

  // Build node list for stats
  const nodeSet = new Set<string>();
  relations.forEach(r => { nodeSet.add(r.subject); nodeSet.add(r.object); });

  return (
    <div>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16}}>
        <h1 className="page-title" style={{marginBottom: 0}}>Relations</h1>
        <button className="btn primary" onClick={() => setCreating(true)}>+ New Relation</button>
      </div>

      {/* Force-directed graph */}
      {relations.length > 0 && (
        <div className="card" style={{marginBottom: 16}}>
          <h3 style={{marginBottom: 12}}>Entity Graph ({nodeSet.size} nodes, {relations.length} edges)</h3>
          <canvas
            ref={canvasRef}
            width={800}
            height={450}
            style={{width: '100%', height: 'auto', background: '#0f0f1a', borderRadius: 8, cursor: dragRef.current.nodeId ? 'grabbing' : 'grab'}}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          />
          <p style={{fontSize: 12, color: 'var(--text-muted)', marginTop: 6}}>Drag nodes to rearrange</p>
        </div>
      )}

      {/* Table view */}
      {relations.length === 0 ? (
        <div className="empty">No relations yet</div>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr><th>Subject</th><th>Predicate</th><th>Object</th><th>Confidence</th><th>Created</th><th></th></tr>
            </thead>
            <tbody>
              {relations.map(r => (
                <tr key={r.id}>
                  <td>{r.subject}</td>
                  <td>{r.predicate}</td>
                  <td>{r.object}</td>
                  <td>{r.confidence?.toFixed(2)}</td>
                  <td>{r.created_at?.slice(0, 10)}</td>
                  <td><button className="btn danger" onClick={() => handleDelete(r.id)}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <div className="modal-overlay" onClick={() => setCreating(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>New Relation</h2>
            <div className="form-group">
              <label>Subject</label>
              <input value={newRel.subject} onChange={e => setNewRel({...newRel, subject: e.target.value})} placeholder="e.g. Harry" />
            </div>
            <div className="form-group">
              <label>Predicate</label>
              <input value={newRel.predicate} onChange={e => setNewRel({...newRel, predicate: e.target.value})} placeholder="e.g. uses" />
            </div>
            <div className="form-group">
              <label>Object</label>
              <input value={newRel.object} onChange={e => setNewRel({...newRel, object: e.target.value})} placeholder="e.g. OpenClaw" />
            </div>
            <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end'}}>
              <button className="btn" onClick={() => setCreating(false)}>Cancel</button>
              <button className="btn primary" onClick={handleCreate}
                disabled={!newRel.subject || !newRel.predicate || !newRel.object}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
