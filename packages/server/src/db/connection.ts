import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { getConfig, createLogger } from '../utils/index.js';

const log = createLogger('db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return _db;
}

export function initDatabase(dbPath?: string): Database.Database {
  const config = getConfig();
  const resolvedPath = dbPath || config.storage.dbPath;

  // Ensure directory exists
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  log.info({ path: resolvedPath }, 'Initializing SQLite database');

  _db = new Database(resolvedPath);

  // Enable WAL mode for concurrent reads
  if (config.storage.walMode) {
    _db.pragma('journal_mode = WAL');
  }
  _db.pragma('foreign_keys = ON');
  _db.pragma('busy_timeout = 5000');

  // Run schema migrations
  runMigrations(_db);

  log.info('Database initialized successfully');
  return _db;
}

function runMigrations(db: Database.Database): void {
  // Create migration tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all().map((r: any) => r.name)
  );

  // Check if any new migrations need to be applied
  const pending = migrations.filter(m => !applied.has(m.name));
  if (pending.length === 0) return;

  // Pre-migration: integrity check
  const integrityResult = db.pragma('integrity_check') as any[];
  if (integrityResult[0]?.integrity_check !== 'ok') {
    log.error({ result: integrityResult }, 'Database integrity check FAILED before migration');
    throw new Error('Database integrity check failed — aborting migration');
  }

  // Pre-migration: backup database
  const dbPath = (db as any).name as string;
  if (dbPath && dbPath !== ':memory:') {
    const backupPath = `${dbPath}.backup-${Date.now()}`;
    try {
      fs.copyFileSync(dbPath, backupPath);
      log.info({ backupPath }, `Pre-migration backup created (${pending.length} migrations pending)`);

      // Cleanup old backups, keep latest 3
      const dir = path.dirname(dbPath);
      const baseName = path.basename(dbPath);
      const backups = fs.readdirSync(dir)
        .filter(f => f.startsWith(`${baseName}.backup-`))
        .sort()
        .reverse();
      for (const old of backups.slice(3)) {
        try { fs.unlinkSync(path.join(dir, old)); } catch { /* ignore */ }
      }
    } catch (e: any) {
      log.warn({ error: e.message }, 'Failed to create pre-migration backup (continuing anyway)');
    }
  }

  for (const migration of pending) {
    log.info({ migration: migration.name }, 'Applying migration');
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(migration.name);
    })();
  }
}

