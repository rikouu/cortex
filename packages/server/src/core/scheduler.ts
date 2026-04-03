/**
 * Scheduler — cron-based lifecycle runner + post-ingest markdown export trigger.
 *
 * This module wires up the two "phantom features" that had config but no runtime:
 * 1. Lifecycle schedule (config.lifecycle.schedule) → runs LifecycleEngine on cron
 * 2. Markdown export (config.markdownExport.enabled) → scheduleExport() after ingest
 */

import { Cron } from 'croner';
import type { CortexApp } from '../app.js';
import type { CortexConfig } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { backupDb } from '../db/connection.js';
import { listAgents } from '../db/agent-queries.js';

const log = createLogger('scheduler');

let lifecycleCron: Cron | null = null;

export function getSchedulerStatus(): { running: boolean; schedule: string | null; nextRun: string | null } {
  if (!lifecycleCron) return { running: false, schedule: null, nextRun: null };
  const next = lifecycleCron.nextRun();
  return {
    running: true,
    schedule: lifecycleCron.getPattern() || null,
    nextRun: next ? next.toISOString() : null,
  };
}

/**
 * Start the lifecycle cron job based on config.lifecycle.schedule.
 * Safe to call multiple times — stops previous job first.
 */
export function startLifecycleScheduler(cortex: CortexApp): void {
  stopLifecycleScheduler();

  const schedule = cortex.config.lifecycle?.schedule;
  if (!schedule) {
    log.info('Lifecycle schedule not configured, skipping');
    return;
  }

  try {
    const tz = process.env.TZ || 'UTC';
    lifecycleCron = new Cron(schedule, { timezone: tz }, async () => {
      log.info({ schedule }, 'Lifecycle cron triggered');
      try { backupDb(); } catch (e: any) { log.warn({ error: e.message }, 'Pre-lifecycle backup failed'); }
      try {
        const agents = listAgents();
        if (agents.length === 0) {
          const report = await cortex.lifecycle.run(false, 'scheduled');
          log.info(
            {
              promoted: report.promoted,
              archived: report.archived,
              merged: report.merged,
              importanceAdjusted: report.importanceAdjusted,
            },
            'Lifecycle cron completed',
          );
          return;
        }

        const totals = {
          promoted: 0,
          archived: 0,
          merged: 0,
          importanceAdjusted: 0,
        };

        for (const agent of agents) {
          const report = await cortex.getRuntime(agent.id).lifecycle.run(false, 'scheduled', agent.id);
          totals.promoted += report.promoted;
          totals.archived += report.archived;
          totals.merged += report.merged;
          totals.importanceAdjusted += report.importanceAdjusted ?? 0;
        }

        log.info(totals, 'Lifecycle cron completed');
      } catch (e: any) {
        log.error({ error: e.message }, 'Lifecycle cron failed');
      }
    });

    const next = lifecycleCron.nextRun();
    log.info({ schedule, timezone: tz, nextRun: next?.toISOString() }, 'Lifecycle scheduler started');
  } catch (e: any) {
    log.error({ error: e.message, schedule }, 'Failed to start lifecycle scheduler (invalid cron?)');
  }
}

/**
 * Stop the lifecycle cron job.
 */
export function stopLifecycleScheduler(): void {
  if (lifecycleCron) {
    lifecycleCron.stop();
    lifecycleCron = null;
    log.info('Lifecycle scheduler stopped');
  }
}

/**
 * Restart the scheduler with new config (e.g. after config update from Dashboard).
 */
export function restartLifecycleScheduler(cortex: CortexApp): void {
  startLifecycleScheduler(cortex);
}

/**
 * Trigger markdown export after a successful ingest (debounced inside exporter).
 */
export function triggerMarkdownExport(cortex: CortexApp): void {
  if (cortex.config.markdownExport?.enabled) {
    cortex.exporter.scheduleExport();
  }
}
