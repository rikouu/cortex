import React, { useEffect, useState } from 'react';
import { listRelations, createRelation, deleteRelation } from '../api/client.js';

interface Relation {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  created_at: string;
}

export default function RelationGraph() {
  const [relations, setRelations] = useState<Relation[]>([]);
  const [creating, setCreating] = useState(false);
  const [newRel, setNewRel] = useState({ subject: '', predicate: '', object: '', confidence: 0.8 });

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

  // Build simple node/edge data for visualization
  const nodes = new Set<string>();
  relations.forEach(r => { nodes.add(r.subject); nodes.add(r.object); });
  const nodeList = Array.from(nodes);

  return (
    <div>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16}}>
        <h1 className="page-title" style={{marginBottom: 0}}>Relations</h1>
        <button className="btn primary" onClick={() => setCreating(true)}>+ New Relation</button>
      </div>

      {/* Simple graph visualization */}
      {nodeList.length > 0 && (
        <div className="card" style={{marginBottom: 16}}>
          <h3 style={{marginBottom: 12}}>Entity Graph ({nodeList.length} nodes, {relations.length} edges)</h3>
          <svg viewBox="0 0 600 400" style={{width: '100%', height: 300, background: 'var(--bg)', borderRadius: 8}}>
            {nodeList.map((node, i) => {
              const angle = (2 * Math.PI * i) / nodeList.length;
              const x = 300 + 200 * Math.cos(angle);
              const y = 200 + 150 * Math.sin(angle);
              return (
                <g key={node}>
                  <circle cx={x} cy={y} r={20} fill="var(--primary)" opacity={0.8} />
                  <text x={x} y={y + 32} textAnchor="middle" fill="var(--text)" fontSize={11}>{node}</text>
                </g>
              );
            })}
            {relations.map(r => {
              const si = nodeList.indexOf(r.subject);
              const oi = nodeList.indexOf(r.object);
              const a1 = (2 * Math.PI * si) / nodeList.length;
              const a2 = (2 * Math.PI * oi) / nodeList.length;
              return (
                <g key={r.id}>
                  <line
                    x1={300 + 200 * Math.cos(a1)} y1={200 + 150 * Math.sin(a1)}
                    x2={300 + 200 * Math.cos(a2)} y2={200 + 150 * Math.sin(a2)}
                    stroke="var(--border)" strokeWidth={1.5}
                  />
                  <text
                    x={(300 + 200 * Math.cos(a1) + 300 + 200 * Math.cos(a2)) / 2}
                    y={(200 + 150 * Math.sin(a1) + 200 + 150 * Math.sin(a2)) / 2 - 6}
                    textAnchor="middle" fill="var(--text-muted)" fontSize={10}
                  >{r.predicate}</text>
                </g>
              );
            })}
          </svg>
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
