import React, { useState, useEffect } from 'react';
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
import { I18nProvider, useI18n } from './i18n/index.js';
import type { Locale } from './i18n/index.js';

function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { t } = useI18n();

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const handleSearch = async () => {
    if (!query.trim()) { setResults([]); return; }
    setLoading(true);
    setError('');
    try {
      const res = await search({ query, limit: 8, debug: false });
      setResults(res.results || []);
      setOpen(true);
    } catch (e: any) {
      setError(e.message || 'Unknown error');
      setResults([]);
      setOpen(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          placeholder={loading ? t('globalSearch.searching') : t('globalSearch.placeholder')}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSearch(); if (e.key === 'Escape') setOpen(false); }}
          onFocus={() => { if (results.length > 0 || error) setOpen(true); }}
          style={{ width: 200, fontSize: 13, padding: '6px 10px' }}
        />
      </div>
      {open && (error || results.length > 0) && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', maxHeight: 320, overflowY: 'auto',
            zIndex: 50, minWidth: 320, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}>
            {error && (
              <div style={{ padding: '10px 12px', color: 'var(--danger)', fontSize: 13 }}>
                {t('globalSearch.error', { message: error })}
              </div>
            )}
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
            {results.length > 0 && (
              <div
                style={{ padding: '8px 12px', textAlign: 'center', fontSize: 12, color: 'var(--primary)', cursor: 'pointer' }}
                onClick={() => { setOpen(false); navigate('/search'); }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
              >
                {t('globalSearch.fullSearch')}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function AppContent() {
  const { t, locale, setLocale } = useI18n();

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-logo">🧠 <span>Cortex</span></div>
        <div style={{ padding: '8px 12px' }}>
          <GlobalSearch />
        </div>
        <nav>
          <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>📊 {t('nav.dashboard')}</NavLink>
          <NavLink to="/memories" className={({ isActive }) => isActive ? 'active' : ''}>🗂️ {t('nav.memories')}</NavLink>
          <NavLink to="/agents" className={({ isActive }) => isActive ? 'active' : ''}>🤖 {t('nav.agents')}</NavLink>
          <NavLink to="/search" className={({ isActive }) => isActive ? 'active' : ''}>🔍 {t('nav.search')}</NavLink>
          <NavLink to="/relations" className={({ isActive }) => isActive ? 'active' : ''}>🕸️ {t('nav.relations')}</NavLink>
          <NavLink to="/lifecycle" className={({ isActive }) => isActive ? 'active' : ''}>♻️ {t('nav.lifecycle')}</NavLink>
          <NavLink to="/settings" className={({ isActive }) => isActive ? 'active' : ''}>⚙️ {t('nav.settings')}</NavLink>
        </nav>
        <div style={{ padding: '8px 12px', marginTop: 'auto' }}>
          <select
            value={locale}
            onChange={e => setLocale(e.target.value as Locale)}
            style={{ width: '100%', fontSize: 12, padding: '4px 8px' }}
          >
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
        </div>
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
      <I18nProvider>
        <AppContent />
      </I18nProvider>
    </BrowserRouter>
  );
}
