import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listAgents, createAgent } from '../api/client.js';

const AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$|^[a-z0-9]{2}$/;

export default function Agents() {
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ id: '', name: '', description: '' });
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    listAgents()
      .then(res => setAgents(res.agents || []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!form.id || !form.name) {
      setFormError('ID and Name are required');
      return;
    }
    if (!AGENT_ID_RE.test(form.id)) {
      setFormError('ID must be 2-64 chars, lowercase alphanumeric with hyphens/underscores');
      return;
    }
    setCreating(true);
    setFormError('');
    try {
      await createAgent({ id: form.id, name: form.name, description: form.description || undefined });
      setShowModal(false);
      setForm({ id: '', name: '', description: '' });
      navigate(`/agents/${form.id}`);
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setCreating(false);
    }
  };

  if (error) return <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>;
  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 className="page-title" style={{ margin: 0 }}>Agents</h1>
        <button className="btn primary" onClick={() => setShowModal(true)}>+ New Agent</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340, 1fr))', gap: 16 }}>
        {agents.map((a: any) => {
          const config = a.config_override;
          const hasCustomConfig = !!config;

          return (
            <div
              key={a.id}
              className="card"
              style={{ cursor: 'pointer', transition: 'border-color 0.2s' }}
              onClick={() => navigate(`/agents/${a.id}`)}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{a.name}</div>
                  <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)', marginTop: 2 }}>{a.id}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {hasCustomConfig && (
                    <span className="badge" style={{ background: 'rgba(168,85,247,0.2)', color: '#c084fc', fontSize: 10 }}>
                      Custom Config
                    </span>
                  )}
                </div>
              </div>

              {a.description && (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.4 }}>
                  {a.description}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="badge" style={{ background: 'rgba(59,130,246,0.2)', color: '#60a5fa', fontSize: 11 }}>
                  {a.memory_count} memories
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {agents.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          No agents yet. Create your first agent to get started.
        </div>
      )}

      {/* Create Modal */}
      {showModal && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100 }}
            onClick={() => setShowModal(false)}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: 'var(--bg-card)', borderRadius: 'var(--radius)', border: '1px solid var(--border)',
            padding: 24, width: 420, maxWidth: '90vw', zIndex: 101,
            boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
          }}>
            <h3 style={{ marginTop: 0, marginBottom: 16 }}>Create New Agent</h3>

            <div className="form-group">
              <label>Agent ID</label>
              <input
                type="text"
                value={form.id}
                placeholder="my-agent"
                onChange={e => setForm(f => ({ ...f, id: e.target.value.toLowerCase() }))}
              />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Lowercase letters, numbers, hyphens, underscores. 2-64 characters.
              </div>
              {form.id && !AGENT_ID_RE.test(form.id) && (
                <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 2 }}>Invalid ID format</div>
              )}
            </div>

            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                value={form.name}
                placeholder="My Agent"
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="form-group">
              <label>Description <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>optional</span></label>
              <textarea
                value={form.description}
                placeholder="What does this agent do?"
                rows={3}
                style={{ width: '100%', resize: 'vertical' }}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>

            {formError && (
              <div style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 12 }}>{formError}</div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn primary" onClick={handleCreate} disabled={creating}>
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
