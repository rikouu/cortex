import React, { useEffect, useState } from 'react';
import { getLifecycleLogs, runLifecycle, previewLifecycle, getConfig, listMemories } from '../api/client.js';
import { useI18n } from '../i18n/index.js';
import { toLocal } from '../utils/time.js';

interface PreviewDetail {
  promoted: number;
  merged: number;
  archived: number;
  compressedToCore: number;
  expiredWorking: number;
}

export default function LifecycleMonitor() {
  const [logs, setLogs] = useState<any[]>([]);
  const [preview, setPreview] = useState<PreviewDetail | null>(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [layerStats, setLayerStats] = useState<{ working: number; core: number; archive: number }>({ working: 0, core: 0, archive: 0 });
  const [affectedMemories, setAffectedMemories] = useState<any[]>([]);
  const [showAffected, setShowAffected] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    getLifecycleLogs(30).then(setLogs);
    getConfig().then(setConfig).catch(() => {});
    // Get layer stats
    Promise.all([
      listMemories({ layer: 'working', limit: '1', offset: '0' }),
      listMemories({ layer: 'core', limit: '1', offset: '0' }),
      listMemories({ layer: 'archive', limit: '1', offset: '0' }),
    ]).then(([w, c, a]: any[]) => {
      setLayerStats({ working: w.total, core: c.total, archive: a.total });
    }).catch(() => {});
  }, []);

  const [previewing, setPreviewing] = useState(false);

  const handlePreview = async () => {
    setPreviewing(true);
    try {
      const result = await previewLifecycle();
      setPreview(result);
      setAffectedMemories(result.affectedMemories || []);
    } catch (e: any) {
      alert(e.message);
    }
    setPreviewing(false);
  };

  const handleRun = async () => {
    if (!confirm(t('lifecycle.confirmRun'))) return;
    setRunning(true);
    try {
      const result = await runLifecycle(false);
      setRunResult(result);
      getLifecycleLogs(30).then(setLogs);
      // Refresh layer stats
      Promise.all([
        listMemories({ layer: 'working', limit: '1', offset: '0' }),
        listMemories({ layer: 'core', limit: '1', offset: '0' }),
        listMemories({ layer: 'archive', limit: '1', offset: '0' }),
      ]).then(([w, c, a]: any[]) => {
        setLayerStats({ working: w.total, core: c.total, archive: a.total });
      }).catch(() => {});
    } catch (e: any) {
      alert(e.message);
    }
    setRunning(false);
  };

  // Parse cron for human-readable schedule
  const parseCron = (cron: string) => {
    if (!cron) return t('lifecycle.cronNotConfigured');
    const parts = cron.split(' ');
    if (parts.length !== 5) return cron;
    const [min, hour, dom, mon, dow] = parts;
    const dayMap: Record<string, string> = { '0': 'Sun', '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat' };

    let desc = '';
    if (min === '0' && hour !== '*' && dom === '*' && mon === '*' && dow === '*') {
      desc = t('lifecycle.cronDailyAt', { time: `${hour!.padStart(2, '0')}:00` });
    } else if (min !== '*' && hour !== '*' && dom === '*' && mon === '*' && dow !== '*') {
      const days = dow!.split(',').map(d => dayMap[d] || d).join(', ');
      desc = `${days} at ${hour!.padStart(2, '0')}:${min!.padStart(2, '0')}`;
    } else if (min === '*' && hour === '*') {
      desc = t('lifecycle.cronEveryMinute');
    } else {
      desc = cron;
    }
    return desc;
  };

  // Lifecycle action history stats
  const actionCounts: Record<string, number> = {};
  logs.forEach(l => {
    const action = l.action || 'unknown';
    actionCounts[action] = (actionCounts[action] || 0) + 1;
  });

  // ─── Display helpers ─────────────────────────────────────────────────────
  const actionLabel = (action: string) => {
    const map: Record<string, string> = {
      'lifecycle_run': t('lifecycle.runLabel') || '🔄 运行',
      'promote': t('lifecycle.promoteLabel') || '⬆️ 升级',
      'expire_working': t('lifecycle.expireLabel') || '🗑️ 过期清理',
      'archive': t('lifecycle.archiveLabel') || '📦 归档',
      'merge': t('lifecycle.mergeLabel') || '🔗 合并',
      'compress': t('lifecycle.compressLabel') || '📐 压缩',
    };
    return map[action] || action;
  };

  const actionColor = (action: string) => {
    const map: Record<string, string> = {
      'lifecycle_run': 'rgba(99,102,241,0.7)',
      'promote': 'rgba(74,222,128,0.7)',
      'expire_working': 'rgba(239,68,68,0.6)',
      'archive': 'rgba(251,191,36,0.7)',
      'merge': 'rgba(56,189,248,0.7)',
      'compress': 'rgba(168,85,247,0.7)',
    };
    return map[action] || 'rgba(99,102,241,0.3)';
  };

  const formatMemoryIds = (raw: string) => {
    if (!raw || raw === '[]') return '\u2014';
    try {
      const ids = JSON.parse(raw);
      if (Array.isArray(ids) && ids.length === 0) return '\u2014';
      if (Array.isArray(ids)) return `${ids.length} 条`;
      return raw;
    } catch { return raw; }
  };

  const formatDetails = (action: string, raw: string) => {
    if (!raw) return '\u2014';
    try {
      const d = JSON.parse(raw);
      if (action === 'lifecycle_run') {
        const parts: string[] = [];
        if (d.promoted) parts.push(`升级 ${d.promoted}`);
        if (d.merged) parts.push(`合并 ${d.merged}`);
        if (d.archived) parts.push(`归档 ${d.archived}`);
        if (d.expiredWorking) parts.push(`清理 ${d.expiredWorking}`);
        if (d.compressedToCore) parts.push(`压缩 ${d.compressedToCore}`);
        if (parts.length === 0) {
          if (d.errors?.length > 0) return `❌ ${d.errors[0]}`;
          return '无变更';
        }
        return parts.join(' · ');
      }
      if (d.score) return `分数 ${Number(d.score).toFixed(2)}`;
      if (d.reason) return d.reason;
      return raw.length > 60 ? raw.slice(0, 60) + '…' : raw;
    } catch { return raw.length > 60 ? raw.slice(0, 60) + '…' : raw; }
  };

  const totalOps = preview
    ? (preview.promoted + preview.merged + preview.archived + preview.compressedToCore + preview.expiredWorking)
    : 0;

  return (
    <div>
      <h1 className="page-title">{t('lifecycle.title')}</h1>

      {/* Schedule & Config Info */}
      {config && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12 }}>{t('lifecycle.scheduleConfig')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{t('lifecycle.schedule')}</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{parseCron(config.lifecycle?.schedule)}</div>
              <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{config.lifecycle?.schedule}</code>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{t('lifecycle.promotionThreshold')}</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{config.lifecycle?.promotionThreshold}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('lifecycle.promotionDesc')}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{t('lifecycle.archiveThreshold')}</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{config.lifecycle?.archiveThreshold}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('lifecycle.archiveDesc')}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{t('lifecycle.decayLambda')}</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{config.lifecycle?.decayLambda}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('lifecycle.decayDesc')}</div>
            </div>
          </div>
        </div>
      )}

      {/* Layer Distribution (before/after) */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 12 }}>{t('lifecycle.currentDistribution')}</h3>
        <div style={{ display: 'flex', height: 32, borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
          {[
            { label: t('lifecycle.working'), value: layerStats.working, color: '#4ade80' },
            { label: t('lifecycle.core'), value: layerStats.core, color: '#818cf8' },
            { label: t('lifecycle.archive'), value: layerStats.archive, color: '#a1a1aa' },
          ].map((seg, i) => {
            const total = layerStats.working + layerStats.core + layerStats.archive;
            return (
              <div key={i} style={{
                width: total > 0 ? `${(seg.value / total) * 100}%` : '33.3%',
                background: seg.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 600, color: '#fff', minWidth: seg.value > 0 ? 32 : 0,
              }}>
                {seg.value > 0 && `${seg.label}: ${seg.value}`}
              </div>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="toolbar">
        <button className="btn" onClick={handlePreview} disabled={previewing || running}>
          {previewing ? `${t('lifecycle.preview')}...` : t('lifecycle.preview')}
        </button>
        <button className="btn primary" onClick={handleRun} disabled={running || previewing}>
          {running ? t('common.running') : t('lifecycle.runNow')}
        </button>
      </div>

      {/* Preview result */}
      {preview && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12 }}>{t('lifecycle.previewTitle', { count: totalOps })}</h3>
          {totalOps === 0 ? (
            <div style={{ padding: '16px 0', color: 'var(--text-muted)', textAlign: 'center' }}>
              ✅ {t('lifecycle.previewAllGood') || '当前没有需要处理的记忆。所有工作层记忆不足 24 小时或未达到升级条件。'}
            </div>
          ) : (
            <>
              <div className="card-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
                {preview.promoted > 0 && (
                  <div className="stat-card">
                    <div className="label">{t('lifecycle.wouldPromote')}</div>
                    <div className="value" style={{ color: 'var(--success)' }}>{preview.promoted}</div>
                  </div>
                )}
                {preview.merged > 0 && (
                  <div className="stat-card">
                    <div className="label">{t('lifecycle.wouldMerge')}</div>
                    <div className="value" style={{ color: 'var(--info)' }}>{preview.merged}</div>
                  </div>
                )}
                {preview.archived > 0 && (
                  <div className="stat-card">
                    <div className="label">{t('lifecycle.wouldArchive')}</div>
                    <div className="value" style={{ color: 'var(--warning)' }}>{preview.archived}</div>
                  </div>
                )}
                {preview.compressedToCore > 0 && (
                  <div className="stat-card">
                    <div className="label">{t('lifecycle.wouldCompress')}</div>
                    <div className="value" style={{ color: 'var(--danger)' }}>{preview.compressedToCore}</div>
                  </div>
                )}
                {preview.expiredWorking > 0 && (
                  <div className="stat-card">
                    <div className="label">{t('lifecycle.expiredWorking')}</div>
                    <div className="value">{preview.expiredWorking}</div>
                  </div>
                )}
              </div>

          {/* Show affected memories from backend dry run */}
          {affectedMemories.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => setShowAffected(!showAffected)} style={{ fontSize: 12 }}>
                {showAffected
                  ? t('lifecycle.hideAffected', { count: affectedMemories.length }) || `隐藏受影响记忆 (${affectedMemories.length})`
                  : t('lifecycle.showAffected', { count: affectedMemories.length }) || `查看受影响记忆 (${affectedMemories.length})`
                }
              </button>
              {showAffected && (
                <div style={{ marginTop: 12, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  <table style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>{t('lifecycle.contentCol')}</th>
                        <th>{t('lifecycle.categoryCol') || '分类'}</th>
                        <th>{t('lifecycle.importanceCol')}</th>
                        <th>{t('lifecycle.scoreCol') || '分数'}</th>
                        <th>{t('lifecycle.likelyAction')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {affectedMemories.map((m: any) => {
                        const actionMap: Record<string, { label: string; color: string }> = {
                          promote: { label: '⬆️ ' + t('lifecycle.promote'), color: 'var(--success)' },
                          expire: { label: '🗑️ ' + t('lifecycle.expire'), color: 'var(--danger)' },
                          archive: { label: '📦 ' + (t('lifecycle.archiveAction') || '归档'), color: 'var(--warning)' },
                          merge: { label: '🔗 ' + (t('lifecycle.mergeAction') || '合并'), color: 'var(--info)' },
                          compress: { label: '📐 ' + (t('lifecycle.compressAction') || '压缩'), color: 'var(--info)' },
                        };
                        const display = actionMap[m.action] || { label: m.action, color: 'var(--text-muted)' };
                        return (
                          <tr key={m.id}>
                            <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.content}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>{m.category}</td>
                            <td>{(m.importance ?? 0).toFixed(2)}</td>
                            <td>{m.score != null ? m.score.toFixed(2) : '\u2014'}</td>
                            <td style={{ color: display.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{display.label}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
            </>
          )}
        </div>
      )}

      {/* Run result */}
      {runResult && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--success)' }}>
          <h3 style={{ marginBottom: 12 }}>{t('lifecycle.lastRunResult')}</h3>
          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
            <div className="stat-card"><div className="label">{t('lifecycle.promoted')}</div><div className="value">{runResult.promoted}</div></div>
            <div className="stat-card"><div className="label">{t('lifecycle.merged')}</div><div className="value">{runResult.merged}</div></div>
            <div className="stat-card"><div className="label">{t('lifecycle.archived')}</div><div className="value">{runResult.archived}</div></div>
            <div className="stat-card"><div className="label">{t('lifecycle.compressed')}</div><div className="value">{runResult.compressedToCore}</div></div>
            <div className="stat-card"><div className="label">{t('lifecycle.duration')}</div><div className="value">{runResult.durationMs}ms</div></div>
          </div>
          {runResult.errors?.length > 0 && (
            <div style={{ marginTop: 12, color: 'var(--danger)' }}>
              {t('lifecycle.errors')}: {runResult.errors.join(', ')}
            </div>
          )}
        </div>
      )}

      {/* History action summary */}
      {Object.keys(actionCounts).length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12 }}>{t('lifecycle.actionSummary', { count: logs.length })}</h3>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {Object.entries(actionCounts).map(([action, count]) => (
              <div key={action} className="stat-card" style={{ padding: 12, minWidth: 100 }}>
                <div className="label">{action}</div>
                <div className="value" style={{ fontSize: 20 }}>{count}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History */}
      <div className="card">
        <h3 style={{ marginBottom: 12 }}>{t('lifecycle.historyTitle')}</h3>
        {logs.length === 0 ? (
          <div className="empty">{t('lifecycle.noEvents')}</div>
        ) : (
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table>
            <thead>
              <tr>
                <th>{t('lifecycle.action')}</th>
                <th>{t('lifecycle.memoryIds')}</th>
                <th>{t('lifecycle.details')}</th>
                <th style={{ whiteSpace: 'nowrap' }}>{t('lifecycle.time')}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log: any) => (
                <tr key={log.id}>
                  <td><span className="badge" style={{ background: actionColor(log.action), color: '#fff', whiteSpace: 'nowrap', fontSize: 11 }}>{actionLabel(log.action)}</span></td>
                  <td style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{formatMemoryIds(log.memory_ids)}</td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{formatDetails(log.action, log.details)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{toLocal(log.executed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
