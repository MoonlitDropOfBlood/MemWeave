export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  last_seen_at INTEGER,
  registered_at INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  device_id TEXT,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  observation_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT NOT NULL,
  concepts_json TEXT NOT NULL DEFAULT '[]',
  concepts_text TEXT NOT NULL DEFAULT '',
  files_json TEXT NOT NULL DEFAULT '[]',
  importance INTEGER NOT NULL,
  confidence REAL NOT NULL,
  strength REAL NOT NULL,
  source TEXT NOT NULL,
  scope_level TEXT NOT NULL,
  source_client TEXT,
  source_device_id TEXT,
  source_session_id TEXT,
  tau REAL NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at INTEGER,
  last_reinforced_at INTEGER,
  last_decay_at INTEGER,
  reinforcement_score REAL NOT NULL DEFAULT 0,
  promoted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  eviction_reason TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memory_scopes (
  memory_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(memory_id, key, value),
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  from_memory_id TEXT NOT NULL,
  to_memory_id TEXT NOT NULL,
  type TEXT NOT NULL,
  strength REAL NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (from_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  FOREIGN KEY (to_memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  hook_type TEXT NOT NULL,
  tool_name TEXT,
  tool_input TEXT,
  tool_output TEXT,
  timestamp INTEGER NOT NULL,
  memory_id TEXT,
  processed INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS access_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  session_id TEXT,
  device_id TEXT,
  source TEXT NOT NULL,
  query TEXT,
  rank INTEGER,
  score REAL,
  used_in_context INTEGER NOT NULL DEFAULT 0,
  accessed_at INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  title,
  summary,
  content,
  concepts_text,
  content='memories',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memory_fts(rowid, title, summary, content, concepts_text)
  VALUES (new.rowid, new.title, new.summary, new.content, new.concepts_text);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, title, summary, content, concepts_text)
  VALUES ('delete', old.rowid, old.title, old.summary, old.content, old.concepts_text);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, title, summary, content, concepts_text)
  VALUES ('delete', old.rowid, old.title, old.summary, old.content, old.concepts_text);
  INSERT INTO memory_fts(rowid, title, summary, content, concepts_text)
  VALUES (new.rowid, new.title, new.summary, new.content, new.concepts_text);
END;

CREATE INDEX IF NOT EXISTS idx_memories_tenant_tier_strength ON memories(tenant_id, tier, strength DESC);
CREATE INDEX IF NOT EXISTS idx_memories_tenant_type_created ON memories(tenant_id, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_scopes_tenant_key_value ON memory_scopes(tenant_id, key, value);
CREATE INDEX IF NOT EXISTS idx_memory_scopes_memory_id ON memory_scopes(memory_id);
CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_memory_id);
CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_memory_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_memory_time ON access_logs(memory_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_tenant_time ON access_logs(tenant_id, accessed_at DESC);

CREATE TABLE IF NOT EXISTS consolidation_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  promoted_count INTEGER NOT NULL DEFAULT 0,
  evicted_count INTEGER NOT NULL DEFAULT 0,
  merged_count INTEGER NOT NULL DEFAULT 0,
  edges_created_count INTEGER NOT NULL DEFAULT 0,
  contradiction_found_count INTEGER NOT NULL DEFAULT 0,
  promoted_ids TEXT NOT NULL DEFAULT '[]',
  evicted_ids TEXT NOT NULL DEFAULT '[]',
  merged_pairs TEXT NOT NULL DEFAULT '[]',
  dry_run INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_consolidation_runs_tenant_time
  ON consolidation_runs(tenant_id, started_at DESC);
`;
