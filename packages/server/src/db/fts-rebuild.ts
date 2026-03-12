/**
 * Rebuild FTS index with jieba-tokenized content.
 * Called once at startup after migration to ensure all memories are indexed
 * with proper CJK word segmentation.
 */

import { getDb } from './connection.js';
import { tokenize } from '../utils/tokenizer.js';
import { createLogger } from '../utils/index.js';

const log = createLogger('fts-rebuild');

export function rebuildFtsIndex(): void {
  const db = getDb();

  // Check if FTS was already rebuilt with jieba (tracked via metadata table)
  db.exec("CREATE TABLE IF NOT EXISTS _metadata (key TEXT PRIMARY KEY, value TEXT)");
  const marker = db.prepare(
    "SELECT value FROM _metadata WHERE key = 'fts_tokenizer'"
  ).get() as { value: string } | undefined;

  if (marker?.value === 'jieba') {
    // Verify count sanity (handle corrupted FTS gracefully)
    try {
      const ftsCount = (db.prepare("SELECT COUNT(*) as cnt FROM memories_fts").get() as any)?.cnt ?? 0;
      const memCount = (db.prepare("SELECT COUNT(*) as cnt FROM memories").get() as any)?.cnt ?? 0;
      if (ftsCount > 0 && Math.abs(ftsCount - memCount) < memCount * 0.1) {
        log.info({ ftsCount, memCount }, 'FTS index (jieba) looks healthy, skipping rebuild');
        return;
      }
    } catch {
      log.warn('FTS table corrupted or missing, will rebuild');
    }
  }

  const memCount = (db.prepare("SELECT COUNT(*) as cnt FROM memories").get() as any)?.cnt ?? 0;
  log.info({ memCount }, 'Rebuilding FTS index with jieba tokenization');

  // Drop and recreate FTS table to avoid SQLITE_CORRUPT_VTAB errors
  // when upgrading from older versions with different FTS schema (content=memories)
  try {
    db.exec("DROP TABLE IF EXISTS memories_fts");
  } catch {
    // Ignore drop errors on corrupted vtables
    log.warn('Could not drop old FTS table cleanly, attempting forced rebuild');
    try {
      db.exec("DELETE FROM memories_fts");
    } catch {
      // Last resort: the table is truly corrupted, sqlite will recreate on next CREATE
    }
  }

  // Drop legacy FTS triggers (we manage sync manually with jieba tokenization)
  db.exec("DROP TRIGGER IF EXISTS memories_ai");
  db.exec("DROP TRIGGER IF EXISTS memories_ad");
  db.exec("DROP TRIGGER IF EXISTS memories_au");

  // Recreate FTS table as standalone (no external content linkage)
  // Content is managed manually with jieba tokenization
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      category,
      tokenize='unicode61'
    )
  `);

  // Rebuild with jieba-tokenized content
  const rows = db.prepare('SELECT rowid, content, category FROM memories').all() as {
    rowid: number;
    content: string;
    category: string;
  }[];

  const insertStmt = db.prepare(
    'INSERT INTO memories_fts(rowid, content, category) VALUES (?, ?, ?)'
  );

  const tx = db.transaction(() => {
    for (const row of rows) {
      insertStmt.run(row.rowid, tokenize(row.content), row.category);
    }
  });
  tx();

  // Mark FTS as jieba-tokenized
  db.exec("CREATE TABLE IF NOT EXISTS _metadata (key TEXT PRIMARY KEY, value TEXT)");
  db.prepare("INSERT OR REPLACE INTO _metadata (key, value) VALUES ('fts_tokenizer', 'jieba')").run();

  log.info({ indexed: rows.length }, 'FTS index rebuilt with jieba tokenization');
}