const migrations = [
  {
    name: '001_initial_schema',
    sql: `
      -- Core memories table
      CREATE TABLE memories (
        id            TEXT PRIMARY KEY,
        layer         TEXT NOT NULL CHECK (layer IN ('working', 'core', 'archive')),
        category      TEXT NOT NULL CHECK (category IN (
          'identity', 'preference', 'decision', 'fact', 'entity',
          'correction', 'todo', 'context', 'summary'
        )),
        content       TEXT NOT NULL,
        source        TEXT,
        agent_id      TEXT NOT NULL DEFAULT 'default',
        importance    REAL NOT NULL DEFAULT 0.5,
        confidence    REAL NOT NULL DEFAULT 0.8,
        decay_score   REAL NOT NULL DEFAULT 1.0,
        access_count  INTEGER NOT NULL DEFAULT 0,
        last_accessed DATETIME,
        created_at    DATETIME NOT NULL DEFAULT (datetime('now')),
        updated_at    DATETIME NOT NULL DEFAULT (datetime('now')),
        expires_at    DATETIME,
        superseded_by TEXT,
        metadata      TEXT
      );

      -- Full-text search index (BM25)
      CREATE VIRTUAL TABLE memories_fts USING fts5(
        content,
        category,
        content=memories,
        content_rowid=rowid,
        tokenize='unicode61'
      );

      -- FTS sync triggers
      CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content, category)
        VALUES (new.rowid, new.content, new.category);
      END;

      CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, category)
        VALUES ('delete', old.rowid, old.content, old.category);
      END;

      CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, category)
        VALUES ('delete', old.rowid, old.content, old.category);
        INSERT INTO memories_fts(rowid, content, category)
        VALUES (new.rowid, new.content, new.category);
      END;

      -- Access log
      CREATE TABLE access_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id   TEXT NOT NULL REFERENCES memories(id),
        query       TEXT,
        rank        INTEGER,
        was_useful  BOOLEAN,
        accessed_at DATETIME NOT NULL DEFAULT (datetime('now'))
      );

      -- Lifecycle audit log
      CREATE TABLE lifecycle_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        action      TEXT NOT NULL,
        memory_ids  TEXT NOT NULL,
        details     TEXT,
        executed_at DATETIME NOT NULL DEFAULT (datetime('now'))
      );

      -- Entity relations (lightweight knowledge graph)
      CREATE TABLE relations (
        id          TEXT PRIMARY KEY,
        subject     TEXT NOT NULL,
        predicate   TEXT NOT NULL,
        object      TEXT NOT NULL,
        confidence  REAL NOT NULL DEFAULT 0.8,
        source_memory_id TEXT REFERENCES memories(id),
        created_at  DATETIME NOT NULL DEFAULT (datetime('now')),
        updated_at  DATETIME NOT NULL DEFAULT (datetime('now'))
      );

      -- Indexes
      CREATE INDEX idx_memories_layer ON memories(layer);
      CREATE INDEX idx_memories_category ON memories(layer, category);
      CREATE INDEX idx_memories_decay ON memories(layer, decay_score);
      CREATE INDEX idx_memories_expires ON memories(expires_at) WHERE expires_at IS NOT NULL;
      CREATE INDEX idx_memories_agent ON memories(agent_id);
      CREATE INDEX idx_access_log_memory ON access_log(memory_id, accessed_at);
      CREATE INDEX idx_relations_subject ON relations(subject);
      CREATE INDEX idx_relations_object ON relations(object);
    `,
  },
  {
    name: '002_agents_table',
    sql: `
      CREATE TABLE agents (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        description     TEXT,
        config_override TEXT,
        created_at      DATETIME NOT NULL DEFAULT (datetime('now')),
        updated_at      DATETIME NOT NULL DEFAULT (datetime('now'))
      );

      -- Built-in agents
      INSERT INTO agents (id, name, description) VALUES
        ('default', 'Default Agent', 'System default agent using global configuration'),
        ('mcp', 'MCP Agent', 'Model Context Protocol agent for Claude Desktop / Cursor');

      -- Auto-create agents from existing memories
      INSERT OR IGNORE INTO agents (id, name, description)
      SELECT DISTINCT agent_id, agent_id, 'Auto-created from existing memories'
      FROM memories WHERE agent_id NOT IN ('default', 'mcp');
    `,
  },
  {
    name: '003_extend_categories',
    sql: `
      -- SQLite doesn't support ALTER CHECK, rebuild memories table with extended categories
      CREATE TABLE memories_new (
        id            TEXT PRIMARY KEY,
        layer         TEXT NOT NULL CHECK (layer IN ('working', 'core', 'archive')),
        category      TEXT NOT NULL CHECK (category IN (
          'identity', 'preference', 'decision', 'fact', 'entity',
          'correction', 'todo', 'context', 'summary',
          'skill', 'relationship', 'goal', 'insight', 'project_state'
        )),
        content       TEXT NOT NULL,
        source        TEXT,
        agent_id      TEXT NOT NULL DEFAULT 'default',
        importance    REAL NOT NULL DEFAULT 0.5,
        confidence    REAL NOT NULL DEFAULT 0.8,
        decay_score   REAL NOT NULL DEFAULT 1.0,
        access_count  INTEGER NOT NULL DEFAULT 0,
        last_accessed DATETIME,
        created_at    DATETIME NOT NULL DEFAULT (datetime('now')),
        updated_at    DATETIME NOT NULL DEFAULT (datetime('now')),
        expires_at    DATETIME,
        superseded_by TEXT,
        metadata      TEXT
      );

      INSERT INTO memories_new SELECT * FROM memories;

      -- Drop old FTS triggers, table, then old memories table
      DROP TRIGGER IF EXISTS memories_ai;
      DROP TRIGGER IF EXISTS memories_ad;
      DROP TRIGGER IF EXISTS memories_au;
      DROP TABLE IF EXISTS memories_fts;
      DROP TABLE memories;
      ALTER TABLE memories_new RENAME TO memories;

      -- Rebuild indexes
      CREATE INDEX idx_memories_layer ON memories(layer);
      CREATE INDEX idx_memories_category ON memories(layer, category);
      CREATE INDEX idx_memories_decay ON memories(layer, decay_score);
      CREATE INDEX idx_memories_expires ON memories(expires_at) WHERE expires_at IS NOT NULL;
      CREATE INDEX idx_memories_agent ON memories(agent_id);

      -- Rebuild FTS
      CREATE VIRTUAL TABLE memories_fts USING fts5(
        content,
        category,
        content=memories,
        content_rowid=rowid,
        tokenize='unicode61'
      );

      -- Re-populate FTS from existing data
      INSERT INTO memories_fts(rowid, content, category)
        SELECT rowid, content, category FROM memories;

      -- Rebuild FTS triggers
      CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content, category)
        VALUES (new.rowid, new.content, new.category);
      END;

      CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, category)
        VALUES ('delete', old.rowid, old.content, old.category);
      END;

      CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, category)
        VALUES ('delete', old.rowid, old.content, old.category);
        INSERT INTO memories_fts(rowid, content, category)
        VALUES (new.rowid, new.content, new.category);
      END;

      -- Add metadata column to agents table for profile storage
      ALTER TABLE agents ADD COLUMN metadata TEXT;

      -- Extraction logs table
      CREATE TABLE IF NOT EXISTS extraction_logs (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        session_id TEXT,
        exchange_preview TEXT,
        channel TEXT CHECK (channel IN ('fast', 'deep', 'flush')),
        raw_output TEXT,
        parsed_memories TEXT,
        memories_written INTEGER,
        memories_deduped INTEGER,
        latency_ms INTEGER,
        created_at DATETIME DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_extraction_logs_agent ON extraction_logs(agent_id, created_at);
    `,
  },
  {
    name: '004_smart_update_column',
    sql: `
      ALTER TABLE extraction_logs ADD COLUMN memories_smart_updated INTEGER DEFAULT 0;
    `,
  },
  {
    name: '005_agent_categories',
    sql: `
      -- Rebuild memories table with extended categories (14 → 20)
      CREATE TABLE memories_new (
        id            TEXT PRIMARY KEY,
        layer         TEXT NOT NULL CHECK (layer IN ('working', 'core', 'archive')),
        category      TEXT NOT NULL CHECK (category IN (
          'identity', 'preference', 'decision', 'fact', 'entity',
          'correction', 'todo', 'context', 'summary',
          'skill', 'relationship', 'goal', 'insight', 'project_state',
          'constraint', 'policy',
          'agent_self_improvement', 'agent_user_habit', 'agent_relationship', 'agent_persona'
        )),
        content       TEXT NOT NULL,
        source        TEXT,
        agent_id      TEXT NOT NULL DEFAULT 'default',
        importance    REAL NOT NULL DEFAULT 0.5,
        confidence    REAL NOT NULL DEFAULT 0.8,
        decay_score   REAL NOT NULL DEFAULT 1.0,
        access_count  INTEGER NOT NULL DEFAULT 0,
        last_accessed DATETIME,
        created_at    DATETIME NOT NULL DEFAULT (datetime('now')),
        updated_at    DATETIME NOT NULL DEFAULT (datetime('now')),
        expires_at    DATETIME,
        superseded_by TEXT,
        metadata      TEXT
      );

      INSERT INTO memories_new SELECT * FROM memories;

      -- Drop old FTS triggers, table, then old memories table
      DROP TRIGGER IF EXISTS memories_ai;
      DROP TRIGGER IF EXISTS memories_ad;
      DROP TRIGGER IF EXISTS memories_au;
      DROP TABLE IF EXISTS memories_fts;
      DROP TABLE memories;
      ALTER TABLE memories_new RENAME TO memories;

      -- Rebuild indexes
      CREATE INDEX idx_memories_layer ON memories(layer);
      CREATE INDEX idx_memories_category ON memories(layer, category);
      CREATE INDEX idx_memories_decay ON memories(layer, decay_score);
      CREATE INDEX idx_memories_expires ON memories(expires_at) WHERE expires_at IS NOT NULL;
      CREATE INDEX idx_memories_agent ON memories(agent_id);

      -- Rebuild FTS
      CREATE VIRTUAL TABLE memories_fts USING fts5(
        content,
        category,
        content=memories,
        content_rowid=rowid,
        tokenize='unicode61'
      );

      -- Re-populate FTS from existing data
      INSERT INTO memories_fts(rowid, content, category)
        SELECT rowid, content, category FROM memories;

      -- Rebuild FTS triggers
      CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content, category)
        VALUES (new.rowid, new.content, new.category);
      END;

      CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, category)
        VALUES ('delete', old.rowid, old.content, old.category);
      END;

      CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, category)
        VALUES ('delete', old.rowid, old.content, old.category);
        INSERT INTO memories_fts(rowid, content, category)
        VALUES (new.rowid, new.content, new.category);
      END;
    `,
  },
  {
    name: '006_relation_enhancements',
    sql: `
      -- Add agent_id and source columns to relations
      ALTER TABLE relations ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'default';
      ALTER TABLE relations ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';

      -- Unique constraint to prevent duplicate relations per agent
      CREATE UNIQUE INDEX idx_relations_unique ON relations(subject, predicate, object, agent_id);

      -- Index for agent filtering
      CREATE INDEX idx_relations_agent ON relations(agent_id);
    `,
  },
  {
    name: '007_relation_quality',
    sql: `
      -- Evidence chain table (provenance tracking)
      CREATE TABLE relation_evidence (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        relation_id TEXT NOT NULL REFERENCES relations(id) ON DELETE CASCADE,
        memory_id   TEXT REFERENCES memories(id),
        source      TEXT NOT NULL,
        confidence  REAL NOT NULL,
        context     TEXT,
        created_at  DATETIME NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_relation_evidence_rel ON relation_evidence(relation_id);
      CREATE INDEX idx_relation_evidence_mem ON relation_evidence(memory_id);

      -- Extraction confirmation count
      ALTER TABLE relations ADD COLUMN extraction_count INTEGER NOT NULL DEFAULT 1;

      -- Temporal marker (0=active, 1=past/expired fact)
      ALTER TABLE relations ADD COLUMN expired INTEGER NOT NULL DEFAULT 0;

      -- Backfill: create initial evidence for existing relations
      INSERT INTO relation_evidence (relation_id, memory_id, source, confidence)
      SELECT id, source_memory_id, source, confidence FROM relations;
    `,
  },
  {
    name: '008_memory_pinned',
    sql: `
      ALTER TABLE memories ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    name: '009_extraction_feedback',
    sql: `
      CREATE TABLE IF NOT EXISTS extraction_feedback (
        id          TEXT PRIMARY KEY,
        memory_id   TEXT NOT NULL,
        agent_id    TEXT NOT NULL DEFAULT 'default',
        feedback    TEXT NOT NULL CHECK (feedback IN ('good', 'bad', 'corrected')),
        original_content  TEXT,
        corrected_content TEXT,
        category    TEXT,
        source_channel TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_extraction_feedback_agent ON extraction_feedback(agent_id);
    `,
  },
  {
    name: '010_extraction_error_column',
    sql: `ALTER TABLE extraction_logs ADD COLUMN error TEXT;`,
  },
  {
    name: '011_extraction_input_hash',
    sql: `ALTER TABLE extraction_logs ADD COLUMN input_hash TEXT;`,
  },
  {
    name: '012_fts_jieba',
    sql: `
      -- Switch to jieba-based FTS: application-layer tokenization + unicode61
      -- jieba segments CJK text into words (天哥, 东京, 乌冬面, sing-box)
      -- unicode61 handles the space-separated tokens + non-CJK text
      -- Triggers removed: FTS sync now handled by application layer (tokenized writes)
      DROP TRIGGER IF EXISTS memories_ai;
      DROP TRIGGER IF EXISTS memories_ad;
      DROP TRIGGER IF EXISTS memories_au;
      DROP TABLE IF EXISTS memories_fts;

      -- External content table: content managed by application, not auto-synced
      CREATE VIRTUAL TABLE memories_fts USING fts5(
        content,
        category,
        content=memories,
        content_rowid=rowid,
        tokenize='unicode61'
      );
    `,
  },
  {
    name: '013_memory_self_improvement',
    sql: `
      -- Memory feedback: explicit user signals on recalled memories
      CREATE TABLE memory_feedback (
        id          TEXT PRIMARY KEY,
        memory_id   TEXT NOT NULL,
        agent_id    TEXT NOT NULL DEFAULT 'default',
        recall_id   TEXT,
        signal      TEXT NOT NULL CHECK (signal IN ('helpful', 'not_helpful', 'outdated', 'wrong')),
        comment     TEXT,
        source      TEXT NOT NULL DEFAULT 'explicit' CHECK (source IN ('explicit', 'implicit')),
        created_at  DATETIME NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_memory_feedback_memory ON memory_feedback(memory_id);
      CREATE INDEX idx_memory_feedback_agent ON memory_feedback(agent_id);
      CREATE INDEX idx_memory_feedback_recall ON memory_feedback(recall_id) WHERE recall_id IS NOT NULL;
      CREATE INDEX idx_memory_feedback_created ON memory_feedback(created_at);

      -- Importance adjustments: audit log of self-improvement changes
      CREATE TABLE importance_adjustments (
        id            TEXT PRIMARY KEY,
        memory_id     TEXT NOT NULL,
        agent_id      TEXT NOT NULL DEFAULT 'default',
        old_importance REAL NOT NULL,
        new_importance REAL NOT NULL,
        delta         REAL NOT NULL,
        reason        TEXT NOT NULL,
        feedback_ids  TEXT,
        created_at    DATETIME NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_importance_adj_memory ON importance_adjustments(memory_id);
      CREATE INDEX idx_importance_adj_agent ON importance_adjustments(agent_id);
      CREATE INDEX idx_importance_adj_created ON importance_adjustments(created_at);
    `,
  },

  {
    name: '014_pairing_code',
    sql: `
      ALTER TABLE memories ADD COLUMN pairing_code TEXT;
      CREATE INDEX IF NOT EXISTS idx_memories_agent_pairing ON memories(agent_id, pairing_code);
    `,
  },
];

export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
    log.info('Database closed');
  }
}

export function backupDb(): string | null {
  const db = getDb();
  const config = getConfig();
  const dbPath = config.storage.dbPath;
  const dir = path.dirname(dbPath);
  const baseName = path.basename(dbPath);
  const backupPath = `${dbPath}.daily-${new Date().toISOString().slice(0, 10)}`;

  try {
    db.backup(backupPath).catch((e: any) => log.warn({ error: e.message }, 'Daily backup async error'));
    log.info({ backupPath }, 'Daily backup started');

    // Keep latest 7 daily backups
    const backups = fs.readdirSync(dir)
      .filter(f => f.startsWith(`${baseName}.daily-`))
      .sort()
      .reverse();
    for (const old of backups.slice(7)) {
      try { fs.unlinkSync(path.join(dir, old)); } catch {}
    }
    return backupPath;
  } catch (e: any) {
    log.warn({ error: e.message }, 'Daily backup failed');
    return null;
  }
}
