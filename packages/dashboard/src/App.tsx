import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import Stats from './pages/Stats.js';
import MemoryBrowser from './pages/MemoryBrowser.js';
import SearchDebug from './pages/SearchDebug.js';
import RelationGraph from './pages/RelationGraph.js';
import LifecycleMonitor from './pages/LifecycleMonitor.js';
import Settings from './pages/Settings/index.js';
import Agents from './pages/Agents.js';
import AgentDetail from './pages/AgentDetail.js';
import ExtractionLogs from './pages/ExtractionLogs.js';
import SystemLogs from './pages/SystemLogs.js';
import { search, checkAuth, verifyToken, setStoredToken, getStoredToken, clearStoredToken, getHealth, triggerUpdate } from './api/client.js';
import { I18nProvider, useI18n } from './i18n/index.js';
import type { Locale } from './i18n/index.js';

// ============ Theme Management ============

function getInitialTheme(): 'dark' | 'light' {
  const stored = localStorage.getItem('cortex-theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return 'dark';
}

function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cortex-theme', theme);
  }, [theme]);

  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark');
  return { theme, toggle };
}

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
      minHeight: '100vh', background: 'var(--color-base)',
    }}>
      <div style={{
        background: 'var(--color-elevated)', border: '1px solid var(--color-border)',
        borderRadius: 16, padding: 36, width: 380,
        boxShadow: 'var(--shadow-xl)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🧠</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)', margin: 0, letterSpacing: '-0.02em' }}>Cortex</h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', marginTop: 6 }}>
            {t('login.subtitle')}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6 }}>
            {t('login.tokenLabel')}
          </label>
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder={t('login.tokenPlaceholder')}
            style={{
              width: '100%', padding: '10px 14px', fontSize: 14,
              boxSizing: 'border-box', marginBottom: 14,
            }}
            autoFocus
          />

          {error && (
            <div style={{
              fontSize: 13, color: 'var(--color-danger)', marginBottom: 14,
              padding: '10px 12px', background: 'var(--color-danger-muted)',
              borderRadius: 8, border: '1px solid var(--color-danger-border)',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !token.trim()}
            className="btn primary lg"
            style={{
              width: '100%', justifyContent: 'center',
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

// ============ Token Setup Page (first-time) ============

function SetupPage({ onSetup }: { onSetup: () => void }) {
  const [token, setToken] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { t } = useI18n();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    if (token !== confirm) {
      setError(t('setup.mismatch'));
      return;
    }
    if (token.length < 8) {
      setError(t('setup.tooShort'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/v1/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setStoredToken(token.trim());
        onSetup();
      } else {
        setError(data.error || 'Setup failed');
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
      minHeight: '100vh', background: 'var(--color-base)',
    }}>
      <div style={{
        background: 'var(--color-elevated)', border: '1px solid var(--color-border)',
        borderRadius: 16, padding: 36, width: 420,
        boxShadow: 'var(--shadow-xl)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🔐</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
            {t('setup.title')}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', marginTop: 8, lineHeight: 1.6 }}>
            {t('setup.subtitle')}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6 }}>
            {t('setup.tokenLabel')}
          </label>
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder={t('setup.tokenPlaceholder')}
            style={{
              width: '100%', padding: '10px 14px', fontSize: 14,
              boxSizing: 'border-box', marginBottom: 14,
            }}
            autoFocus
          />

          <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6 }}>
            {t('setup.confirmLabel')}
          </label>
          <input
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder={t('setup.confirmPlaceholder')}
            style={{
              width: '100%', padding: '10px 14px', fontSize: 14,
              boxSizing: 'border-box', marginBottom: 14,
            }}
          />

          {error && (
            <div style={{
              fontSize: 13, color: 'var(--color-danger)', marginBottom: 14,
              padding: '10px 12px', background: 'var(--color-danger-muted)',
              borderRadius: 8, border: '1px solid var(--color-danger-border)',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !token.trim() || !confirm.trim()}
            className="btn primary lg"
            style={{
              width: '100%', justifyContent: 'center',
              opacity: loading || !token.trim() || !confirm.trim() ? 0.6 : 1,
            }}
          >
            {loading ? t('setup.saving') : t('setup.submit')}
          </button>
        </form>

        <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 16, lineHeight: 1.5, textAlign: 'center' }}>
          {t('setup.hint')}
        </p>
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
          style={{ flex: 1, fontSize: 13, padding: '6px 10px' }}
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="btn primary sm"
          style={{ flexShrink: 0 }}
        >🔍</button>
      </div>
      {open && (error || results.length > 0) && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
            background: 'var(--color-elevated)', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)', maxHeight: 320, overflowY: 'auto',
            zIndex: 50, minWidth: 320, boxShadow: 'var(--shadow-lg)',
          }}>
            {error && (
              <div style={{ padding: '10px 14px', color: 'var(--color-danger)', fontSize: 13 }}>
                {t('globalSearch.error', { message: error })}
              </div>
            )}
            {results.map((r: any) => (
              <div
                key={r.id}
                style={{
                  padding: '10px 14px', borderBottom: '1px solid var(--color-border)',
                  cursor: 'pointer', fontSize: 13, transition: 'background 0.1s',
                }}
                onClick={() => { setOpen(false); setQuery(''); navigate('/memories'); }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
              >
                <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                  <span className={`badge ${r.layer}`} style={{ fontSize: 10 }}>{r.layer}</span>
                  <span className="badge" style={{ background: 'var(--color-info-muted)', color: '#60a5fa', fontSize: 10 }}>{r.category}</span>
                </div>
                <div style={{ color: 'var(--color-text-primary)', lineHeight: 1.4 }}>{r.content?.slice(0, 120)}{r.content?.length > 120 ? '...' : ''}</div>
              </div>
            ))}
            {results.length > 0 && (
              <div
                style={{
                  padding: '10px 14px', textAlign: 'center', fontSize: 12,
                  color: 'var(--color-primary)', cursor: 'pointer', transition: 'background 0.1s',
                }}
                onClick={() => { setOpen(false); navigate('/memories'); }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-hover)')}
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

// ============ Nav Icons (SVG) ============

const icons: Record<string, React.ReactNode> = {
  dashboard: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  memories: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 002-2V8a2 2 0 00-2-2h-7.93a2 2 0 01-1.66-.9l-.82-1.2A2 2 0 007.93 3H4a2 2 0 00-2 2v13c0 1.1.9 2 2 2z"/></svg>,
  agents: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 10-16 0"/></svg>,
  relations: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>,
  extraction: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  system: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
  lifecycle: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23,4 23,10 17,10"/><polyline points="1,20 1,14 7,14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>,
  settings: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
};

// ============ Main App Content ============

function AppContent() {
  const { t, locale, setLocale } = useI18n();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [authState, setAuthState] = useState<'checking' | 'setup' | 'login' | 'authenticated'>('checking');
  const [versionInfo, setVersionInfo] = useState<{
    version: string; github: string;
    latestRelease?: { version: string; url: string; publishedAt: string; updateAvailable: boolean } | null;
  } | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateCountdown, setUpdateCountdown] = useState(0);
  const [updateResult, setUpdateResult] = useState<'success'|'stale'|'down'|null>(null);
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState<string|null>(null);
  const { theme, toggle: toggleTheme } = useTheme();

  useEffect(() => {
    // Check auth status (new endpoint with setup detection)
    fetch('/api/v1/auth/status').then(r => r.json()).then(async (status: any) => {
      if (status.setupRequired) {
        setAuthState('setup');
        return;
      }
      if (!status.authRequired) {
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
        minHeight: '100vh', color: 'var(--color-text-tertiary)', fontSize: 14, gap: 10,
      }}>
        <span className="spinner" />
        {t('common.loading')}
      </div>
    );
  }

  if (authState === 'setup') {
    return <SetupPage onSetup={() => setAuthState('authenticated')} />;
  }

  if (authState === 'login') {
    return <LoginPage onLogin={() => setAuthState('authenticated')} />;
  }

  const navItems = [
    { to: '/', icon: icons.dashboard, label: t('nav.dashboard'), end: true },
    { to: '/memories', icon: icons.memories, label: t('nav.memories') },
    { to: '/agents', icon: icons.agents, label: t('nav.agents') },
    { to: '/relations', icon: icons.relations, label: t('nav.relations') },
  ];

  const logItems = [
    { to: '/extraction-logs', icon: icons.extraction, label: t('nav.extractionLogs') },
    { to: '/system-logs', icon: icons.system, label: t('nav.systemLogs') },
  ];

  const systemItems = [
    { to: '/lifecycle', icon: icons.lifecycle, label: t('nav.lifecycle') },
    { to: '/settings', icon: icons.settings, label: t('nav.settings') },
  ];

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
          <div style={{ padding: '8px 16px 10px', borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="version-badge">v{versionInfo.version}</span>
              <a
                href={versionInfo.github}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--color-text-tertiary)', textDecoration: 'none', display: 'flex', alignItems: 'center', transition: 'color 0.15s' }}
                title="GitHub"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
              </a>
              {!versionInfo.latestRelease?.updateAvailable && !updating && !updateResult && !checkMsg && (
                <button
                  disabled={checking}
                  onClick={async () => {
                    setChecking(true);
                    setCheckMsg(null);
                    try {
                      const h = await getHealth(true);
                      setVersionInfo({ version: h.version, github: h.github, latestRelease: h.latestRelease });
                      if (!h.latestRelease?.updateAvailable) {
                        setCheckMsg(locale === 'zh' ? '✅ 已是最新' : '✅ Up to date');
                        setTimeout(() => setCheckMsg(null), 3000);
                      }
                    } catch {
                      setCheckMsg(locale === 'zh' ? '❌ 检查失败' : '❌ Failed');
                      setTimeout(() => setCheckMsg(null), 3000);
                    }
                    setChecking(false);
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 3, marginLeft: 'auto',
                    fontSize: 10, padding: '2px 6px',
                    background: 'none', color: 'var(--color-text-tertiary)',
                    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
                    cursor: checking ? 'default' : 'pointer',
                    opacity: checking ? 0.5 : 0.7, transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { if (!checking) (e.target as HTMLElement).style.opacity = '1'; }}
                  onMouseLeave={e => { if (!checking) (e.target as HTMLElement).style.opacity = '0.7'; }}
                  title={locale === 'zh' ? '检查新版本' : 'Check for updates'}
                >
                  {checking ? (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 1s linear infinite' }}>
                      <path d="M21 12a9 9 0 11-6.219-8.56" />
                    </svg>
                  ) : (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M1 4v6h6M23 20v-6h-6" />
                      <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" />
                    </svg>
                  )}
                </button>
              )}
              {checkMsg && (
                <span style={{
                  marginLeft: 'auto', fontSize: 10,
                  color: checkMsg.startsWith('✅') ? 'var(--color-success)' : 'var(--color-danger)',
                  animation: 'fadeIn 0.2s ease',
                }}>{checkMsg}</span>
              )}
            </div>
            {versionInfo.latestRelease?.updateAvailable && !updating && !updateResult && (
              <div style={{ marginTop: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 11 }}>
                  <span style={{ color: 'var(--color-info)' }}>🆕 v{versionInfo.latestRelease.version}</span>
                  <a
                    href={versionInfo.latestRelease.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--color-primary)', textDecoration: 'none', fontSize: 10 }}
                  >{locale === 'zh' ? '更新日志' : 'Changelog'}</a>
                </div>
                <button
                  onClick={async () => {
                    if (!confirm(locale === 'zh' ? `确认更新到 v${versionInfo.latestRelease!.version}？服务器将短暂重启。` : `Update to v${versionInfo.latestRelease!.version}? Server will restart briefly.`)) return;
                    setUpdating(true);
                    setUpdateResult(null);
                    setUpdateCountdown(0);
                    const target = versionInfo.latestRelease!.version;

                    try { await triggerUpdate(); } catch {}

                    let elapsed = 0;
                    const pollTimer = setInterval(() => { elapsed++; setUpdateCountdown(elapsed); }, 1000);

                    let serverWentDown = false;
                    for (let i = 0; i < 15; i++) {
                      await new Promise(r => setTimeout(r, 1000));
                      try {
                        await getHealth();
                      } catch {
                        serverWentDown = true;
                        break;
                      }
                    }

                    let found = false;
                    const maxPollAttempts = serverWentDown ? 45 : 60;
                    for (let i = 0; i < maxPollAttempts; i++) {
                      await new Promise(r => setTimeout(r, 2000));
                      try {
                        const h = await getHealth();
                        if (h.version === target) {
                          clearInterval(pollTimer);
                          setUpdateResult('success');
                          setUpdating(false);
                          setTimeout(() => window.location.reload(), 1500);
                          found = true;
                          break;
                        } else if (h.version && serverWentDown) {
                          clearInterval(pollTimer);
                          setUpdateResult('stale');
                          setUpdating(false);
                          setVersionInfo({ version: h.version, github: h.github, latestRelease: h.latestRelease });
                          found = true;
                          break;
                        }
                      } catch {
                        serverWentDown = true;
                      }
                    }
                    clearInterval(pollTimer);
                    if (!found) {
                      setUpdateResult('down');
                      setUpdating(false);
                    }
                  }}
                  className="btn primary sm"
                  style={{ width: '100%', justifyContent: 'center', fontSize: 11 }}
                >{locale === 'zh' ? '⬆️ 立即更新' : '⬆️ Update now'}</button>
              </div>
            )}
            {updating && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 11, marginBottom: 4, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                  {updateCountdown < 5
                    ? (locale === 'zh' ? '📦 正在拉取镜像...' : '📦 Pulling image...')
                    : updateCountdown < 15
                      ? (locale === 'zh' ? '🔄 等待服务重启...' : '🔄 Waiting for restart...')
                      : (locale === 'zh' ? `⏳ 重建容器中... ${updateCountdown}s` : `⏳ Rebuilding container... ${updateCountdown}s`)
                  }
                </div>
                <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textAlign: 'center', marginBottom: 4 }}>
                  {locale === 'zh' ? '请勿关闭或刷新页面' : 'Do not close or refresh this page'}
                </div>
                <div style={{ height: 3, background: 'var(--color-border)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', background: 'var(--color-primary)', borderRadius: 2,
                    width: `${Math.min((updateCountdown / 90) * 100, 95)}%`,
                    transition: 'width 1s linear',
                  }} />
                </div>
              </div>
            )}
            {updateResult === 'success' && (
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-success)', textAlign: 'center' }}>
                ✅ {locale === 'zh' ? '更新成功！正在刷新...' : 'Updated! Reloading...'}
              </div>
            )}
            {updateResult === 'stale' && (
              <div style={{ marginTop: 6, fontSize: 11, textAlign: 'center' }}>
                <div style={{ color: 'var(--color-warning)' }}>⚠️ {locale === 'zh' ? '版本未变化 — 新镜像可能还在构建中，请稍后再试' : 'Version unchanged — new image may still be building, try again later'}</div>
                <button onClick={() => { setUpdateResult(null); }} className="btn ghost sm" style={{ fontSize: 10, marginTop: 4 }}>
                  {locale === 'zh' ? '🔄 重试' : '🔄 Retry'}
                </button>
              </div>
            )}
            {updateResult === 'down' && (
              <div style={{ marginTop: 6, fontSize: 11, textAlign: 'center' }}>
                <div style={{ color: 'var(--color-danger)' }}>❌ {locale === 'zh' ? '服务器无响应，容器可能在重建中' : 'Server unreachable, container may be rebuilding'}</div>
                <button onClick={() => window.location.reload()} className="btn ghost sm" style={{ fontSize: 10, marginTop: 4 }}>
                  {locale === 'zh' ? '刷新页面' : 'Refresh'}
                </button>
              </div>
            )}
          </div>
        )}

        <nav onClick={() => setSidebarOpen(false)}>
          {navItems.map(item => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => isActive ? 'active' : ''}>
              {item.icon} {item.label}
            </NavLink>
          ))}

          <div className="nav-divider" />
          <div className="nav-group-label">{locale === 'zh' ? '日志' : 'Logs'}</div>
          {logItems.map(item => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? 'active' : ''}>
              {item.icon} {item.label}
            </NavLink>
          ))}

          <div className="nav-divider" />
          <div className="nav-group-label">{locale === 'zh' ? '系统' : 'System'}</div>
          {systemItems.map(item => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? 'active' : ''}>
              {item.icon} {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          {/* Theme toggle */}
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>

          <select
            value={locale}
            onChange={e => setLocale(e.target.value as Locale)}
          >
            <option value="en">EN</option>
            <option value="zh">中文</option>
          </select>
          {getStoredToken() && (
            <button onClick={handleLogout}>
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
          {/* SearchDebug removed — use MemoryBrowser search or Stats recall test */}
          <Route path="/relations" element={<RelationGraph />} />
          <Route path="/extraction-logs" element={<ExtractionLogs />} />
          <Route path="/system-logs" element={<SystemLogs />} />
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
