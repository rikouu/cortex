import React from 'react';
import { getConfig, updateConfig, triggerExport, triggerReindex } from '../../../api/client.js';

interface DataManagementProps {
  config: any;
  setConfig: (config: any) => void;
  setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
  t: (key: string, params?: any) => string;
}

export default function DataManagement({ config, setConfig, setToast, t }: DataManagementProps) {
  return (
    <>
      {/* ── Data Management ── */}
      <div className="card">
        <h3 style={{ marginBottom: 12 }}>{t('settings.dataManagement')}</h3>

        {/* Export */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('settings.exportLabel')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={async () => {
              try {
                const data = await triggerExport('json');
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = `cortex-export-${new Date().toISOString().slice(0, 10)}.json`; a.click();
                URL.revokeObjectURL(url);
                setToast({ message: t('settings.toastJsonExported'), type: 'success' });
              } catch (e: any) { setToast({ message: e.message, type: 'error' }); }
            }}>{t('settings.exportJson')}</button>
            <button className="btn" onClick={async () => {
              try {
                const data = await triggerExport('markdown');
                const blob = new Blob([data.content], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = `cortex-export-${new Date().toISOString().slice(0, 10)}.md`; a.click();
                URL.revokeObjectURL(url);
                setToast({ message: t('settings.toastMarkdownExported'), type: 'success' });
              } catch (e: any) { setToast({ message: e.message, type: 'error' }); }
            }}>{t('settings.exportMarkdown')}</button>
          </div>
        </div>

        {/* Reindex */}
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('settings.maintenance')}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn" onClick={async () => {
              if (!confirm(t('settings.confirmReindex'))) return;
              try {
                setToast({ message: t('settings.toastReindexStarted'), type: 'success' });
                const result = await triggerReindex();
                setToast({ message: t('settings.toastReindexComplete', { indexed: result.indexed, total: result.total, errors: result.errors }), type: result.errors > 0 ? 'error' : 'success' });
              } catch (e: any) { setToast({ message: t('settings.toastReindexFailed', { message: e.message }), type: 'error' }); }
            }}>{t('settings.rebuildIndex')}</button>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('settings.rebuildHint')}</span>
          </div>
        </div>
      </div>

      {/* ── Full Config JSON ── */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3>{t('settings.fullConfig')}</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.json';
              input.onchange = async (e: any) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const text = await file.text();
                  const parsed = JSON.parse(text);
                  // Strip read-only / sensitive fields that shouldn't be imported
                  delete parsed.port;
                  delete parsed.host;
                  delete parsed.storage;
                  delete parsed.auth;
                  delete parsed.cors;
                  delete parsed.rateLimit;
                  delete parsed.vectorBackend;
                  // Strip masked apiKey fields (hasApiKey: true but no real key)
                  for (const key of ['extraction', 'lifecycle']) {
                    if (parsed.llm?.[key]?.hasApiKey !== undefined) {
                      delete parsed.llm[key].hasApiKey;
                      if (!parsed.llm[key].apiKey) delete parsed.llm[key].apiKey;
                    }
                  }
                  if (parsed.embedding?.hasApiKey !== undefined) {
                    delete parsed.embedding.hasApiKey;
                    if (!parsed.embedding.apiKey) delete parsed.embedding.apiKey;
                  }
                  if (!confirm(t('settings.confirmImportConfig'))) return;
                  await updateConfig(parsed);
                  const refreshed = await getConfig();
                  setConfig(refreshed);
                  setToast({ message: t('settings.toastConfigImported'), type: 'success' });
                } catch (e: any) {
                  setToast({ message: t('settings.toastConfigImportFailed', { message: e.message }), type: 'error' });
                }
              };
              input.click();
            }}>{t('settings.importConfig')}</button>
            <button className="btn" onClick={() => {
              const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a'); a.href = url; a.download = `cortex-config-${new Date().toISOString().slice(0, 10)}.json`; a.click();
              URL.revokeObjectURL(url);
              setToast({ message: t('settings.toastJsonExported'), type: 'success' });
            }}>{t('settings.exportJson')}</button>
          </div>
        </div>
        <pre className="json-debug">{JSON.stringify(config, null, 2)}</pre>
      </div>
    </>
  );
}
