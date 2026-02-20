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

  for (const migration of migrations) {
    if (!applied.has(migration.name)) {
      log.info({ migration: migration.name }, 'Applying migration');
      db.transaction(() => {
        db.exec(migration.sql);
        db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(migration.name);
      })();
    }
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
        tokenize='trigram'
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
        tokenize='trigram'
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
];

export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
    log.info('Database closed');
  }
}
