/**
 * Database Migrations
 *
 * Manages schema versioning and upgrades.
 */

import type Database from 'better-sqlite3';

interface Migration {
  version: number;
  name: string;
  up: string;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: `
      -- Sessions table for resume functionality
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        last_accessed INTEGER DEFAULT (strftime('%s', 'now')),
        message_count INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        summary TEXT,
        tags TEXT,  -- JSON array
        lineage_parent_id TEXT,
        lineage_depth INTEGER DEFAULT 0,
        FOREIGN KEY (lineage_parent_id) REFERENCES sessions(id)
      );

      -- Session messages for full-text search
      CREATE TABLE IF NOT EXISTS session_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      -- Full-text search index
      CREATE VIRTUAL TABLE IF NOT EXISTS session_messages_fts USING fts5(
        content,
        content=session_messages,
        content_rowid=id
      );

      -- Triggers to keep FTS in sync
      CREATE TRIGGER IF NOT EXISTS session_messages_ai AFTER INSERT ON session_messages BEGIN
        INSERT INTO session_messages_fts(rowid, content) VALUES (new.id, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS session_messages_ad AFTER DELETE ON session_messages BEGIN
        INSERT INTO session_messages_fts(session_messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS session_messages_au AFTER UPDATE ON session_messages BEGIN
        INSERT INTO session_messages_fts(session_messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
        INSERT INTO session_messages_fts(rowid, content) VALUES (new.id, new.content);
      END;

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
      CREATE INDEX IF NOT EXISTS idx_sessions_accessed ON sessions(last_accessed DESC);
      CREATE INDEX IF NOT EXISTS idx_session_messages_session ON session_messages(session_id);
    `,
  },
  {
    version: 2,
    name: 'workers_and_fleet',
    up: `
      -- Workers table for fleet management
      CREATE TABLE IF NOT EXISTS workers (
        id TEXT PRIMARY KEY,
        handle TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'pending',
        role TEXT DEFAULT 'worker',
        worktree_path TEXT,
        worktree_branch TEXT,
        pid INTEGER,
        session_id TEXT,
        initial_prompt TEXT,
        last_heartbeat INTEGER,
        restart_count INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        dismissed_at INTEGER
      );

      -- Tasks table
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'pending',
        priority INTEGER DEFAULT 3,
        assigned_to TEXT,
        created_by TEXT,
        due_at INTEGER,
        completed_at INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (assigned_to) REFERENCES workers(handle)
      );

      -- Blackboard for inter-worker communication
      CREATE TABLE IF NOT EXISTS blackboard (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic TEXT NOT NULL,
        message TEXT NOT NULL,
        from_handle TEXT,
        priority INTEGER DEFAULT 0,
        expires_at INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_workers_status ON workers(status);
      CREATE INDEX IF NOT EXISTS idx_workers_handle ON workers(handle);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_blackboard_topic ON blackboard(topic);
    `,
  },
  {
    version: 3,
    name: 'beads_and_convoys',
    up: `
      -- Beads for structured work tracking
      CREATE TABLE IF NOT EXISTS beads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'pending',
        assigned_to TEXT,
        convoy_id TEXT,
        metadata TEXT,  -- JSON
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        completed_at INTEGER,
        FOREIGN KEY (convoy_id) REFERENCES convoys(id)
      );

      -- Convoys for grouping beads
      CREATE TABLE IF NOT EXISTS convoys (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'open',
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        closed_at INTEGER
      );

      -- Bead events for audit trail
      CREATE TABLE IF NOT EXISTS bead_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bead_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        actor TEXT,
        details TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (bead_id) REFERENCES beads(id) ON DELETE CASCADE
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_beads_status ON beads(status);
      CREATE INDEX IF NOT EXISTS idx_beads_convoy ON beads(convoy_id);
      CREATE INDEX IF NOT EXISTS idx_bead_events_bead ON bead_events(bead_id);
    `,
  },
  {
    version: 4,
    name: 'mail_and_handoffs',
    up: `
      -- Mailbox for worker-to-worker communication
      CREATE TABLE IF NOT EXISTS mailbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_handle TEXT NOT NULL,
        to_handle TEXT NOT NULL,
        subject TEXT,
        body TEXT NOT NULL,
        read_at INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );

      -- Handoffs for context transfer
      CREATE TABLE IF NOT EXISTS handoffs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_handle TEXT NOT NULL,
        to_handle TEXT NOT NULL,
        context TEXT NOT NULL,
        accepted_at INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_mailbox_to ON mailbox(to_handle);
      CREATE INDEX IF NOT EXISTS idx_mailbox_unread ON mailbox(to_handle, read_at);
      CREATE INDEX IF NOT EXISTS idx_handoffs_to ON handoffs(to_handle);
    `,
  },
  {
    version: 5,
    name: 'checkpoints_and_workflows',
    up: `
      -- Checkpoints for state persistence
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        worker_handle TEXT NOT NULL,
        goal TEXT NOT NULL,
        worked TEXT,  -- JSON array
        remaining TEXT,  -- JSON array
        context TEXT,  -- JSON
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );

      -- Workflows for DAG execution
      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'pending',
        steps TEXT NOT NULL,  -- JSON array of WorkflowStep
        context TEXT,  -- JSON
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        started_at INTEGER,
        completed_at INTEGER
      );

      -- Workflow step executions
      CREATE TABLE IF NOT EXISTS workflow_executions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        result TEXT,  -- JSON
        error TEXT,
        started_at INTEGER,
        completed_at INTEGER,
        FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_checkpoints_worker ON checkpoints(worker_handle);
      CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);
      CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow ON workflow_executions(workflow_id);
    `,
  },
];

/**
 * Run all pending migrations
 */
export function runMigrations(db: Database.Database): void {
  // Create migrations table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  // Get current version
  const currentVersion = db
    .prepare('SELECT MAX(version) as version FROM migrations')
    .get() as { version: number | null };

  const version = currentVersion?.version || 0;

  // Run pending migrations
  for (const migration of migrations) {
    if (migration.version > version) {
      db.transaction(() => {
        db.exec(migration.up);
        db.prepare('INSERT INTO migrations (version, name) VALUES (?, ?)').run(
          migration.version,
          migration.name
        );
      })();

      console.log(`Applied migration ${migration.version}: ${migration.name}`);
    }
  }
}

/**
 * Get the current schema version
 */
export function getSchemaVersion(db: Database.Database): number {
  try {
    const result = db
      .prepare('SELECT MAX(version) as version FROM migrations')
      .get() as { version: number | null };
    return result?.version || 0;
  } catch {
    return 0;
  }
}
