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
import ExtractionLogs from './pages/ExtractionLogs.js';
import { search, checkAuth, verifyToken, setStoredToken, getStoredToken, clearStoredToken, getHealth, triggerUpdate } from './api/client.js';
import { I18nProvider, useI18n } from './i18n/index.js';
import type { Locale } from './i18n/index.js';

// ============ Login Page ============

function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { t } = useI18n();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    setLoading(true);
    setError('');
    try {
      const result = await verifyToken(token.trim());
      if (result.valid) {
        setStoredToken(token.trim());
        onLogin();
      } else {
        setError(t('login.invalidToken'));
      }
    } catch {
      setError(t('login.networkError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: 'var(--bg)',
    }}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: 32, width: 360,
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🧠</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Cortex</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            {t('login.subtitle')}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
            {t('login.tokenLabel')}
          </label>
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder={t('login.tokenPlaceholder')}
            style={{
              width: '100%', padding: '10px 12px', fontSize: 14,
              boxSizing: 'border-box', marginBottom: 12,
            }}
            autoFocus
          />

          {error && (
            <div style={{
              fontSize: 13, color: 'var(--danger)', marginBottom: 12,
              padding: '8px 10px', background: 'rgba(239,68,68,0.1)',
              borderRadius: 'var(--radius)',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !token.trim()}
            style={{
              width: '100%', padding: '10px 0', fontSize: 14, fontWeight: 600,
              background: 'var(--primary)', color: '#fff', border: 'none',
              borderRadius: 'var(--radius)', cursor: loading ? 'wait' : 'pointer',
              opacity: loading || !token.trim() ? 0.6 : 1,
            }}
          >
            {loading ? t('login.verifying') : t('login.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}

// ============ Global Search ============

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

// ============ Main App Content ============

function AppContent() {
  const { t, locale, setLocale } = useI18n();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [authState, setAuthState] = useState<'checking' | 'login' | 'authenticated'>('checking');
  const [versionInfo, setVersionInfo] = useState<{
    version: string; github: string;
    latestRelease?: { version: string; url: string; publishedAt: string; updateAvailable: boolean } | null;
  } | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    // Check if auth is required
    checkAuth().then(async ({ authRequired }) => {
      if (!authRequired) {
        setAuthState('authenticated');
        return;
      }
      // Auth required — check if we have a valid stored token
      const stored = getStoredToken();
      if (stored) {
        const { valid } = await verifyToken(stored);
        if (valid) {
          setAuthState('authenticated');
          return;
        }
        clearStoredToken();
      }
      setAuthState('login');
    }).catch(() => {
      // If auth check fails (server down?), let user in and let API calls fail naturally
      setAuthState('authenticated');
    });

    // Listen for auth expiry events from API client
    const handleExpired = () => setAuthState('login');
    window.addEventListener('cortex:auth-expired', handleExpired);
    return () => window.removeEventListener('cortex:auth-expired', handleExpired);
  }, []);

  // Fetch version info
  useEffect(() => {
    if (authState !== 'authenticated') return;
    getHealth().then((data: any) => {
      setVersionInfo({ version: data.version, github: data.github, latestRelease: data.latestRelease });
    }).catch(() => {});
    // Re-check every 30 min
    const iv = setInterval(() => {
      getHealth().then((data: any) => {
        setVersionInfo({ version: data.version, github: data.github, latestRelease: data.latestRelease });
      }).catch(() => {});
    }, 30 * 60 * 1000);
    return () => clearInterval(iv);
  }, [authState]);

  const handleLogout = () => {
    clearStoredToken();
    setAuthState('login');
  };

  if (authState === 'checking') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', color: 'var(--text-muted)', fontSize: 14,
      }}>
        {t('common.loading')}
      </div>
    );
  }

  if (authState === 'login') {
    return <LoginPage onLogin={() => setAuthState('authenticated')} />;
  }

  return (
    <div className="app">
      {/* Mobile menu button */}
      <button className="mobile-menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Menu">
        {sidebarOpen ? '✕' : '☰'}
      </button>
      {/* Overlay */}
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-logo">🧠 <span>Cortex</span></div>
        {/* Version & GitHub & Update — under logo */}
        {versionInfo && (
          <div style={{ padding: '2px 16px 6px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontFamily: 'monospace' }}>v{versionInfo.version}</span>
              <a
                href={versionInfo.github}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--text-muted)', textDecoration: 'none', display: 'flex', alignItems: 'center' }}
                title="GitHub"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
              </a>
            </div>
            {versionInfo.latestRelease?.updateAvailable && (
              <button
                onClick={async () => {
                  if (updating) return;
                  if (!confirm(locale === 'zh' ? `确认更新到 v${versionInfo.latestRelease!.version}？服务器将短暂重启。` : `Update to v${versionInfo.latestRelease!.version}? Server will restart briefly.`)) return;
                  setUpdating(true);
                  try {
                    await triggerUpdate();
                  } catch {}
                  const target = versionInfo.latestRelease!.version;
                  let attempts = 0;
                  const poll = setInterval(async () => {
                    attempts++;
                    try {
                      const h = await getHealth();
                      if (h.version === target || attempts > 60) {
                        clearInterval(poll);
                        setUpdating(false);
                        setVersionInfo({ version: h.version, github: h.github, latestRelease: h.latestRelease });
                        if (h.version === target) window.location.reload();
                      }
                    } catch {}
                    if (attempts > 60) { clearInterval(poll); setUpdating(false); }
                  }, 3000);
                }}
                disabled={updating}
                style={{
                  display: 'block', width: '100%', fontSize: 11, padding: '3px 8px', marginTop: 4,
                  background: updating ? 'rgba(59,130,246,0.08)' : 'rgba(59,130,246,0.15)',
                  color: 'var(--primary)', border: '1px solid rgba(59,130,246,0.3)',
                  borderRadius: 'var(--radius)', cursor: updating ? 'wait' : 'pointer',
                  textAlign: 'center',
                }}
              >
                {updating
                  ? (locale === 'zh' ? '⏳ 更新中...' : '⏳ Updating...')
                  : `🆕 v${versionInfo.latestRelease.version} ${locale === 'zh' ? '点击更新' : 'Click to update'}`
                }
              </button>
            )}
          </div>
        )}
        <div style={{ padding: '8px 12px' }}>
          <GlobalSearch />
        </div>
        <nav onClick={() => setSidebarOpen(false)}>
          <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>📊 {t('nav.dashboard')}</NavLink>
          <NavLink to="/memories" className={({ isActive }) => isActive ? 'active' : ''}>🗂️ {t('nav.memories')}</NavLink>
          <NavLink to="/agents" className={({ isActive }) => isActive ? 'active' : ''}>🤖 {t('nav.agents')}</NavLink>
          <NavLink to="/search" className={({ isActive }) => isActive ? 'active' : ''}>🔍 {t('nav.search')}</NavLink>
          <NavLink to="/relations" className={({ isActive }) => isActive ? 'active' : ''}>🕸️ {t('nav.relations')}</NavLink>
          <NavLink to="/extraction-logs" className={({ isActive }) => isActive ? 'active' : ''}>📋 {t('nav.extractionLogs')}</NavLink>
          <NavLink to="/lifecycle" className={({ isActive }) => isActive ? 'active' : ''}>♻️ {t('nav.lifecycle')}</NavLink>
          <NavLink to="/settings" className={({ isActive }) => isActive ? 'active' : ''}>⚙️ {t('nav.settings')}</NavLink>
        </nav>
        <div style={{ padding: '8px 12px', marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <select
            value={locale}
            onChange={e => setLocale(e.target.value as Locale)}
            style={{ width: '100%', fontSize: 12, padding: '4px 8px' }}
          >
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
          {getStoredToken() && (
            <button
              onClick={handleLogout}
              style={{
                width: '100%', fontSize: 12, padding: '4px 8px',
                background: 'transparent', border: '1px solid var(--border)',
                color: 'var(--text-muted)', borderRadius: 'var(--radius)',
                cursor: 'pointer',
              }}
            >
              {t('login.logout')}
            </button>
          )}
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
          <Route path="/extraction-logs" element={<ExtractionLogs />} />
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
