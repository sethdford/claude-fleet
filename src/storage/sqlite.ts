/**
 * SQLite Storage Implementation
 *
 * Persistent storage for team coordination using better-sqlite3.
 */

import Database from 'better-sqlite3';
import type {
  TeamStorage,
  TeamAgent,
  Chat,
  Message,
  TeamTask,
  TaskStatus,
  PersistentWorker,
  WorkerStatus,
  WorkItem,
  WorkItemStatus,
  Batch,
  BatchStatus,
  WorkItemEvent,
  WorkItemEventType,
  MailMessage,
  Handoff,
  AgentRole,
  SpawnMode,
  SwarmTemplate,
} from '../types.js';

export class SQLiteStorage implements TeamStorage {
  private db: Database.Database;
  private stmts: {
    // Users
    insertUser: Database.Statement;
    getUser: Database.Statement;
    getUsersByTeam: Database.Statement;
    // Chats
    insertChat: Database.Statement;
    getChat: Database.Statement;
    getChatsByUser: Database.Statement;
    updateChatTime: Database.Statement;
    // Messages
    insertMessage: Database.Statement;
    getMessages: Database.Statement;
    getMessagesAfter: Database.Statement;
    // Unread
    getUnread: Database.Statement;
    setUnread: Database.Statement;
    incrementUnread: Database.Statement;
    clearUnread: Database.Statement;
    // Tasks
    insertTask: Database.Statement;
    getTask: Database.Statement;
    getTasksByTeam: Database.Statement;
    updateTaskStatus: Database.Statement;
    updateTaskAssignment: Database.Statement;
    // Workers (Phase 1)
    insertWorker: Database.Statement;
    getWorker: Database.Statement;
    getWorkerByHandle: Database.Statement;
    getAllWorkers: Database.Statement;
    getActiveWorkers: Database.Statement;
    updateWorkerStatus: Database.Statement;
    updateWorkerHeartbeat: Database.Statement;
    updateWorkerPid: Database.Statement;
    dismissWorker: Database.Statement;
    deleteWorkerByHandle: Database.Statement;
    // Work Items (Phase 2)
    insertWorkItem: Database.Statement;
    getWorkItem: Database.Statement;
    getAllWorkItems: Database.Statement;
    getWorkItemsByBatch: Database.Statement;
    getWorkItemsByAssignee: Database.Statement;
    updateWorkItemStatus: Database.Statement;
    assignWorkItem: Database.Statement;
    // Batches (Phase 2)
    insertBatch: Database.Statement;
    getBatch: Database.Statement;
    getAllBatches: Database.Statement;
    updateBatchStatus: Database.Statement;
    // Work Item Events (Phase 2)
    insertWorkItemEvent: Database.Statement;
    getWorkItemEvents: Database.Statement;
    // Mail (Phase 3)
    insertMail: Database.Statement;
    getMail: Database.Statement;
    getUnreadMail: Database.Statement;
    getAllMailTo: Database.Statement;
    markMailRead: Database.Statement;
    // Handoffs (Phase 3)
    insertHandoff: Database.Statement;
    getHandoff: Database.Statement;
    getPendingHandoffs: Database.Statement;
    acceptHandoff: Database.Statement;
    // Swarms
    insertSwarm: Database.Statement;
    getSwarm: Database.Statement;
    getAllSwarms: Database.Statement;
    deleteSwarm: Database.Statement;
    // Templates
    insertTemplate: Database.Statement;
    getTemplate: Database.Statement;
    getTemplateByName: Database.Statement;
    getAllTemplates: Database.Statement;
    getBuiltinTemplates: Database.Statement;
    getUserTemplates: Database.Statement;
    updateTemplate: Database.Statement;
    deleteTemplate: Database.Statement;
    // Routing History (Phase 4)
    insertRoutingHistory: Database.Statement;
    getRoutingHistory: Database.Statement;
    getRoutingHistoryByComplexity: Database.Statement;
    // Agent Memory (Phase 5)
    insertAgentMemory: Database.Statement;
    getAgentMemory: Database.Statement;
    getAgentMemoriesByAgent: Database.Statement;
    getAgentMemoryByKey: Database.Statement;
    updateAgentMemoryAccess: Database.Statement;
    updateAgentMemoryRelevance: Database.Statement;
    deleteAgentMemory: Database.Statement;
  };

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
    this.runMigrations();
    this.stmts = this.prepareStatements();
  }

  /**
   * Run migrations to add new columns to existing databases
   */
  private runMigrations(): void {
    // Add spawn_mode and pane_id columns to workers table if they don't exist
    try {
      this.db.exec('ALTER TABLE workers ADD COLUMN spawn_mode TEXT DEFAULT \'process\'');
    } catch {
      // Column already exists, ignore
    }
    try {
      this.db.exec('ALTER TABLE workers ADD COLUMN pane_id TEXT');
    } catch {
      // Column already exists, ignore
    }

    // Routing history table (Phase 4: Intelligent Task Router)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS routing_history (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        complexity TEXT NOT NULL,
        strategy TEXT NOT NULL,
        model TEXT NOT NULL,
        outcome TEXT,
        duration_ms INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_routing_history_task ON routing_history(task_id);
      CREATE INDEX IF NOT EXISTS idx_routing_history_complexity ON routing_history(complexity);
    `);

    // Agent memory tables (Phase 5: Persistent Memory)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_memory_content (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        tags TEXT,
        memory_type TEXT NOT NULL DEFAULT 'fact',
        relevance REAL DEFAULT 1.0,
        access_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        last_accessed TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_memory_agent ON agent_memory_content(agent_id);
      CREATE INDEX IF NOT EXISTS idx_agent_memory_type ON agent_memory_content(memory_type);
      CREATE INDEX IF NOT EXISTS idx_agent_memory_key ON agent_memory_content(key);
    `);

    // FTS5 virtual table for full-text search across agent memories
    // Standalone FTS5 table (not content-synced) for simplicity
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS agent_memory_fts USING fts5(
          memory_id, agent_id, key, value, tags, memory_type
        );
      `);
    } catch {
      // FTS5 may not be available in all SQLite builds
      console.warn('[STORAGE] FTS5 not available — agent memory search will use LIKE fallback');
    }
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        uid TEXT PRIMARY KEY,
        handle TEXT NOT NULL,
        team_name TEXT NOT NULL,
        agent_type TEXT DEFAULT 'worker',
        created_at TEXT NOT NULL,
        last_seen TEXT
      );

      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        participants TEXT NOT NULL,
        is_team_chat INTEGER DEFAULT 0,
        team_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        from_handle TEXT NOT NULL,
        from_uid TEXT NOT NULL,
        text TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        metadata TEXT,
        FOREIGN KEY (chat_id) REFERENCES chats(id)
      );

      CREATE TABLE IF NOT EXISTS unread (
        chat_id TEXT NOT NULL,
        uid TEXT NOT NULL,
        count INTEGER DEFAULT 0,
        PRIMARY KEY (chat_id, uid)
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        team_name TEXT NOT NULL,
        subject TEXT NOT NULL,
        description TEXT,
        owner_handle TEXT,
        owner_uid TEXT,
        created_by_handle TEXT NOT NULL,
        created_by_uid TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        blocked_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_users_team ON users(team_name);
      CREATE INDEX IF NOT EXISTS idx_tasks_team ON tasks(team_name);

      -- Workers table (Phase 1: Crash Recovery)
      CREATE TABLE IF NOT EXISTS workers (
        id TEXT PRIMARY KEY,
        handle TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'pending',
        worktree_path TEXT,
        worktree_branch TEXT,
        pid INTEGER,
        session_id TEXT,
        initial_prompt TEXT,
        last_heartbeat INTEGER,
        restart_count INTEGER DEFAULT 0,
        role TEXT DEFAULT 'worker',
        swarm_id TEXT,
        depth_level INTEGER DEFAULT 1,
        spawn_mode TEXT DEFAULT 'process',
        pane_id TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        dismissed_at INTEGER
      );

      -- Add spawn_mode and pane_id columns if they don't exist (migration for existing databases)
      -- SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we use a try-catch pattern in code

      CREATE INDEX IF NOT EXISTS idx_workers_handle ON workers(handle);
      CREATE INDEX IF NOT EXISTS idx_workers_status ON workers(status);

      -- Work Items table (Phase 2: Structured Work Tracking)
      CREATE TABLE IF NOT EXISTS work_items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'pending',
        assigned_to TEXT,
        batch_id TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (batch_id) REFERENCES batches(id)
      );

      CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(status);
      CREATE INDEX IF NOT EXISTS idx_work_items_assigned ON work_items(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_work_items_batch ON work_items(batch_id);

      -- Batches table (Phase 2: Bundled Work)
      CREATE TABLE IF NOT EXISTS batches (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);

      -- Work Item Events table (Phase 2: Event History)
      CREATE TABLE IF NOT EXISTS work_item_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_item_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        actor TEXT,
        details TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (work_item_id) REFERENCES work_items(id)
      );

      CREATE INDEX IF NOT EXISTS idx_work_item_events_item ON work_item_events(work_item_id);

      -- Mailbox table (Phase 3: Persistent Communication)
      CREATE TABLE IF NOT EXISTS mailbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_handle TEXT NOT NULL,
        to_handle TEXT NOT NULL,
        subject TEXT,
        body TEXT NOT NULL,
        read_at INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_mailbox_to ON mailbox(to_handle);
      CREATE INDEX IF NOT EXISTS idx_mailbox_unread ON mailbox(to_handle, read_at);

      -- Handoffs table (Phase 3: Context Transfer)
      CREATE TABLE IF NOT EXISTS handoffs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_handle TEXT NOT NULL,
        to_handle TEXT NOT NULL,
        context TEXT NOT NULL,
        checkpoint TEXT,
        status TEXT DEFAULT 'pending',
        outcome TEXT,
        accepted_at INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_handoffs_to ON handoffs(to_handle);
      CREATE INDEX IF NOT EXISTS idx_handoffs_pending ON handoffs(to_handle, accepted_at);
      CREATE INDEX IF NOT EXISTS idx_handoffs_status ON handoffs(status);

      -- Fleet Coordination Tables (Phase 4)

      -- Blackboard table for inter-agent messaging
      CREATE TABLE IF NOT EXISTS blackboard (
        id TEXT PRIMARY KEY,
        swarm_id TEXT NOT NULL,
        sender_handle TEXT NOT NULL,
        message_type TEXT NOT NULL CHECK (message_type IN ('request', 'response', 'status', 'directive', 'checkpoint')),
        target_handle TEXT,
        priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
        payload TEXT NOT NULL,
        read_by TEXT DEFAULT '[]',
        created_at INTEGER NOT NULL,
        archived_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_blackboard_swarm ON blackboard(swarm_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_blackboard_target ON blackboard(target_handle);
      CREATE INDEX IF NOT EXISTS idx_blackboard_priority ON blackboard(priority);
      CREATE INDEX IF NOT EXISTS idx_blackboard_unarchived ON blackboard(swarm_id, archived_at);

      -- Spawn queue for managed agent spawning with DAG dependencies
      CREATE TABLE IF NOT EXISTS spawn_queue (
        id TEXT PRIMARY KEY,
        requester_handle TEXT NOT NULL,
        target_agent_type TEXT NOT NULL,
        depth_level INTEGER NOT NULL DEFAULT 1,
        swarm_id TEXT,
        priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'spawned')),
        payload TEXT NOT NULL,
        depends_on TEXT DEFAULT '[]',
        blocked_by_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        processed_at INTEGER,
        spawned_worker_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_spawn_queue_status ON spawn_queue(status, priority, created_at);
      CREATE INDEX IF NOT EXISTS idx_spawn_queue_ready ON spawn_queue(status, blocked_by_count);
      CREATE INDEX IF NOT EXISTS idx_spawn_queue_requester ON spawn_queue(requester_handle);
      CREATE INDEX IF NOT EXISTS idx_spawn_queue_swarm ON spawn_queue(swarm_id);

      -- Workflow Tables (Phase 5)

      -- Workflow definitions (templates/recipes)
      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        version INTEGER DEFAULT 1,
        definition TEXT NOT NULL,
        is_template INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_workflows_name ON workflows(name);
      CREATE INDEX IF NOT EXISTS idx_workflows_template ON workflows(is_template);

      -- Workflow executions (instances of a workflow)
      CREATE TABLE IF NOT EXISTS workflow_executions (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        swarm_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled')),
        context TEXT DEFAULT '{}',
        started_at INTEGER,
        completed_at INTEGER,
        error TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        created_by TEXT NOT NULL,
        FOREIGN KEY (workflow_id) REFERENCES workflows(id)
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow ON workflow_executions(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_executions_status ON workflow_executions(status);
      CREATE INDEX IF NOT EXISTS idx_workflow_executions_swarm ON workflow_executions(swarm_id);

      -- Workflow steps (nodes in the DAG)
      CREATE TABLE IF NOT EXISTS workflow_steps (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        step_key TEXT NOT NULL,
        name TEXT,
        step_type TEXT NOT NULL
          CHECK (step_type IN ('task', 'spawn', 'checkpoint', 'gate', 'parallel', 'script')),
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'ready', 'running', 'completed', 'failed', 'skipped', 'blocked')),
        config TEXT NOT NULL,
        depends_on TEXT DEFAULT '[]',
        blocked_by_count INTEGER DEFAULT 0,
        output TEXT,
        assigned_to TEXT,
        started_at INTEGER,
        completed_at INTEGER,
        error TEXT,
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        FOREIGN KEY (execution_id) REFERENCES workflow_executions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_steps_execution ON workflow_steps(execution_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_steps_status ON workflow_steps(status, blocked_by_count);
      CREATE INDEX IF NOT EXISTS idx_workflow_steps_assigned ON workflow_steps(assigned_to);

      -- Workflow triggers (event-driven execution)
      CREATE TABLE IF NOT EXISTS workflow_triggers (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        trigger_type TEXT NOT NULL
          CHECK (trigger_type IN ('event', 'schedule', 'webhook', 'blackboard')),
        config TEXT NOT NULL,
        is_enabled INTEGER DEFAULT 1,
        last_fired_at INTEGER,
        fire_count INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        FOREIGN KEY (workflow_id) REFERENCES workflows(id)
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_triggers_workflow ON workflow_triggers(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_triggers_type ON workflow_triggers(trigger_type);
      CREATE INDEX IF NOT EXISTS idx_workflow_triggers_enabled ON workflow_triggers(is_enabled);

      -- Workflow events (audit log)
      CREATE TABLE IF NOT EXISTS workflow_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_id TEXT NOT NULL,
        step_id TEXT,
        event_type TEXT NOT NULL,
        actor TEXT,
        details TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        FOREIGN KEY (execution_id) REFERENCES workflow_executions(id),
        FOREIGN KEY (step_id) REFERENCES workflow_steps(id)
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_events_execution ON workflow_events(execution_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_events_step ON workflow_events(step_id);

      -- Swarms table (persistent swarm storage)
      CREATE TABLE IF NOT EXISTS swarms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        max_agents INTEGER DEFAULT 50,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_swarms_name ON swarms(name);

      -- Swarm templates table (reusable swarm configurations)
      CREATE TABLE IF NOT EXISTS swarm_templates (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        is_builtin INTEGER DEFAULT 0,
        phases TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_swarm_templates_name ON swarm_templates(name);
      CREATE INDEX IF NOT EXISTS idx_swarm_templates_builtin ON swarm_templates(is_builtin);

      -- ============================================================================
      -- SWARM INTELLIGENCE TABLES (Phase 6) - 2026 Research Features
      -- ============================================================================

      -- Pheromone trails for stigmergic coordination
      CREATE TABLE IF NOT EXISTS pheromone_trails (
        id TEXT PRIMARY KEY,
        swarm_id TEXT NOT NULL,
        resource_type TEXT NOT NULL CHECK (resource_type IN ('file', 'task', 'endpoint', 'module', 'custom')),
        resource_id TEXT NOT NULL,
        depositor_handle TEXT NOT NULL,
        trail_type TEXT NOT NULL CHECK (trail_type IN ('touch', 'modify', 'complete', 'error', 'warning', 'success')),
        intensity REAL NOT NULL DEFAULT 1.0 CHECK (intensity >= 0.0 AND intensity <= 1.0),
        metadata TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL,
        decayed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_pheromone_swarm_resource ON pheromone_trails(swarm_id, resource_type, resource_id);
      CREATE INDEX IF NOT EXISTS idx_pheromone_active ON pheromone_trails(swarm_id, decayed_at);
      CREATE INDEX IF NOT EXISTS idx_pheromone_depositor ON pheromone_trails(depositor_handle);
      CREATE INDEX IF NOT EXISTS idx_pheromone_intensity ON pheromone_trails(intensity);

      -- Agent belief states for theory of mind
      CREATE TABLE IF NOT EXISTS agent_beliefs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        swarm_id TEXT NOT NULL,
        agent_handle TEXT NOT NULL,
        belief_type TEXT NOT NULL CHECK (belief_type IN ('knowledge', 'assumption', 'inference', 'observation')),
        subject TEXT NOT NULL,
        belief_value TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0.0 AND confidence <= 1.0),
        source_handle TEXT,
        source_type TEXT CHECK (source_type IN ('direct', 'inferred', 'communicated', 'observed')),
        valid_until INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(swarm_id, agent_handle, subject)
      );

      CREATE INDEX IF NOT EXISTS idx_beliefs_agent ON agent_beliefs(swarm_id, agent_handle);
      CREATE INDEX IF NOT EXISTS idx_beliefs_subject ON agent_beliefs(subject);
      CREATE INDEX IF NOT EXISTS idx_beliefs_confidence ON agent_beliefs(confidence);

      -- Agent meta-beliefs (beliefs about other agents)
      CREATE TABLE IF NOT EXISTS agent_meta_beliefs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        swarm_id TEXT NOT NULL,
        agent_handle TEXT NOT NULL,
        about_handle TEXT NOT NULL,
        meta_type TEXT NOT NULL CHECK (meta_type IN ('capability', 'reliability', 'knowledge', 'intention', 'workload')),
        belief_value TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0.0 AND confidence <= 1.0),
        evidence_count INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(swarm_id, agent_handle, about_handle, meta_type)
      );

      CREATE INDEX IF NOT EXISTS idx_meta_beliefs_holder ON agent_meta_beliefs(swarm_id, agent_handle);
      CREATE INDEX IF NOT EXISTS idx_meta_beliefs_about ON agent_meta_beliefs(about_handle);

      -- Game-theoretic payoffs for tasks
      CREATE TABLE IF NOT EXISTS task_payoffs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        swarm_id TEXT,
        payoff_type TEXT NOT NULL CHECK (payoff_type IN ('completion', 'quality', 'speed', 'cooperation', 'penalty', 'bonus')),
        base_value REAL NOT NULL,
        multiplier REAL DEFAULT 1.0,
        deadline INTEGER,
        decay_rate REAL DEFAULT 0.0,
        dependencies TEXT DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(task_id, payoff_type)
      );

      CREATE INDEX IF NOT EXISTS idx_payoffs_task ON task_payoffs(task_id);
      CREATE INDEX IF NOT EXISTS idx_payoffs_swarm ON task_payoffs(swarm_id);

      -- Agent credits & reputation ledger
      CREATE TABLE IF NOT EXISTS agent_credits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        swarm_id TEXT NOT NULL,
        agent_handle TEXT NOT NULL,
        balance REAL NOT NULL DEFAULT 100.0,
        reputation_score REAL NOT NULL DEFAULT 0.5 CHECK (reputation_score >= 0.0 AND reputation_score <= 1.0),
        total_earned REAL DEFAULT 0.0,
        total_spent REAL DEFAULT 0.0,
        task_count INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(swarm_id, agent_handle)
      );

      CREATE INDEX IF NOT EXISTS idx_credits_agent ON agent_credits(swarm_id, agent_handle);
      CREATE INDEX IF NOT EXISTS idx_credits_reputation ON agent_credits(reputation_score DESC);

      -- Credit transactions (audit log)
      CREATE TABLE IF NOT EXISTS credit_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        swarm_id TEXT NOT NULL,
        agent_handle TEXT NOT NULL,
        transaction_type TEXT NOT NULL CHECK (transaction_type IN ('earn', 'spend', 'bonus', 'penalty', 'transfer', 'adjustment')),
        amount REAL NOT NULL,
        balance_after REAL NOT NULL,
        reference_type TEXT,
        reference_id TEXT,
        reason TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_transactions_agent ON credit_transactions(swarm_id, agent_handle, created_at);
      CREATE INDEX IF NOT EXISTS idx_transactions_reference ON credit_transactions(reference_type, reference_id);

      -- Consensus proposals for voting
      CREATE TABLE IF NOT EXISTS consensus_proposals (
        id TEXT PRIMARY KEY,
        swarm_id TEXT NOT NULL,
        proposer_handle TEXT NOT NULL,
        proposal_type TEXT NOT NULL CHECK (proposal_type IN ('decision', 'election', 'approval', 'ranking', 'allocation')),
        title TEXT NOT NULL,
        description TEXT,
        options TEXT NOT NULL,
        voting_method TEXT NOT NULL DEFAULT 'majority' CHECK (voting_method IN ('majority', 'supermajority', 'unanimous', 'ranked', 'weighted')),
        quorum_type TEXT DEFAULT 'percentage' CHECK (quorum_type IN ('percentage', 'absolute')),
        quorum_value REAL DEFAULT 0.5,
        weight_by_reputation INTEGER DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'passed', 'failed', 'cancelled')),
        deadline INTEGER,
        result TEXT,
        created_at INTEGER NOT NULL,
        closed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_proposals_swarm ON consensus_proposals(swarm_id, status);
      CREATE INDEX IF NOT EXISTS idx_proposals_proposer ON consensus_proposals(proposer_handle);

      -- Consensus votes
      CREATE TABLE IF NOT EXISTS consensus_votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proposal_id TEXT NOT NULL,
        voter_handle TEXT NOT NULL,
        vote_value TEXT NOT NULL,
        vote_weight REAL DEFAULT 1.0,
        rationale TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(proposal_id, voter_handle),
        FOREIGN KEY (proposal_id) REFERENCES consensus_proposals(id)
      );

      CREATE INDEX IF NOT EXISTS idx_votes_proposal ON consensus_votes(proposal_id);

      -- Task bids for market-based allocation
      CREATE TABLE IF NOT EXISTS task_bids (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        swarm_id TEXT NOT NULL,
        bidder_handle TEXT NOT NULL,
        bid_amount REAL NOT NULL,
        estimated_duration INTEGER,
        confidence REAL DEFAULT 0.5 CHECK (confidence >= 0.0 AND confidence <= 1.0),
        rationale TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn', 'expired')),
        created_at INTEGER NOT NULL,
        processed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_bids_task ON task_bids(task_id, status);
      CREATE INDEX IF NOT EXISTS idx_bids_bidder ON task_bids(bidder_handle);
      CREATE INDEX IF NOT EXISTS idx_bids_swarm ON task_bids(swarm_id);
    `);
  }

  private prepareStatements() {
    return {
      insertUser: this.db.prepare(`
        INSERT OR REPLACE INTO users (uid, handle, team_name, agent_type, created_at, last_seen)
        VALUES (?, ?, ?, ?, ?, ?)
      `),
      getUser: this.db.prepare('SELECT * FROM users WHERE uid = ?'),
      getUsersByTeam: this.db.prepare('SELECT * FROM users WHERE team_name = ?'),
      insertChat: this.db.prepare(`
        INSERT OR REPLACE INTO chats (id, participants, is_team_chat, team_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `),
      getChat: this.db.prepare('SELECT * FROM chats WHERE id = ?'),
      getChatsByUser: this.db.prepare('SELECT * FROM chats WHERE participants LIKE ?'),
      updateChatTime: this.db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?'),
      insertMessage: this.db.prepare(`
        INSERT INTO messages (id, chat_id, from_handle, from_uid, text, timestamp, status, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      getMessages: this.db.prepare(
        'SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp ASC LIMIT ?'
      ),
      getMessagesAfter: this.db.prepare(
        'SELECT * FROM messages WHERE chat_id = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT ?'
      ),
      getUnread: this.db.prepare('SELECT count FROM unread WHERE chat_id = ? AND uid = ?'),
      setUnread: this.db.prepare(
        'INSERT OR REPLACE INTO unread (chat_id, uid, count) VALUES (?, ?, ?)'
      ),
      incrementUnread: this.db.prepare(
        'INSERT INTO unread (chat_id, uid, count) VALUES (?, ?, 1) ON CONFLICT(chat_id, uid) DO UPDATE SET count = count + 1'
      ),
      clearUnread: this.db.prepare('UPDATE unread SET count = 0 WHERE chat_id = ? AND uid = ?'),
      insertTask: this.db.prepare(`
        INSERT INTO tasks (id, team_name, subject, description, owner_handle, owner_uid,
                           created_by_handle, created_by_uid, status, blocked_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      getTask: this.db.prepare('SELECT * FROM tasks WHERE id = ?'),
      getTasksByTeam: this.db.prepare(
        'SELECT * FROM tasks WHERE team_name = ? ORDER BY created_at DESC'
      ),
      updateTaskStatus: this.db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?'),
      updateTaskAssignment: this.db.prepare(
        'UPDATE tasks SET owner_handle = ?, blocked_by = ?, status = ?, updated_at = ? WHERE id = ?'
      ),

      // Workers (Phase 1)
      insertWorker: this.db.prepare(`
        INSERT INTO workers (id, handle, status, worktree_path, worktree_branch, pid, session_id,
                             initial_prompt, last_heartbeat, restart_count, role, swarm_id, depth_level,
                             spawn_mode, pane_id, created_at, dismissed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      getWorker: this.db.prepare('SELECT * FROM workers WHERE id = ?'),
      getWorkerByHandle: this.db.prepare('SELECT * FROM workers WHERE handle = ?'),
      getAllWorkers: this.db.prepare('SELECT * FROM workers ORDER BY created_at DESC'),
      getActiveWorkers: this.db.prepare(
        "SELECT * FROM workers WHERE status NOT IN ('dismissed', 'error') ORDER BY created_at DESC"
      ),
      updateWorkerStatus: this.db.prepare('UPDATE workers SET status = ? WHERE id = ?'),
      updateWorkerHeartbeat: this.db.prepare('UPDATE workers SET last_heartbeat = ? WHERE id = ?'),
      updateWorkerPid: this.db.prepare('UPDATE workers SET pid = ?, session_id = ? WHERE id = ?'),
      dismissWorker: this.db.prepare(
        'UPDATE workers SET status = ?, dismissed_at = ? WHERE id = ?'
      ),
      deleteWorkerByHandle: this.db.prepare('DELETE FROM workers WHERE handle = ?'),

      // Work Items (Phase 2)
      insertWorkItem: this.db.prepare(`
        INSERT INTO work_items (id, title, description, status, assigned_to, batch_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      getWorkItem: this.db.prepare('SELECT * FROM work_items WHERE id = ?'),
      getAllWorkItems: this.db.prepare('SELECT * FROM work_items ORDER BY created_at DESC'),
      getWorkItemsByBatch: this.db.prepare('SELECT * FROM work_items WHERE batch_id = ? ORDER BY created_at ASC'),
      getWorkItemsByAssignee: this.db.prepare('SELECT * FROM work_items WHERE assigned_to = ? ORDER BY created_at DESC'),
      updateWorkItemStatus: this.db.prepare('UPDATE work_items SET status = ? WHERE id = ?'),
      assignWorkItem: this.db.prepare('UPDATE work_items SET assigned_to = ?, status = ? WHERE id = ?'),

      // Batches (Phase 2)
      insertBatch: this.db.prepare(`
        INSERT INTO batches (id, name, status, created_at)
        VALUES (?, ?, ?, ?)
      `),
      getBatch: this.db.prepare('SELECT * FROM batches WHERE id = ?'),
      getAllBatches: this.db.prepare('SELECT * FROM batches ORDER BY created_at DESC'),
      updateBatchStatus: this.db.prepare('UPDATE batches SET status = ? WHERE id = ?'),

      // Work Item Events (Phase 2)
      insertWorkItemEvent: this.db.prepare(`
        INSERT INTO work_item_events (work_item_id, event_type, actor, details, created_at)
        VALUES (?, ?, ?, ?, ?)
      `),
      getWorkItemEvents: this.db.prepare('SELECT * FROM work_item_events WHERE work_item_id = ? ORDER BY created_at ASC'),

      // Mail (Phase 3)
      insertMail: this.db.prepare(`
        INSERT INTO mailbox (from_handle, to_handle, subject, body, read_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `),
      getMail: this.db.prepare('SELECT * FROM mailbox WHERE id = ?'),
      getUnreadMail: this.db.prepare(
        'SELECT * FROM mailbox WHERE to_handle = ? AND read_at IS NULL ORDER BY created_at ASC'
      ),
      getAllMailTo: this.db.prepare(
        'SELECT * FROM mailbox WHERE to_handle = ? ORDER BY created_at DESC LIMIT ?'
      ),
      markMailRead: this.db.prepare('UPDATE mailbox SET read_at = ? WHERE id = ?'),

      // Handoffs (Phase 3)
      insertHandoff: this.db.prepare(`
        INSERT INTO handoffs (from_handle, to_handle, context, accepted_at, created_at)
        VALUES (?, ?, ?, ?, ?)
      `),
      getHandoff: this.db.prepare('SELECT * FROM handoffs WHERE id = ?'),
      getPendingHandoffs: this.db.prepare(
        'SELECT * FROM handoffs WHERE to_handle = ? AND accepted_at IS NULL ORDER BY created_at ASC'
      ),
      acceptHandoff: this.db.prepare('UPDATE handoffs SET accepted_at = ? WHERE id = ?'),

      // Swarms
      insertSwarm: this.db.prepare(`
        INSERT INTO swarms (id, name, description, max_agents, created_at)
        VALUES (?, ?, ?, ?, ?)
      `),
      getSwarm: this.db.prepare('SELECT * FROM swarms WHERE id = ?'),
      getAllSwarms: this.db.prepare('SELECT * FROM swarms ORDER BY created_at DESC'),
      deleteSwarm: this.db.prepare('DELETE FROM swarms WHERE id = ?'),

      // Swarm Templates
      insertTemplate: this.db.prepare(`
        INSERT INTO swarm_templates (id, name, description, is_builtin, phases, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      getTemplate: this.db.prepare('SELECT * FROM swarm_templates WHERE id = ?'),
      getTemplateByName: this.db.prepare('SELECT * FROM swarm_templates WHERE name = ?'),
      getAllTemplates: this.db.prepare('SELECT * FROM swarm_templates ORDER BY created_at DESC'),
      getBuiltinTemplates: this.db.prepare(
        'SELECT * FROM swarm_templates WHERE is_builtin = 1 ORDER BY name'
      ),
      getUserTemplates: this.db.prepare(
        'SELECT * FROM swarm_templates WHERE is_builtin = 0 ORDER BY created_at DESC'
      ),
      updateTemplate: this.db.prepare(`
        UPDATE swarm_templates SET name = ?, description = ?, phases = ?, updated_at = ?
        WHERE id = ? AND is_builtin = 0
      `),
      deleteTemplate: this.db.prepare('DELETE FROM swarm_templates WHERE id = ? AND is_builtin = 0'),

      // Routing History (Phase 4)
      insertRoutingHistory: this.db.prepare(`
        INSERT INTO routing_history (id, task_id, complexity, strategy, model, outcome, duration_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      getRoutingHistory: this.db.prepare(
        'SELECT * FROM routing_history WHERE task_id = ? ORDER BY created_at DESC'
      ),
      getRoutingHistoryByComplexity: this.db.prepare(
        'SELECT * FROM routing_history WHERE complexity = ? ORDER BY created_at DESC LIMIT ?'
      ),

      // Agent Memory (Phase 5)
      insertAgentMemory: this.db.prepare(`
        INSERT INTO agent_memory_content (id, agent_id, key, value, tags, memory_type, relevance, access_count, created_at, last_accessed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      getAgentMemory: this.db.prepare('SELECT * FROM agent_memory_content WHERE id = ?'),
      getAgentMemoriesByAgent: this.db.prepare(
        'SELECT * FROM agent_memory_content WHERE agent_id = ? ORDER BY relevance DESC, last_accessed DESC LIMIT ?'
      ),
      getAgentMemoryByKey: this.db.prepare(
        'SELECT * FROM agent_memory_content WHERE agent_id = ? AND key = ?'
      ),
      updateAgentMemoryAccess: this.db.prepare(
        'UPDATE agent_memory_content SET access_count = access_count + 1, last_accessed = ? WHERE id = ?'
      ),
      updateAgentMemoryRelevance: this.db.prepare(
        'UPDATE agent_memory_content SET relevance = ? WHERE id = ?'
      ),
      deleteAgentMemory: this.db.prepare('DELETE FROM agent_memory_content WHERE id = ?'),
    };
  }

  // ============================================================================
  // Users/Agents
  // ============================================================================

  insertUser(user: TeamAgent): void {
    this.stmts.insertUser.run(
      user.uid,
      user.handle,
      user.teamName,
      user.agentType,
      user.createdAt,
      user.lastSeen
    );
  }

  getUser(uid: string): TeamAgent | null {
    const row = this.stmts.getUser.get(uid) as {
      uid: string;
      handle: string;
      team_name: string;
      agent_type: string;
      created_at: string;
      last_seen: string | null;
    } | undefined;

    if (!row) return null;

    return {
      uid: row.uid,
      handle: row.handle,
      teamName: row.team_name,
      agentType: row.agent_type as 'team-lead' | 'worker',
      createdAt: row.created_at,
      lastSeen: row.last_seen,
    };
  }

  getUsersByTeam(teamName: string): TeamAgent[] {
    const rows = this.stmts.getUsersByTeam.all(teamName) as Array<{
      uid: string;
      handle: string;
      team_name: string;
      agent_type: string;
      created_at: string;
      last_seen: string | null;
    }>;

    return rows.map((row) => ({
      uid: row.uid,
      handle: row.handle,
      teamName: row.team_name,
      agentType: row.agent_type as 'team-lead' | 'worker',
      createdAt: row.created_at,
      lastSeen: row.last_seen,
    }));
  }

  // ============================================================================
  // Chats
  // ============================================================================

  insertChat(chat: Chat): void {
    this.stmts.insertChat.run(
      chat.id,
      JSON.stringify(chat.participants),
      chat.isTeamChat ? 1 : 0,
      chat.teamName,
      chat.createdAt,
      chat.updatedAt
    );
  }

  getChat(chatId: string): Chat | null {
    const row = this.stmts.getChat.get(chatId) as {
      id: string;
      participants: string;
      is_team_chat: number;
      team_name: string | null;
      created_at: string;
      updated_at: string;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      participants: JSON.parse(row.participants) as string[],
      isTeamChat: row.is_team_chat === 1,
      teamName: row.team_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getChatsByUser(uid: string): Chat[] {
    const rows = this.stmts.getChatsByUser.all(`%${uid}%`) as Array<{
      id: string;
      participants: string;
      is_team_chat: number;
      team_name: string | null;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      participants: JSON.parse(row.participants) as string[],
      isTeamChat: row.is_team_chat === 1,
      teamName: row.team_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  updateChatTime(chatId: string, timestamp: string): void {
    this.stmts.updateChatTime.run(timestamp, chatId);
  }

  // ============================================================================
  // Messages
  // ============================================================================

  insertMessage(message: Message): void {
    this.stmts.insertMessage.run(
      message.id,
      message.chatId,
      message.fromHandle,
      message.fromUid,
      message.text,
      message.timestamp,
      message.status,
      JSON.stringify(message.metadata)
    );
  }

  getMessages(chatId: string, limit: number): Message[] {
    const rows = this.stmts.getMessages.all(chatId, limit) as Array<{
      id: string;
      chat_id: string;
      from_handle: string;
      from_uid: string;
      text: string;
      timestamp: string;
      status: string;
      metadata: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      fromHandle: row.from_handle,
      fromUid: row.from_uid,
      text: row.text,
      timestamp: row.timestamp,
      status: row.status as 'pending' | 'processed',
      metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {},
    }));
  }

  getMessagesAfter(chatId: string, afterTimestamp: string, limit: number): Message[] {
    const rows = this.stmts.getMessagesAfter.all(chatId, afterTimestamp, limit) as Array<{
      id: string;
      chat_id: string;
      from_handle: string;
      from_uid: string;
      text: string;
      timestamp: string;
      status: string;
      metadata: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      fromHandle: row.from_handle,
      fromUid: row.from_uid,
      text: row.text,
      timestamp: row.timestamp,
      status: row.status as 'pending' | 'processed',
      metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {},
    }));
  }

  // ============================================================================
  // Unread counts
  // ============================================================================

  getUnread(chatId: string, uid: string): number {
    const row = this.stmts.getUnread.get(chatId, uid) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  setUnread(chatId: string, uid: string, count: number): void {
    this.stmts.setUnread.run(chatId, uid, count);
  }

  incrementUnread(chatId: string, uid: string): void {
    this.stmts.incrementUnread.run(chatId, uid);
  }

  clearUnread(chatId: string, uid: string): void {
    this.stmts.clearUnread.run(chatId, uid);
  }

  // ============================================================================
  // Tasks
  // ============================================================================

  insertTask(task: TeamTask): void {
    this.stmts.insertTask.run(
      task.id,
      task.teamName,
      task.subject,
      task.description,
      task.ownerHandle,
      task.ownerUid,
      task.createdByHandle,
      task.createdByUid,
      task.status,
      JSON.stringify(task.blockedBy),
      task.createdAt,
      task.updatedAt
    );
  }

  getTask(taskId: string): TeamTask | null {
    const row = this.stmts.getTask.get(taskId) as {
      id: string;
      team_name: string;
      subject: string;
      description: string | null;
      owner_handle: string | null;
      owner_uid: string | null;
      created_by_handle: string;
      created_by_uid: string;
      status: string;
      blocked_by: string | null;
      created_at: string;
      updated_at: string;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      teamName: row.team_name,
      subject: row.subject,
      description: row.description,
      ownerHandle: row.owner_handle,
      ownerUid: row.owner_uid,
      createdByHandle: row.created_by_handle,
      createdByUid: row.created_by_uid,
      status: row.status as TaskStatus,
      blockedBy: row.blocked_by ? (JSON.parse(row.blocked_by) as string[]) : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getTasksByTeam(teamName: string): TeamTask[] {
    const rows = this.stmts.getTasksByTeam.all(teamName) as Array<{
      id: string;
      team_name: string;
      subject: string;
      description: string | null;
      owner_handle: string | null;
      owner_uid: string | null;
      created_by_handle: string;
      created_by_uid: string;
      status: string;
      blocked_by: string | null;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      teamName: row.team_name,
      subject: row.subject,
      description: row.description,
      ownerHandle: row.owner_handle,
      ownerUid: row.owner_uid,
      createdByHandle: row.created_by_handle,
      createdByUid: row.created_by_uid,
      status: row.status as TaskStatus,
      blockedBy: row.blocked_by ? (JSON.parse(row.blocked_by) as string[]) : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  updateTaskStatus(taskId: string, status: TaskStatus, updatedAt: string): void {
    this.stmts.updateTaskStatus.run(status, updatedAt, taskId);
  }

  updateTaskAssignment(
    taskId: string,
    ownerHandle: string | null,
    blockedBy: string[],
    status: TaskStatus,
    updatedAt: string
  ): void {
    this.stmts.updateTaskAssignment.run(
      ownerHandle,
      JSON.stringify(blockedBy),
      status,
      updatedAt,
      taskId
    );
  }

  // ============================================================================
  // Workers (Phase 1)
  // ============================================================================

  insertWorker(worker: PersistentWorker): void {
    this.stmts.insertWorker.run(
      worker.id,
      worker.handle,
      worker.status,
      worker.worktreePath,
      worker.worktreeBranch,
      worker.pid,
      worker.sessionId,
      worker.initialPrompt,
      worker.lastHeartbeat,
      worker.restartCount,
      worker.role,
      worker.swarmId,
      worker.depthLevel,
      worker.spawnMode,
      worker.paneId,
      worker.createdAt,
      worker.dismissedAt
    );
  }

  private mapWorkerRow(row: {
    id: string;
    handle: string;
    status: string;
    worktree_path: string | null;
    worktree_branch: string | null;
    pid: number | null;
    session_id: string | null;
    initial_prompt: string | null;
    last_heartbeat: number | null;
    restart_count: number;
    role: string;
    swarm_id: string | null;
    depth_level: number;
    spawn_mode: string | null;
    pane_id: string | null;
    created_at: number;
    dismissed_at: number | null;
  }): PersistentWorker {
    return {
      id: row.id,
      handle: row.handle,
      status: row.status as WorkerStatus,
      worktreePath: row.worktree_path,
      worktreeBranch: row.worktree_branch,
      pid: row.pid,
      sessionId: row.session_id,
      initialPrompt: row.initial_prompt,
      lastHeartbeat: row.last_heartbeat,
      restartCount: row.restart_count,
      role: row.role as AgentRole,
      swarmId: row.swarm_id,
      depthLevel: row.depth_level,
      spawnMode: (row.spawn_mode as SpawnMode) ?? 'process',
      paneId: row.pane_id,
      createdAt: row.created_at,
      dismissedAt: row.dismissed_at,
    };
  }

  getWorker(workerId: string): PersistentWorker | null {
    const row = this.stmts.getWorker.get(workerId) as {
      id: string;
      handle: string;
      status: string;
      worktree_path: string | null;
      worktree_branch: string | null;
      pid: number | null;
      session_id: string | null;
      initial_prompt: string | null;
      last_heartbeat: number | null;
      restart_count: number;
      role: string;
      swarm_id: string | null;
      depth_level: number;
      spawn_mode: string | null;
      pane_id: string | null;
      created_at: number;
      dismissed_at: number | null;
    } | undefined;

    if (!row) return null;
    return this.mapWorkerRow(row);
  }

  getWorkerByHandle(handle: string): PersistentWorker | null {
    const row = this.stmts.getWorkerByHandle.get(handle) as {
      id: string;
      handle: string;
      status: string;
      worktree_path: string | null;
      worktree_branch: string | null;
      pid: number | null;
      session_id: string | null;
      initial_prompt: string | null;
      last_heartbeat: number | null;
      restart_count: number;
      role: string;
      swarm_id: string | null;
      depth_level: number;
      spawn_mode: string | null;
      pane_id: string | null;
      created_at: number;
      dismissed_at: number | null;
    } | undefined;

    if (!row) return null;
    return this.mapWorkerRow(row);
  }

  getAllWorkers(): PersistentWorker[] {
    const rows = this.stmts.getAllWorkers.all() as Array<{
      id: string;
      handle: string;
      status: string;
      worktree_path: string | null;
      worktree_branch: string | null;
      pid: number | null;
      session_id: string | null;
      initial_prompt: string | null;
      last_heartbeat: number | null;
      restart_count: number;
      role: string;
      swarm_id: string | null;
      depth_level: number;
      spawn_mode: string | null;
      pane_id: string | null;
      created_at: number;
      dismissed_at: number | null;
    }>;

    return rows.map((row) => this.mapWorkerRow(row));
  }

  getActiveWorkers(): PersistentWorker[] {
    const rows = this.stmts.getActiveWorkers.all() as Array<{
      id: string;
      handle: string;
      status: string;
      worktree_path: string | null;
      worktree_branch: string | null;
      pid: number | null;
      session_id: string | null;
      initial_prompt: string | null;
      last_heartbeat: number | null;
      restart_count: number;
      role: string;
      swarm_id: string | null;
      depth_level: number;
      spawn_mode: string | null;
      pane_id: string | null;
      created_at: number;
      dismissed_at: number | null;
    }>;

    return rows.map((row) => this.mapWorkerRow(row));
  }

  updateWorkerStatus(workerId: string, status: WorkerStatus): void {
    this.stmts.updateWorkerStatus.run(status, workerId);
  }

  updateWorkerHeartbeat(workerId: string, timestamp: number): void {
    this.stmts.updateWorkerHeartbeat.run(timestamp, workerId);
  }

  updateWorkerPid(workerId: string, pid: number, sessionId: string | null): void {
    this.stmts.updateWorkerPid.run(pid, sessionId, workerId);
  }

  dismissWorker(workerId: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.stmts.dismissWorker.run('dismissed', now, workerId);
  }

  deleteWorkerByHandle(handle: string): void {
    this.stmts.deleteWorkerByHandle.run(handle);
  }

  // ============================================================================
  // Work Items (Phase 2)
  // ============================================================================

  insertWorkItem(workItem: WorkItem): void {
    this.stmts.insertWorkItem.run(
      workItem.id,
      workItem.title,
      workItem.description,
      workItem.status,
      workItem.assignedTo,
      workItem.batchId,
      workItem.createdAt
    );
  }

  private mapWorkItemRow(row: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    assigned_to: string | null;
    batch_id: string | null;
    created_at: number;
  }): WorkItem {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status as WorkItemStatus,
      assignedTo: row.assigned_to,
      batchId: row.batch_id,
      createdAt: row.created_at,
    };
  }

  getWorkItem(workItemId: string): WorkItem | null {
    const row = this.stmts.getWorkItem.get(workItemId) as {
      id: string;
      title: string;
      description: string | null;
      status: string;
      assigned_to: string | null;
      batch_id: string | null;
      created_at: number;
    } | undefined;

    if (!row) return null;
    return this.mapWorkItemRow(row);
  }

  getAllWorkItems(): WorkItem[] {
    const rows = this.stmts.getAllWorkItems.all() as Array<{
      id: string;
      title: string;
      description: string | null;
      status: string;
      assigned_to: string | null;
      batch_id: string | null;
      created_at: number;
    }>;

    return rows.map((row) => this.mapWorkItemRow(row));
  }

  getWorkItemsByBatch(batchId: string): WorkItem[] {
    const rows = this.stmts.getWorkItemsByBatch.all(batchId) as Array<{
      id: string;
      title: string;
      description: string | null;
      status: string;
      assigned_to: string | null;
      batch_id: string | null;
      created_at: number;
    }>;

    return rows.map((row) => this.mapWorkItemRow(row));
  }

  getWorkItemsByAssignee(handle: string): WorkItem[] {
    const rows = this.stmts.getWorkItemsByAssignee.all(handle) as Array<{
      id: string;
      title: string;
      description: string | null;
      status: string;
      assigned_to: string | null;
      batch_id: string | null;
      created_at: number;
    }>;

    return rows.map((row) => this.mapWorkItemRow(row));
  }

  updateWorkItemStatus(workItemId: string, status: WorkItemStatus): void {
    this.stmts.updateWorkItemStatus.run(status, workItemId);
  }

  assignWorkItem(workItemId: string, handle: string): void {
    this.stmts.assignWorkItem.run(handle, 'in_progress', workItemId);
  }

  // ============================================================================
  // Batches (Phase 2)
  // ============================================================================

  insertBatch(batch: Batch): void {
    this.stmts.insertBatch.run(
      batch.id,
      batch.name,
      batch.status,
      batch.createdAt
    );
  }

  private mapBatchRow(row: {
    id: string;
    name: string;
    status: string;
    created_at: number;
  }): Batch {
    return {
      id: row.id,
      name: row.name,
      status: row.status as BatchStatus,
      createdAt: row.created_at,
    };
  }

  getBatch(batchId: string): Batch | null {
    const row = this.stmts.getBatch.get(batchId) as {
      id: string;
      name: string;
      status: string;
      created_at: number;
    } | undefined;

    if (!row) return null;
    return this.mapBatchRow(row);
  }

  getAllBatches(): Batch[] {
    const rows = this.stmts.getAllBatches.all() as Array<{
      id: string;
      name: string;
      status: string;
      created_at: number;
    }>;

    return rows.map((row) => this.mapBatchRow(row));
  }

  updateBatchStatus(batchId: string, status: BatchStatus): void {
    this.stmts.updateBatchStatus.run(status, batchId);
  }

  // ============================================================================
  // Work Item Events (Phase 2)
  // ============================================================================

  insertWorkItemEvent(event: Omit<WorkItemEvent, 'id'>): number {
    const result = this.stmts.insertWorkItemEvent.run(
      event.workItemId,
      event.eventType,
      event.actor,
      event.details,
      event.createdAt
    );
    return result.lastInsertRowid as number;
  }

  getWorkItemEvents(workItemId: string): WorkItemEvent[] {
    const rows = this.stmts.getWorkItemEvents.all(workItemId) as Array<{
      id: number;
      work_item_id: string;
      event_type: string;
      actor: string | null;
      details: string | null;
      created_at: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      workItemId: row.work_item_id,
      eventType: row.event_type as WorkItemEventType,
      actor: row.actor,
      details: row.details,
      createdAt: row.created_at,
    }));
  }

  // ============================================================================
  // Mail (Phase 3)
  // ============================================================================

  insertMail(mail: Omit<MailMessage, 'id'>): number {
    const result = this.stmts.insertMail.run(
      mail.fromHandle,
      mail.toHandle,
      mail.subject,
      mail.body,
      mail.readAt,
      mail.createdAt
    );
    return result.lastInsertRowid as number;
  }

  private mapMailRow(row: {
    id: number;
    from_handle: string;
    to_handle: string;
    subject: string | null;
    body: string;
    read_at: number | null;
    created_at: number;
  }): MailMessage {
    return {
      id: row.id,
      fromHandle: row.from_handle,
      toHandle: row.to_handle,
      subject: row.subject,
      body: row.body,
      readAt: row.read_at,
      createdAt: row.created_at,
    };
  }

  getMail(mailId: number): MailMessage | null {
    const row = this.stmts.getMail.get(mailId) as {
      id: number;
      from_handle: string;
      to_handle: string;
      subject: string | null;
      body: string;
      read_at: number | null;
      created_at: number;
    } | undefined;

    if (!row) return null;
    return this.mapMailRow(row);
  }

  getUnreadMail(handle: string): MailMessage[] {
    const rows = this.stmts.getUnreadMail.all(handle) as Array<{
      id: number;
      from_handle: string;
      to_handle: string;
      subject: string | null;
      body: string;
      read_at: number | null;
      created_at: number;
    }>;

    return rows.map((row) => this.mapMailRow(row));
  }

  getAllMailTo(handle: string, limit: number = 50): MailMessage[] {
    const rows = this.stmts.getAllMailTo.all(handle, limit) as Array<{
      id: number;
      from_handle: string;
      to_handle: string;
      subject: string | null;
      body: string;
      read_at: number | null;
      created_at: number;
    }>;

    return rows.map((row) => this.mapMailRow(row));
  }

  markMailRead(mailId: number): void {
    const now = Math.floor(Date.now() / 1000);
    this.stmts.markMailRead.run(now, mailId);
  }

  // ============================================================================
  // Handoffs (Phase 3)
  // ============================================================================

  insertHandoff(handoff: Omit<Handoff, 'id'>): number {
    const result = this.stmts.insertHandoff.run(
      handoff.fromHandle,
      handoff.toHandle,
      JSON.stringify(handoff.context),
      handoff.acceptedAt,
      handoff.createdAt
    );
    return result.lastInsertRowid as number;
  }

  private mapHandoffRow(row: {
    id: number;
    from_handle: string;
    to_handle: string;
    context: string;
    accepted_at: number | null;
    created_at: number;
  }): Handoff {
    return {
      id: row.id,
      fromHandle: row.from_handle,
      toHandle: row.to_handle,
      context: JSON.parse(row.context) as Record<string, unknown>,
      acceptedAt: row.accepted_at,
      createdAt: row.created_at,
    };
  }

  getHandoff(handoffId: number): Handoff | null {
    const row = this.stmts.getHandoff.get(handoffId) as {
      id: number;
      from_handle: string;
      to_handle: string;
      context: string;
      accepted_at: number | null;
      created_at: number;
    } | undefined;

    if (!row) return null;
    return this.mapHandoffRow(row);
  }

  getPendingHandoffs(handle: string): Handoff[] {
    const rows = this.stmts.getPendingHandoffs.all(handle) as Array<{
      id: number;
      from_handle: string;
      to_handle: string;
      context: string;
      accepted_at: number | null;
      created_at: number;
    }>;

    return rows.map((row) => this.mapHandoffRow(row));
  }

  acceptHandoff(handoffId: number): void {
    const now = Math.floor(Date.now() / 1000);
    this.stmts.acceptHandoff.run(now, handoffId);
  }

  // ============================================================================
  // Swarms
  // ============================================================================

  insertSwarm(swarm: { id: string; name: string; description?: string; maxAgents?: number }): void {
    this.stmts.insertSwarm.run(
      swarm.id,
      swarm.name,
      swarm.description || null,
      swarm.maxAgents ?? 50,
      Date.now()
    );
  }

  getSwarm(swarmId: string): { id: string; name: string; description: string | null; maxAgents: number; createdAt: number } | null {
    const row = this.stmts.getSwarm.get(swarmId) as {
      id: string;
      name: string;
      description: string | null;
      max_agents: number;
      created_at: number;
    } | undefined;

    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      maxAgents: row.max_agents,
      createdAt: row.created_at,
    };
  }

  getAllSwarms(): Array<{ id: string; name: string; description: string | null; maxAgents: number; createdAt: number }> {
    const rows = this.stmts.getAllSwarms.all() as Array<{
      id: string;
      name: string;
      description: string | null;
      max_agents: number;
      created_at: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      maxAgents: row.max_agents,
      createdAt: row.created_at,
    }));
  }

  deleteSwarm(swarmId: string): void {
    this.stmts.deleteSwarm.run(swarmId);
  }

  // ============================================================================
  // Swarm Templates
  // ============================================================================

  private mapTemplateRow(row: {
    id: string;
    name: string;
    description: string | null;
    is_builtin: number;
    phases: string;
    created_at: number;
    updated_at: number;
  }): SwarmTemplate {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      isBuiltin: row.is_builtin === 1,
      phases: JSON.parse(row.phases) as SwarmTemplate['phases'],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  insertTemplate(template: SwarmTemplate): void {
    this.stmts.insertTemplate.run(
      template.id,
      template.name,
      template.description,
      template.isBuiltin ? 1 : 0,
      JSON.stringify(template.phases),
      template.createdAt,
      template.updatedAt
    );
  }

  getTemplate(id: string): SwarmTemplate | null {
    const row = this.stmts.getTemplate.get(id) as {
      id: string;
      name: string;
      description: string | null;
      is_builtin: number;
      phases: string;
      created_at: number;
      updated_at: number;
    } | undefined;

    if (!row) return null;
    return this.mapTemplateRow(row);
  }

  getTemplateByName(name: string): SwarmTemplate | null {
    const row = this.stmts.getTemplateByName.get(name) as {
      id: string;
      name: string;
      description: string | null;
      is_builtin: number;
      phases: string;
      created_at: number;
      updated_at: number;
    } | undefined;

    if (!row) return null;
    return this.mapTemplateRow(row);
  }

  getAllTemplates(options?: { builtin?: boolean; limit?: number }): SwarmTemplate[] {
    let rows: Array<{
      id: string;
      name: string;
      description: string | null;
      is_builtin: number;
      phases: string;
      created_at: number;
      updated_at: number;
    }>;

    if (options?.builtin === true) {
      rows = this.stmts.getBuiltinTemplates.all() as typeof rows;
    } else if (options?.builtin === false) {
      rows = this.stmts.getUserTemplates.all() as typeof rows;
    } else {
      rows = this.stmts.getAllTemplates.all() as typeof rows;
    }

    if (options?.limit) {
      rows = rows.slice(0, options.limit);
    }

    return rows.map((row) => this.mapTemplateRow(row));
  }

  updateTemplate(
    id: string,
    updates: Partial<Pick<SwarmTemplate, 'name' | 'description' | 'phases'>>
  ): SwarmTemplate | null {
    const existing = this.getTemplate(id);
    if (!existing || existing.isBuiltin) return null;

    const updated: SwarmTemplate = {
      ...existing,
      name: updates.name ?? existing.name,
      description: updates.description !== undefined ? updates.description : existing.description,
      phases: updates.phases ?? existing.phases,
      updatedAt: Date.now(),
    };

    const result = this.stmts.updateTemplate.run(
      updated.name,
      updated.description,
      JSON.stringify(updated.phases),
      updated.updatedAt,
      id
    );

    if (result.changes === 0) return null;
    return updated;
  }

  deleteTemplate(id: string): boolean {
    const template = this.getTemplate(id);
    if (!template || template.isBuiltin) return false;

    const result = this.stmts.deleteTemplate.run(id);
    return result.changes > 0;
  }

  seedBuiltinTemplates(): void {
    const templates: SwarmTemplate[] = [
      {
        id: 'builtin-feature-dev',
        name: 'feature-development',
        description: 'Standard feature development with discovery through delivery',
        isBuiltin: true,
        phases: {
          discovery: ['product-analyst', 'architect'],
          development: ['backend-dev', 'frontend-dev'],
          quality: ['qa-engineer', 'security-engineer'],
          delivery: ['tech-writer'],
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: 'builtin-backend-api',
        name: 'backend-api',
        description: 'Backend API development focused',
        isBuiltin: true,
        phases: {
          discovery: ['architect'],
          development: ['backend-dev', 'data-engineer'],
          quality: ['qa-engineer', 'performance-engineer'],
          delivery: ['devops-engineer'],
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: 'builtin-quick-fix',
        name: 'quick-fix',
        description: 'Fast bug fix with minimal overhead',
        isBuiltin: true,
        phases: {
          discovery: [],
          development: ['fullstack-dev'],
          quality: ['qa-engineer'],
          delivery: [],
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    for (const template of templates) {
      const existing = this.getTemplate(template.id);
      if (!existing) {
        this.insertTemplate(template);
      }
    }
  }

  // ============================================================================
  // Debug
  // ============================================================================

  getDebugInfo() {
    const users = this.db.prepare('SELECT * FROM users').all() as Array<{
      uid: string;
      handle: string;
      team_name: string;
      agent_type: string;
      created_at: string;
      last_seen: string | null;
    }>;

    const chats = this.db.prepare('SELECT * FROM chats').all() as Array<{
      id: string;
      participants: string;
      is_team_chat: number;
      team_name: string | null;
      created_at: string;
      updated_at: string;
    }>;

    const messageCount = this.db.prepare('SELECT COUNT(*) as count FROM messages').get() as {
      count: number;
    };

    const tasks = this.db.prepare('SELECT * FROM tasks').all() as Array<{
      id: string;
      team_name: string;
      subject: string;
      description: string | null;
      owner_handle: string | null;
      owner_uid: string | null;
      created_by_handle: string;
      created_by_uid: string;
      status: string;
      blocked_by: string | null;
      created_at: string;
      updated_at: string;
    }>;

    return {
      users: users.map((u) => ({
        uid: u.uid,
        handle: u.handle,
        teamName: u.team_name,
        agentType: u.agent_type as 'team-lead' | 'worker',
        createdAt: u.created_at,
        lastSeen: u.last_seen,
      })),
      chats: chats.map((c) => ({
        id: c.id,
        participants: JSON.parse(c.participants) as string[],
        isTeamChat: c.is_team_chat === 1,
        teamName: c.team_name,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      })),
      messageCount: messageCount.count,
      tasks: tasks.map((t) => ({
        id: t.id,
        teamName: t.team_name,
        subject: t.subject,
        description: t.description,
        ownerHandle: t.owner_handle,
        ownerUid: t.owner_uid,
        createdByHandle: t.created_by_handle,
        createdByUid: t.created_by_uid,
        status: t.status as TaskStatus,
        blockedBy: t.blocked_by ? (JSON.parse(t.blocked_by) as string[]) : [],
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      })),
    };
  }

  // ============================================================================
  // Routing History (Phase 4)
  // ============================================================================

  insertRoutingHistory(entry: {
    id: string;
    taskId: string | null;
    complexity: string;
    strategy: string;
    model: string;
    outcome: string | null;
    durationMs: number | null;
    createdAt: string;
  }): void {
    this.stmts.insertRoutingHistory.run(
      entry.id, entry.taskId, entry.complexity,
      entry.strategy, entry.model, entry.outcome,
      entry.durationMs, entry.createdAt
    );
  }

  getRoutingHistoryByTask(taskId: string): Array<{
    id: string;
    task_id: string;
    complexity: string;
    strategy: string;
    model: string;
    outcome: string | null;
    duration_ms: number | null;
    created_at: string;
  }> {
    return this.stmts.getRoutingHistory.all(taskId) as Array<{
      id: string;
      task_id: string;
      complexity: string;
      strategy: string;
      model: string;
      outcome: string | null;
      duration_ms: number | null;
      created_at: string;
    }>;
  }

  getRoutingHistoryByComplexity(complexity: string, limit = 50): Array<{
    id: string;
    task_id: string;
    complexity: string;
    strategy: string;
    model: string;
    outcome: string | null;
    duration_ms: number | null;
    created_at: string;
  }> {
    return this.stmts.getRoutingHistoryByComplexity.all(complexity, limit) as Array<{
      id: string;
      task_id: string;
      complexity: string;
      strategy: string;
      model: string;
      outcome: string | null;
      duration_ms: number | null;
      created_at: string;
    }>;
  }

  // ============================================================================
  // Agent Memory (Phase 5)
  // ============================================================================

  insertAgentMemory(memory: {
    id: string;
    agentId: string;
    key: string;
    value: string;
    tags: string | null;
    memoryType: string;
    relevance: number;
    accessCount: number;
    createdAt: string;
    lastAccessed: string;
  }): void {
    this.stmts.insertAgentMemory.run(
      memory.id, memory.agentId, memory.key, memory.value,
      memory.tags, memory.memoryType, memory.relevance,
      memory.accessCount, memory.createdAt, memory.lastAccessed
    );

    // Sync to FTS5 index
    try {
      this.db.exec(`
        INSERT INTO agent_memory_fts (memory_id, agent_id, key, value, tags, memory_type)
        VALUES ('${memory.id.replace(/'/g, "''")}', '${memory.agentId.replace(/'/g, "''")}',
                '${memory.key.replace(/'/g, "''")}', '${memory.value.replace(/'/g, "''")}',
                '${(memory.tags ?? '').replace(/'/g, "''")}', '${memory.memoryType.replace(/'/g, "''")}')
      `);
    } catch {
      // FTS5 not available, skip
    }
  }

  getAgentMemory(memoryId: string): {
    id: string;
    agent_id: string;
    key: string;
    value: string;
    tags: string | null;
    memory_type: string;
    relevance: number;
    access_count: number;
    created_at: string;
    last_accessed: string;
  } | undefined {
    return this.stmts.getAgentMemory.get(memoryId) as {
      id: string;
      agent_id: string;
      key: string;
      value: string;
      tags: string | null;
      memory_type: string;
      relevance: number;
      access_count: number;
      created_at: string;
      last_accessed: string;
    } | undefined;
  }

  getAgentMemoriesByAgent(agentId: string, limit = 50): Array<{
    id: string;
    agent_id: string;
    key: string;
    value: string;
    tags: string | null;
    memory_type: string;
    relevance: number;
    access_count: number;
    created_at: string;
    last_accessed: string;
  }> {
    return this.stmts.getAgentMemoriesByAgent.all(agentId, limit) as Array<{
      id: string;
      agent_id: string;
      key: string;
      value: string;
      tags: string | null;
      memory_type: string;
      relevance: number;
      access_count: number;
      created_at: string;
      last_accessed: string;
    }>;
  }

  getAgentMemoryByKey(agentId: string, key: string): {
    id: string;
    agent_id: string;
    key: string;
    value: string;
    tags: string | null;
    memory_type: string;
    relevance: number;
    access_count: number;
    created_at: string;
    last_accessed: string;
  } | undefined {
    return this.stmts.getAgentMemoryByKey.get(agentId, key) as {
      id: string;
      agent_id: string;
      key: string;
      value: string;
      tags: string | null;
      memory_type: string;
      relevance: number;
      access_count: number;
      created_at: string;
      last_accessed: string;
    } | undefined;
  }

  updateAgentMemoryAccess(memoryId: string): void {
    this.stmts.updateAgentMemoryAccess.run(new Date().toISOString(), memoryId);
  }

  updateAgentMemoryRelevance(memoryId: string, relevance: number): void {
    this.stmts.updateAgentMemoryRelevance.run(relevance, memoryId);
  }

  deleteAgentMemory(memoryId: string): void {
    // Remove from FTS5 first
    try {
      this.db.exec(`
        DELETE FROM agent_memory_fts WHERE memory_id = '${memoryId.replace(/'/g, "''")}'
      `);
    } catch {
      // FTS5 not available
    }
    this.stmts.deleteAgentMemory.run(memoryId);
  }

  /**
   * Full-text search across agent memories using FTS5.
   * Falls back to LIKE query if FTS5 is not available.
   */
  searchAgentMemory(agentId: string, query: string, limit = 20): Array<{
    id: string;
    agent_id: string;
    key: string;
    value: string;
    tags: string | null;
    memory_type: string;
    relevance: number;
    access_count: number;
    created_at: string;
    last_accessed: string;
  }> {
    try {
      // Try FTS5 search first
      return this.db.prepare(`
        SELECT c.*
        FROM agent_memory_fts f
        JOIN agent_memory_content c ON f.memory_id = c.id
        WHERE agent_memory_fts MATCH ? AND c.agent_id = ?
        ORDER BY rank
        LIMIT ?
      `).all(query, agentId, limit) as Array<{
        id: string;
        agent_id: string;
        key: string;
        value: string;
        tags: string | null;
        memory_type: string;
        relevance: number;
        access_count: number;
        created_at: string;
        last_accessed: string;
      }>;
    } catch {
      // FTS5 not available — fall back to LIKE
      const likeQuery = `%${query}%`;
      return this.db.prepare(`
        SELECT * FROM agent_memory_content
        WHERE agent_id = ? AND (key LIKE ? OR value LIKE ? OR tags LIKE ?)
        ORDER BY relevance DESC, last_accessed DESC
        LIMIT ?
      `).all(agentId, likeQuery, likeQuery, likeQuery, limit) as Array<{
        id: string;
        agent_id: string;
        key: string;
        value: string;
        tags: string | null;
        memory_type: string;
        relevance: number;
        access_count: number;
        created_at: string;
        last_accessed: string;
      }>;
    }
  }

  // ============================================================================
  // Database Access
  // ============================================================================

  /**
   * Get the underlying database instance for advanced operations
   */
  getDatabase(): Database.Database {
    return this.db;
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  close(): void {
    this.db.close();
  }
}
