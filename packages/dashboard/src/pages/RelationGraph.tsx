import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { listRelations, createRelation, deleteRelation, search } from '../api/client.js';
import { useI18n } from '../i18n/index.js';
import { toLocal } from '../utils/time.js';
import Graph from 'graphology';
import Sigma from 'sigma';
import forceAtlas2 from 'graphology-layout-forceatlas2';

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

// Agent color palette
const AGENT_COLORS = [
  '#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#3b82f6',
  '#ec4899', '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4',
  '#84cc16', '#e11d48', '#0ea5e9', '#a855f7', '#10b981',
];

function getAgentColor(agentId: string, agentMap: Map<string, number>): string {
  if (!agentMap.has(agentId)) {
    agentMap.set(agentId, agentMap.size);
  }
  return AGENT_COLORS[agentMap.get(agentId)! % AGENT_COLORS.length]!;
}

function nodeSize(extractionCount: number): number {
  // 1 → 5, 10+ → 20, linear in between
  const clamped = Math.min(Math.max(extractionCount || 1, 1), 10);
  return 5 + ((clamped - 1) / 9) * 15;
}

export default function RelationGraph() {
  const [relations, setRelations] = useState<Relation[]>([]);
  const [creating, setCreating] = useState(false);
  const [newRel, setNewRel] = useState({ subject: '', predicate: '', object: '', confidence: 0.8 });
  const [predicateFilter, setPredicateFilter] = useState('');
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [nodeMemories, setNodeMemories] = useState<any[]>([]);
  const [loadingMemories, setLoadingMemories] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [tablePage, setTablePage] = useState(0);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.6);
  const tableLimit = 20;
  const [tooMany, setTooMany] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const { t } = useI18n();

  const load = () => {
    listRelations({ limit: '500', include_expired: '1' }).then((data: Relation[]) => {
      setRelations(data);
      setTooMany(data.length >= 500);
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

  // Filter relations by predicate AND confidence threshold
  const filteredRelations = useMemo(() => {
    let result = relations.filter(r => (r.confidence ?? 1) >= confidenceThreshold);
    if (predicateFilter) {
      result = result.filter(r => r.predicate === predicateFilter);
    }
    return result;
  }, [relations, predicateFilter, confidenceThreshold]);

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

  // ── Sigma.js graph rendering ──

  // Build agent color map from relations
  const agentColorMap = useRef(new Map<string, number>());

  // Build and render sigma graph when filteredRelations or selectedNode changes
  useEffect(() => {
    if (!containerRef.current) return;

    const graph = new Graph({ multi: true, type: 'directed' });
    graphRef.current = graph;

    // Collect node info: max extraction count per entity, and agent color
    const nodeInfo = new Map<string, { maxExtraction: number; agentId: string }>();
    for (const r of filteredRelations) {
      for (const entity of [r.subject, r.object]) {
        const existing = nodeInfo.get(entity);
        if (!existing) {
          nodeInfo.set(entity, { maxExtraction: r.extraction_count || 1, agentId: r.agent_id || 'default' });
        } else {
          existing.maxExtraction = Math.max(existing.maxExtraction, r.extraction_count || 1);
        }
      }
    }

    // Add nodes
    for (const [entity, info] of nodeInfo) {
      const color = getAgentColor(info.agentId, agentColorMap.current);
      const size = nodeSize(info.maxExtraction);
      graph.addNode(entity, {
        label: entity,
        size,
        color,
        x: Math.random() * 100,
        y: Math.random() * 100,
      });
    }

    // Add edges
    for (const r of filteredRelations) {
      const conf = r.confidence ?? 0.5;
      const edgeSize = 1 + conf * 4; // 1..5
      const alpha = Math.max(0.2, conf); // 0.2..1.0
      // Color with alpha baked in
      const edgeColor = `rgba(150, 150, 200, ${alpha})`;
      graph.addEdge(r.subject, r.object, {
        label: r.predicate,
        size: edgeSize,
        color: edgeColor,
        type: 'arrow',
        relationId: r.id,
      });
    }

    // Run ForceAtlas2 layout (synchronous)
    if (graph.order > 0) {
      forceAtlas2.assign(graph, {
        iterations: 100,
        settings: {
          gravity: 1,
          scalingRatio: 10,
          barnesHutOptimize: graph.order > 50,
          strongGravityMode: true,
          slowDown: 5,
        },
      });
    }

    // Create sigma renderer
    const renderer = new Sigma(graph, containerRef.current, {
      renderEdgeLabels: true,
      defaultEdgeType: 'arrow',
      labelRenderedSizeThreshold: 6,
      labelSize: 12,
      labelColor: { color: '#e2e8f0' },
      edgeLabelColor: { color: '#94a3b8' },
      edgeLabelSize: 10,
      // Node/edge reducers for search highlight
      nodeReducer: (node, data) => {
        const res = { ...data };
        if (selectedNode) {
          if (node === selectedNode) {
            res.highlighted = true;
            res.zIndex = 1;
          } else {
            // Check if connected to selected
            const connected = filteredRelations.some(
              r => (r.subject === selectedNode && r.object === node) ||
                   (r.object === selectedNode && r.subject === node)
            );
            if (!connected) {
              res.color = '#2a2e3a';
              res.label = '';
            }
          }
        }
        return res;
      },
      edgeReducer: (edge, data) => {
        const res = { ...data };
        if (selectedNode) {
          const source = graph.source(edge);
          const target = graph.target(edge);
          if (source === selectedNode || target === selectedNode) {
            res.color = 'rgba(99, 102, 241, 0.8)';
            res.size = (data.size || 2) + 1;
          } else {
            res.color = 'rgba(100, 100, 140, 0.1)';
            res.hidden = true;
          }
        }
        return res;
      },
    });
    rendererRef.current = renderer;

    // Click handler
    renderer.on('clickNode', ({ node }) => {
      setSelectedNode(prev => {
        if (prev === node) {
          setNodeMemories([]);
          return null;
        }
        loadNodeMemories(node);
        return node;
      });
    });

    // Click stage to deselect
    renderer.on('clickStage', () => {
      setSelectedNode(null);
      setNodeMemories([]);
    });

    return () => {
      renderer.kill();
      rendererRef.current = null;
      graphRef.current = null;
    };
  }, [filteredRelations, selectedNode]);

  // Node stats
  const nodeSet = new Set<string>();
  filteredRelations.forEach(r => { nodeSet.add(r.subject); nodeSet.add(r.object); });

  // Unique agents for legend
  const agentIds = [...new Set(relations.map(r => r.agent_id || 'default'))];

  // Node connections for selected node
  const selectedRelations = selectedNode
    ? filteredRelations.filter(r => r.subject === selectedNode || r.object === selectedNode)
    : [];

  return (
    <div>
      <h1 className="page-title">{t('relations.title')}</h1>

      {/* Toolbar */}
      <div className="toolbar">
        {predicates.length > 0 && (
          <select value={predicateFilter} onChange={e => { setPredicateFilter(e.target.value); setTablePage(0); }}>
            <option value="">{t('relations.allPredicates', { count: predicates.length })}</option>
            {predicates.map(p => (
              <option key={p} value={p}>{p} ({relations.filter(r => r.predicate === p).length})</option>
            ))}
          </select>
        )}
        {selectedNode && (
          <button className="btn" onClick={() => { setSelectedNode(null); setNodeMemories([]); }} style={{ fontSize: 12 }}>
            ✕ {selectedNode}
          </button>
        )}
        <button
          onClick={() => setAutoRefresh(!autoRefresh)}
          title={t('relations.autoRefresh')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 11, padding: '3px 8px',
            background: autoRefresh ? 'rgba(34,197,94,0.15)' : 'transparent',
            color: autoRefresh ? '#22c55e' : 'var(--text-muted)',
            border: `1px solid ${autoRefresh ? 'rgba(34,197,94,0.3)' : 'var(--border)'}`,
            borderRadius: 'var(--radius)', cursor: 'pointer',
            whiteSpace: 'nowrap', transition: 'all 0.15s',
          }}
        >{autoRefresh ? '⏸' : '▶'} {t('relations.autoRefresh')}</button>
        <button className="btn" onClick={load} style={{ fontSize: 11, padding: '3px 8px' }}>
          {t('common.refresh') || 'Refresh'}
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {t('relations.nodeEdgeCount', { nodes: nodeSet.size, edges: filteredRelations.length })}
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn primary" onClick={() => setCreating(true)}>{t('relations.newRelation')}</button>
      </div>

      {/* Confidence threshold slider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 0 12px', padding: '8px 12px', background: 'var(--bg-card, rgba(30,30,50,0.5))', borderRadius: 'var(--radius)', fontSize: 13 }}>
        <label style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {t('relations.confidence') || 'Confidence'} ≥ {confidenceThreshold.toFixed(2)}
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={confidenceThreshold}
          onChange={e => { setConfidenceThreshold(parseFloat(e.target.value)); setTablePage(0); }}
          style={{ flex: 1, maxWidth: 300 }}
        />
        {/* Agent color legend */}
        {agentIds.length > 1 && (
          <div style={{ display: 'flex', gap: 8, marginLeft: 16, flexWrap: 'wrap' }}>
            {agentIds.slice(0, 8).map(aid => (
              <span key={aid} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: getAgentColor(aid, agentColorMap.current), display: 'inline-block' }} />
                <span style={{ color: 'var(--text-muted)' }}>{aid.length > 12 ? aid.slice(0, 11) + '…' : aid}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Sigma.js graph container */}
      {filteredRelations.length > 0 && (
        <div className="card" style={{ marginBottom: 16, position: 'relative' }}>
          <div
            ref={containerRef}
            style={{
              height: 'calc(100vh - 200px)',
              minHeight: 400,
              background: '#0f0f1a',
              borderRadius: 8,
            }}
          />
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            {t('relations.graphHint')} {t('relations.zoomHint')}
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
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 700 }}>
            <thead>
              <tr><th>{t('relations.subject')}</th><th>{t('relations.predicate')}</th><th>{t('relations.object')}</th><th>{t('relations.confidence')}</th><th style={{ whiteSpace: 'nowrap' }}>{t('relations.extractionCount')}</th><th style={{ whiteSpace: 'nowrap' }}>{t('relations.source')}</th><th style={{ whiteSpace: 'nowrap' }}>{t('relations.created')}</th><th></th></tr>
            </thead>
            <tbody>
              {filteredRelations.slice(tablePage * tableLimit, (tablePage + 1) * tableLimit).map(r => (
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
          {filteredRelations.length > tableLimit && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginTop: 12, gap: 8 }}>
              <button className="btn" disabled={tablePage === 0} onClick={() => setTablePage(p => p - 1)}>{t('common.prev')}</button>
              <span style={{ padding: '8px 16px', color: 'var(--text-muted)', fontSize: 13 }}>{t('common.page', { current: tablePage + 1, total: Math.ceil(filteredRelations.length / tableLimit) })}</span>
              <button className="btn" disabled={(tablePage + 1) * tableLimit >= filteredRelations.length} onClick={() => setTablePage(p => p + 1)}>{t('common.next')}</button>
            </div>
          )}
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
