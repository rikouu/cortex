import React from 'react';
import { SectionKey } from '../types.js';

interface MarkdownExportSectionProps {
  config: any;
  editing: boolean;
  sectionHeader: (title: string, section: SectionKey) => React.ReactNode;
  displayRow: (label: string, value: any, desc?: string) => React.ReactNode;
  renderToggleField: (label: string, desc: string, path: string) => React.ReactNode;
  renderNumberField: (label: string, desc: string, path: string, min?: number, max?: number) => React.ReactNode;
  draft: any;
  updateDraft: (path: string, value: any) => void;
  t: (key: string, params?: any) => string;
}

const DEBOUNCE_PRESETS = [
  { value: 60000, label: '1 min' },
  { value: 180000, label: '3 min' },
  { value: 300000, label: '5 min' },
  { value: 600000, label: '10 min' },
  { value: 900000, label: '15 min' },
];

export default function MarkdownExportSection({
  config, editing, sectionHeader, displayRow, renderToggleField, draft, updateDraft, t,
}: MarkdownExportSectionProps) {
  const debounceMs = config.markdownExport?.debounceMs ?? 300000;
  const debounceMinutes = Math.round(debounceMs / 60000);

  return (
    <div className="card">
      {sectionHeader(t('settings.markdownExportTitle'), 'markdownExport')}
      {editing ? (
        <div style={{ padding: '4px 0' }}>
          {renderToggleField(
            t('settings.markdownExportEnabled'),
            t('settings.markdownExportEnabledDesc'),
            'enabled',
          )}
          {renderToggleField(
            t('settings.markdownExportMemoryMd'),
            t('settings.markdownExportMemoryMdDesc'),
            'exportMemoryMd',
          )}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontWeight: 500, display: 'block', marginBottom: 4 }}>
              {t('settings.markdownExportDebounceMs')}
            </label>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
              {t('settings.markdownExportDebounceMsDesc')}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {DEBOUNCE_PRESETS.map(p => (
                <button
                  key={p.value}
                  className={`btn${draft.debounceMs === p.value ? ' primary' : ''}`}
                  style={{ fontSize: 13, padding: '4px 12px' }}
                  onClick={() => updateDraft('debounceMs', p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div style={{
              fontSize: 12,
              color: 'var(--color-text-secondary)',
              background: 'var(--bg-secondary, #f5f5f5)',
              padding: '8px 12px',
              borderRadius: 6,
              lineHeight: 1.5,
            }}>
              💡 {t('settings.markdownExportDebounceTip', { minutes: Math.round((draft.debounceMs ?? 300000) / 60000) })}
            </div>
          </div>
        </div>
      ) : (
        <table>
          <tbody>
            {displayRow(
              t('settings.markdownExportEnabled'),
              config.markdownExport?.enabled ? '✅ ON' : '❌ OFF',
              t('settings.markdownExportEnabledDesc'),
            )}
            {displayRow(
              t('settings.markdownExportMemoryMd'),
              config.markdownExport?.exportMemoryMd ? '✅ ON' : '❌ OFF',
              t('settings.markdownExportMemoryMdDesc'),
            )}
            {displayRow(
              t('settings.markdownExportDebounceMs'),
              `${debounceMinutes} min (${debounceMs.toLocaleString()} ms)`,
              t('settings.markdownExportDebounceTip', { minutes: debounceMinutes }),
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
