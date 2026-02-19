import { getDb } from '../db/connection.js';
import { createLogger } from '../utils/logger.js';
import type { Memory } from '../db/queries.js';
import type { CortexConfig } from '../utils/config.js';
import fs from 'node:fs';
import path from 'node:path';

const log = createLogger('export');

const CATEGORY_LABELS: Record<string, string> = {
  identity: 'User Profile',
  preference: 'Preferences & Habits',
  decision: 'Key Decisions',
  fact: 'Facts',
  entity: 'Entities',
  correction: 'Corrections',
  todo: 'To-Do / Reminders',
  context: 'Context',
  summary: 'Historical Memory Summary',
};

export class MarkdownExporter {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private exportPath: string;

  constructor(private config: CortexConfig) {
    this.exportPath = path.dirname(config.storage.dbPath);
  }

  /** Schedule a debounced export */
  scheduleExport(): void {
    if (!this.config.markdownExport.enabled) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.exportAll().catch(e => log.error({ error: e.message }, 'Export failed'));
    }, this.config.markdownExport.debounceMs);
  }

  /** Export immediately */
  async exportAll(): Promise<void> {
    if (!this.config.markdownExport.enabled) return;

    try {
      await this.exportCoreToMemoryMd();
      await this.exportWorkingToDaily();
      await this.exportArchiveToMonthly();
      log.info('Markdown export completed');
    } catch (e: any) {
      log.error({ error: e.message }, 'Markdown export failed');
    }
  }

  private async exportCoreToMemoryMd(): Promise<void> {
    if (!this.config.markdownExport.exportMemoryMd) return;

    const db = getDb();
    const memories = db.prepare(
      "SELECT * FROM memories WHERE layer = 'core' AND superseded_by IS NULL ORDER BY category, importance DESC"
    ).all() as Memory[];

    const now = new Date().toISOString();
    const sections = new Map<string, Memory[]>();

    for (const m of memories) {
      const cat = m.category;
      if (!sections.has(cat)) sections.set(cat, []);
      sections.get(cat)!.push(m);
    }

    const lines: string[] = [
      '---',
      `exported_at: ${now}`,
      `total_entries: ${memories.length}`,
      'source: cortex SQLite',
      '---',
      '',
    ];

    // Ordered categories
    const categoryOrder = ['identity', 'preference', 'decision', 'fact', 'entity', 'correction', 'todo', 'summary'];

    for (const cat of categoryOrder) {
      const entries = sections.get(cat);
      if (!entries || entries.length === 0) continue;

      lines.push(`## ${CATEGORY_LABELS[cat] || cat}`);
      lines.push('');
      for (const e of entries) {
        lines.push(`- ${e.content}`);
      }
      lines.push('');
    }

    // Any remaining categories
    for (const [cat, entries] of sections) {
      if (categoryOrder.includes(cat)) continue;
      lines.push(`## ${CATEGORY_LABELS[cat] || cat}`);
      lines.push('');
      for (const e of entries) {
        lines.push(`- ${e.content}`);
      }
      lines.push('');
    }

    const outputPath = path.join(this.exportPath, 'MEMORY.md');
    this.ensureDir(path.dirname(outputPath));
    fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
    log.debug({ path: outputPath, entries: memories.length }, 'Core memory exported');
  }

  private async exportWorkingToDaily(): Promise<void> {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);

    const memories = db.prepare(
      "SELECT * FROM memories WHERE layer = 'working' AND date(created_at) = ? AND superseded_by IS NULL ORDER BY created_at"
    ).all(today) as Memory[];

    if (memories.length === 0) return;

    const lines: string[] = [
      '---',
      `exported_at: ${new Date().toISOString()}`,
      `date: ${today}`,
      'source: cortex SQLite',
      '---',
      '',
    ];

    for (const m of memories) {
      const time = m.created_at.slice(11, 16);
      lines.push(`## ${time}`);
      lines.push('');
      lines.push(`- ${m.content}`);
      lines.push('');
    }

    const outputDir = path.join(this.exportPath, 'working');
    this.ensureDir(outputDir);
    fs.writeFileSync(path.join(outputDir, `${today}.md`), lines.join('\n'), 'utf-8');
  }

  private async exportArchiveToMonthly(): Promise<void> {
    const db = getDb();
    const months = db.prepare(
      "SELECT DISTINCT substr(created_at, 1, 7) as month FROM memories WHERE layer = 'archive' AND superseded_by IS NULL"
    ).all() as { month: string }[];

    for (const { month } of months) {
      const memories = db.prepare(
        "SELECT * FROM memories WHERE layer = 'archive' AND substr(created_at, 1, 7) = ? AND superseded_by IS NULL ORDER BY created_at"
      ).all(month) as Memory[];

      if (memories.length === 0) continue;

      const lines: string[] = [
        '---',
        `type: archive`,
        `period: ${month}`,
        `entries: ${memories.length}`,
        'source: cortex SQLite',
        '---',
        '',
        '## Summary',
        '',
      ];

      for (const m of memories) {
        lines.push(`- ${m.content}`);
      }
      lines.push('');

      const outputDir = path.join(this.exportPath, 'archive');
      this.ensureDir(outputDir);
      fs.writeFileSync(path.join(outputDir, `${month}.md`), lines.join('\n'), 'utf-8');
    }
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
