import React, { useEffect, useState } from 'react';
import { useI18n } from '../../../i18n/index.js';

interface AuthStatus {
  authRequired: boolean;
  setupRequired: boolean;
  source: 'env' | 'config' | 'none';
  hasAgentTokens: boolean;
  agentTokenCount: number;
  mutable: boolean;
}

export default function AuthSection() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [oldToken, setOldToken] = useState('');
  const [newToken, setNewToken] = useState('');
  const [confirmToken, setConfirmToken] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const { t } = useI18n();

  const fetchStatus = () => {
    fetch('/api/v1/auth/status')
      .then(r => r.json())
      .then(setStatus)
      .catch(() => {});
  };

  useEffect(() => { fetchStatus(); }, []);

  const handleChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newToken !== confirmToken) {
      setError(t('settings.authTokenMismatch'));
      return;
    }
    if (newToken.length < 8) {
      setError(t('settings.authTokenTooShort'));
      return;
    }

    setLoading(true);
    try {
      const stored = localStorage.getItem('cortex_auth_token') || '';
      const res = await fetch('/api/v1/auth/change-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${stored}`,
        },
        body: JSON.stringify({ oldToken, newToken }),
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem('cortex_auth_token', newToken);
        setSuccess(t('settings.authTokenChanged'));
        setOldToken('');
        setNewToken('');
        setConfirmToken('');
        fetchStatus();
      } else {
        setError(data.error || 'Failed');
      }
    } catch {
      setError(t('login.networkError'));
    } finally {
      setLoading(false);
    }
  };

  if (!status) return null;

  const sourceLabel = status.source === 'env'
    ? t('settings.authSourceEnv')
    : status.source === 'config'
      ? t('settings.authSourceConfig')
      : t('settings.authSourceNone');

  const sourceIcon = status.source === 'env' ? '🔒' : status.source === 'config' ? '🔧' : '⚠️';

  return (
    <div>
      {/* Token source status */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 14px', background: 'var(--color-base)', borderRadius: 8,
        border: '1px solid var(--color-border)', marginBottom: 16, fontSize: 13,
      }}>
        <span style={{ fontSize: 16 }}>{sourceIcon}</span>
        <div>
          <div style={{ fontWeight: 600 }}>{t('settings.authTokenSource')}: {sourceLabel}</div>
          {status.source === 'env' && (
            <div style={{ color: 'var(--color-text-secondary)', marginTop: 2 }}>
              {t('settings.authEnvHint')}
            </div>
          )}
          {status.hasAgentTokens && (
            <div style={{ color: 'var(--color-text-secondary)', marginTop: 2 }}>
              {t('settings.authAgentTokens', { count: status.agentTokenCount })}
            </div>
          )}
        </div>
      </div>

      {/* Change token form (only when mutable) */}
      {status.mutable ? (
        <form onSubmit={handleChange}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>
                {t('settings.authCurrentToken')}
              </label>
              <input
                type="password"
                value={oldToken}
                onChange={e => setOldToken(e.target.value)}
                placeholder={t('settings.authCurrentTokenPlaceholder')}
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>
                {t('settings.authNewToken')}
              </label>
              <input
                type="password"
                value={newToken}
                onChange={e => setNewToken(e.target.value)}
                placeholder={t('settings.authNewTokenPlaceholder')}
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>
                {t('settings.authConfirmToken')}
              </label>
              <input
                type="password"
                value={confirmToken}
                onChange={e => setConfirmToken(e.target.value)}
                placeholder={t('settings.authConfirmTokenPlaceholder')}
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>
          </div>

          {error && (
            <div style={{
              fontSize: 13, color: 'var(--color-danger)', marginTop: 10,
              padding: '8px 10px', background: 'var(--color-danger-muted)',
              borderRadius: 'var(--radius-md)',
            }}>
              {error}
            </div>
          )}
          {success && (
            <div style={{
              fontSize: 13, color: 'var(--color-success)', marginTop: 10,
              padding: '8px 10px', background: 'var(--color-success-muted)',
              borderRadius: 'var(--radius-md)',
            }}>
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !oldToken || !newToken || !confirmToken}
            style={{
              marginTop: 12, padding: '8px 20px', fontSize: 13, fontWeight: 600,
              background: 'var(--color-primary)', color: '#fff', border: 'none',
              borderRadius: 'var(--radius-md)', cursor: loading ? 'wait' : 'pointer',
              opacity: loading || !oldToken || !newToken || !confirmToken ? 0.6 : 1,
            }}
          >
            {loading ? t('settings.authChanging') : t('settings.authChangeButton')}
          </button>
        </form>
      ) : (
        <div style={{
          padding: '12px 14px', background: 'var(--color-base)', borderRadius: 8,
          border: '1px solid var(--color-border)', fontSize: 13, color: 'var(--color-text-secondary)',
        }}>
          {t('settings.authEnvImmutable')}
        </div>
      )}
    </div>
  );
}
