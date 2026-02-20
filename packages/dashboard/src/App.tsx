import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import Stats from './pages/Stats.js';
import MemoryBrowser from './pages/MemoryBrowser.js';
import SearchDebug from './pages/SearchDebug.js';
import RelationGraph from './pages/RelationGraph.js';
import LifecycleMonitor from './pages/LifecycleMonitor.js';
import Settings from './pages/Settings.js';
import Agents from './pages/Agents.js';
import AgentDetail from './pages/AgentDetail.js';
import { search } from './api/client.js';

function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const handleSearch = async () => {
    if (!query.trim()) { setResults([]); return; }
    try {
      const res = await search({ query, limit: 8, debug: false });
      setResults(res.results || []);
      setOpen(true);
    } catch { setResults([]); }
  };

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          placeholder="Quick search..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSearch(); if (e.key === 'Escape') setOpen(false); }}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          style={{ width: 200, fontSize: 13, padding: '6px 10px' }}
        />
      </div>
      {open && results.length > 0 && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', maxHeight: 320, overflowY: 'auto',
            zIndex: 50, minWidth: 320, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}>
            {results.map((r: any) => (
              <div
                key={r.id}
                style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 13 }}
                onClick={() => { setOpen(false); setQuery(''); navigate('/memories'); }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
              >
                <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                  <span className={`badge ${r.layer}`} style={{ fontSize: 10 }}>{r.layer}</span>
                  <span className="badge" style={{ background: 'rgba(59,130,246,0.2)', color: '#60a5fa', fontSize: 10 }}>{r.category}</span>
                </div>
                <div style={{ color: 'var(--text)', lineHeight: 1.4 }}>{r.content?.slice(0, 120)}{r.content?.length > 120 ? '...' : ''}</div>
              </div>
            ))}
            <div
              style={{ padding: '8px 12px', textAlign: 'center', fontSize: 12, color: 'var(--primary)', cursor: 'pointer' }}
              onClick={() => { setOpen(false); navigate('/search'); }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              Full search in Search Debug
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AppContent() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-logo">🧠 <span>Cortex</span></div>
        <div style={{ padding: '8px 12px' }}>
          <GlobalSearch />
        </div>
        <nav>
          <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>📊 Dashboard</NavLink>
          <NavLink to="/memories" className={({ isActive }) => isActive ? 'active' : ''}>🗂️ Memories</NavLink>
          <NavLink to="/agents" className={({ isActive }) => isActive ? 'active' : ''}>🤖 Agents</NavLink>
          <NavLink to="/search" className={({ isActive }) => isActive ? 'active' : ''}>🔍 Search</NavLink>
          <NavLink to="/relations" className={({ isActive }) => isActive ? 'active' : ''}>🕸️ Relations</NavLink>
          <NavLink to="/lifecycle" className={({ isActive }) => isActive ? 'active' : ''}>♻️ Lifecycle</NavLink>
          <NavLink to="/settings" className={({ isActive }) => isActive ? 'active' : ''}>⚙️ Settings</NavLink>
        </nav>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Stats />} />
          <Route path="/memories" element={<MemoryBrowser />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/agents/:id" element={<AgentDetail />} />
          <Route path="/search" element={<SearchDebug />} />
          <Route path="/relations" element={<RelationGraph />} />
          <Route path="/lifecycle" element={<LifecycleMonitor />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
