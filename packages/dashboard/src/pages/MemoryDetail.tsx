import React, { useEffect, useState } from 'react';
import { getMemory, listMemories } from '../api/client.js';

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
}

export default function MemoryDetail({ memoryId, onBack }: { memoryId: string; onBack: () => void }) {
  const [memory, setMemory] = useState<Memory | null>(null);
  const [chain, setChain] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMemoryChain(memoryId);
  }, [memoryId]);

  const loadMemoryChain = async (id: string) => {
    setLoading(true);
    try {
      const mem = await getMemory(id);
      setMemory(mem);

      // Build superseded_by chain
      const chainMems: Memory[] = [mem];
      let currentId = mem.superseded_by;
      const visited = new Set<string>([id]);

      while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        try {
          const next = await getMemory(currentId);
          if (next) {
            chainMems.push(next);
            currentId = next.superseded_by;
          } else {
            break;
          }
        } catch {
          break;
        }
      }

      setChain(chainMems);
    } catch (e: any) {
      console.error(e);
    }
    setLoading(false);
  };

  if (loading) return <div className="empty">Loading...</div>;
  if (!memory) return <div className="empty">Memory not found</div>;

  return (
    <div>
      <button className="btn" onClick={onBack} style={{ marginBottom: 16 }}>← Back</button>
      <h1 className="page-title">Memory Detail</h1>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <span className={`badge ${memory.layer}`}>{memory.layer}</span>
          <span className="badge">{memory.category}</span>
        </div>

        <div style={{ marginBottom: 12 }}>
          <strong>Content:</strong>
          <div style={{ background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 8, marginTop: 4, whiteSpace: 'pre-wrap' }}>
            {memory.content}
          </div>
        </div>

        <table style={{ fontSize: 13 }}>
          <tbody>
            <tr><td style={{ color: 'var(--text-muted)', paddingRight: 16 }}>ID</td><td style={{ fontFamily: 'monospace', fontSize: 11 }}>{memory.id}</td></tr>
            <tr><td style={{ color: 'var(--text-muted)' }}>Importance</td><td>{memory.importance?.toFixed(2)}</td></tr>
            <tr><td style={{ color: 'var(--text-muted)' }}>Confidence</td><td>{memory.confidence?.toFixed(2)}</td></tr>
            <tr><td style={{ color: 'var(--text-muted)' }}>Decay Score</td><td>{memory.decay_score?.toFixed(3)}</td></tr>
            <tr><td style={{ color: 'var(--text-muted)' }}>Access Count</td><td>{memory.access_count}</td></tr>
            <tr><td style={{ color: 'var(--text-muted)' }}>Created</td><td>{memory.created_at}</td></tr>
            <tr><td style={{ color: 'var(--text-muted)' }}>Updated</td><td>{memory.updated_at}</td></tr>
            {memory.metadata && (
              <tr><td style={{ color: 'var(--text-muted)' }}>Metadata</td><td><pre style={{ fontSize: 11, margin: 0 }}>{JSON.stringify(JSON.parse(memory.metadata), null, 2)}</pre></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Revision Chain */}
      {chain.length > 1 && (
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Revision Chain ({chain.length} versions)</h3>
          <div style={{ position: 'relative' }}>
            {chain.map((m, i) => (
              <div key={m.id} style={{ display: 'flex', marginBottom: 16 }}>
                {/* Timeline connector */}
                <div style={{ width: 40, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: '50%',
                    background: i === 0 ? 'var(--primary)' : 'var(--border)',
                    border: '2px solid var(--primary)',
                    zIndex: 1,
                  }} />
                  {i < chain.length - 1 && (
                    <div style={{ width: 2, flex: 1, background: 'var(--border)' }} />
                  )}
                </div>

                {/* Content */}
                <div style={{
                  flex: 1,
                  padding: 12,
                  borderRadius: 8,
                  background: i === 0 ? 'rgba(99,102,241,0.1)' : 'rgba(0,0,0,0.15)',
                  border: i === 0 ? '1px solid var(--primary)' : '1px solid var(--border)',
                }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 6, fontSize: 12 }}>
                    <span className={`badge ${m.layer}`}>{m.layer}</span>
                    {i === 0 && <span style={{ color: 'var(--primary)', fontWeight: 600 }}>Current</span>}
                    {i > 0 && <span style={{ color: 'var(--text-muted)' }}>Superseded</span>}
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
