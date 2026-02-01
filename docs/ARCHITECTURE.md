# Architecture

Claude Fleet v3.0 - Enterprise-ready multi-agent orchestration for Claude Code.

## Overview

Claude Fleet is a TypeScript server that enables team collaboration, task management, and worker orchestration across multiple Claude Code instances. It provides:

- **REST API**: Express-based HTTP API for all coordination operations
- **WebSocket**: Real-time notifications for messages, tasks, and worker events
- **Worker Orchestration**: Spawn and control Claude Code instances programmatically
- **MCP Integration**: 98 tools accessible via Model Context Protocol
- **Persistent Storage**: SQLite with optional PostgreSQL, DynamoDB, Firestore, S3 backends
- **Swarm Intelligence**: Pheromone trails, belief consensus, credit auctions, governance
- **Knowledge & RAG**: FTS5-powered knowledge base with chunked ingestion and recency scoring
- **Policy & Safety**: Regex-based operation guardrails with block/ask/allow decisions
- **Session Lineage**: Worker context trim/continue chains with token accounting
- **Autonomous Ops**: Cron scheduling, webhook triggers, priority queues with retry

```
                           Architecture Overview
+------------------------------------------------------------------------+
|                           Your Machine                                  |
+------------------------------------------------------------------------+
|                                                                         |
|  +----------------+    +----------------+    +----------------+         |
|  |  Claude Code   |    |  Claude Code   |    |  Claude Code   |        |
|  |  (Team Lead)   |    |  (Worker 1)    |    |  (Worker N)    |        |
|  +-------+--------+    +-------+--------+    +-------+--------+        |
|          |                     |                     |                  |
|          |     NDJSON Stream   |                     |                  |
|          +---------------------+---------------------+                  |
|                                |                                        |
|                                v                                        |
|           +--------------------------------------------+                |
|           |     CollabServer (TypeScript v2.0)         |               |
|           |                                            |               |
|           |  +-------------+    +------------------+   |               |
|           |  | Express API |    | WebSocket Server |   |               |
|           |  +------+------+    +--------+---------+   |               |
|           |         |                    |             |               |
|           |         v                    v             |               |
|           |  +-------------+    +------------------+   |               |
|           |  | WorkerMgr   |    | MCP Bridge       |   |               |
|           |  +------+------+    +--------+---------+   |               |
|           |         |                    |             |               |
|           +--------------------------------------------+                |
|                     |                                                   |
|                     v                                                   |
|           +--------------------------------------------+                |
|           |            SQLite Database                 |               |
|           |  +--------+ +--------+ +--------+          |               |
|           |  | Users  | | Tasks  | | Workers|          |               |
|           |  +--------+ +--------+ +--------+          |               |
|           |  +--------+ +--------+ +--------+          |               |
|           |  | Chats  | | Mail   | | Batches|          |               |
|           |  +--------+ +--------+ +--------+          |               |
|           +--------------------------------------------+                |
|                                                                         |
|  Default: http://localhost:3847                                        |
+------------------------------------------------------------------------+
```

## Components

### 1. CollabServer (`src/server.ts`)

The main server class that orchestrates all components.

**Responsibilities:**
- HTTP REST API (Express)
- WebSocket real-time notifications
- Rate limiting (100 requests/minute per IP)
- JWT authentication
- Request validation (Zod schemas)
- Static file serving (dashboard)
- Graceful shutdown handling

**Key Methods:**
- `start()` - Initialize and start the server
- `stop()` - Graceful shutdown
- `setupRoutes()` - Register all API endpoints
- `setupWebSocket()` - Configure WebSocket handlers
- `broadcastToChat()` / `broadcastToAll()` - Push notifications

### 2. WorkerManager (`src/workers/manager.ts`)

Manages Claude Code worker process lifecycle.

**Responsibilities:**
- Spawn Claude Code instances as child processes
- NDJSON streaming for bidirectional communication
- Health monitoring with auto-restart (up to 3 attempts)
- Session management for crash recovery
- Worktree integration for isolated git branches

**Worker States:**
```
starting -> ready -> working -> stopping -> stopped
                  ^         |
                  +---------+
```

**Health Monitoring:**
- Heartbeat interval: 10 seconds
- Health check interval: 15 seconds
- Degraded threshold: 30 seconds without activity
- Unhealthy threshold: 60 seconds without activity

**Events Emitted:**
- `worker:ready` - Worker initialized with session ID
- `worker:output` - NDJSON event from worker
- `worker:result` - Task completion
- `worker:error` - Error from worker
- `worker:exit` - Worker process terminated
- `worker:unhealthy` - Health check failed
- `worker:restart` - Worker auto-restarted

### 3. SQLiteStorage (`src/storage/sqlite.ts`)

Persistence layer using better-sqlite3.

**Database Tables:**

| Table | Purpose |
|-------|---------|
| `users` | Agent registration and metadata |
| `chats` | Conversation threads |
| `messages` | Message history |
| `unread` | Unread counts per user per chat |
| `tasks` | Task delegation and tracking |
| `workers` | Persistent worker state (crash recovery) |
| `work_items` | Structured work tracking |
| `batches` | Bundled work items |
| `work_item_events` | Event history audit log |
| `mailbox` | Persistent inter-agent messaging |
| `handoffs` | Context transfer between workers |

**Configuration:**
- WAL mode enabled for better concurrency
- Prepared statements for performance
- Foreign key relationships enforced

### 4. MCP Server (`src/mcp/server.ts`)

Model Context Protocol bridge exposing coordination tools.

**Tool Categories (98 tools):**

| Category | Count | Tools |
|----------|-------|-------|
| Team Management | 11 | `team_status`, `team_broadcast`, `team_tasks`, `team_assign`, `team_complete`, `team_claim`, `team_spawn`, `team_dismiss`, `team_workers`, `team_send`, `team_handoff` |
| Work Items & Batches | 5 | `workitem_create`, `workitem_update`, `workitem_list`, `batch_create`, `batch_dispatch` |
| Communication | 6 | `mail_send`, `mail_read`, `blackboard_post`, `blackboard_read`, `blackboard_mark_read`, `blackboard_archive` |
| Git Integration | 3 | `worktree_commit`, `worktree_push`, `worktree_pr` |
| Checkpoints | 3 | `checkpoint_create`, `checkpoint_load`, `checkpoint_list` |
| Swarm Intelligence | 10 | `swarm_create`, `swarm_list`, `swarm_kill`, `swarm_broadcast`, `pheromone_deposit`, `pheromone_query`, `pheromone_hot_resources`, `belief_set`, `belief_get`, `belief_consensus` |
| Governance & Auctions | 15 | `proposal_create/list/vote/close`, `bid_submit/list/accept/withdraw`, `auction_run`, `payoff_define/calculate`, `credits_transfer/balance/history/leaderboard` |
| TLDR Summaries | 6 | `tldr_get_summary`, `tldr_store_summary`, `tldr_get_codebase`, `tldr_store_codebase`, `tldr_dependency_graph`, `tldr_stats` |
| Spawn Management | 3 | `spawn_request`, `spawn_status`, `spawn_cancel` |
| Templates & Audit | 8 | `template_list/get/run`, `audit_status/output/start/stop/quick` |
| Workflows & Executions | 11 | `workflow_list/get/start`, `execution_list/get/steps/pause/resume/cancel`, `step_complete/retry` |

**Permission System:**
- Role-based access control (RBAC)
- Roles: `coordinator`, `worker`, `monitor`, `notifier`, `merger`
- Permissions checked before tool execution

### 5. Supporting Modules

**WorkItemStorage (`src/storage/workitems.ts`)**
- Human-readable IDs (e.g., `wi-x7k2m`)
- Status tracking with event history
- Batch management

**MailStorage (`src/storage/mail.ts`)**
- Persistent messaging between workers
- Read/unread tracking
- Handoff context transfer
- Mail injection on worker spawn

**WorktreeManager (`src/workers/worktree.ts`)**
- Git worktree creation per worker
- Isolated branches for parallel development
- Commit, push, and PR operations

**Prometheus Metrics (`src/metrics/prometheus.ts`)**
- HTTP request metrics
- Worker health gauges
- Task completion counters

## Data Flow

### Agent Registration Flow

```
Claude Code                   CollabServer              SQLite
    |                              |                       |
    |-- POST /auth --------------->|                       |
    |   {handle, teamName,         |                       |
    |    agentType}                |                       |
    |                              |-- insertUser -------->|
    |                              |                       |
    |                              |<-- OK ---------------|
    |<-- {uid, token} -------------|                       |
```

### Worker Spawn Flow

```
Team Lead          CollabServer         WorkerManager        Claude Code
    |                   |                     |                    |
    |-- POST spawn ---->|                     |                    |
    |                   |-- spawnWorker ----->|                    |
    |                   |                     |-- spawn process -->|
    |                   |                     |                    |
    |                   |                     |<-- init event -----|
    |                   |<-- worker ready ----|                    |
    |<-- {id, handle} --|                     |                    |
```

### Task Assignment Flow

```
Lead Agent         CollabServer              SQLite              Worker Agent
    |                   |                       |                     |
    |-- POST /tasks --->|                       |                     |
    |                   |-- insertTask -------->|                     |
    |                   |-- insertMessage ----->|                     |
    |                   |                       |                     |
    |                   |-- WebSocket notify ---|-------------------->|
    |<-- task created --|                       |                     |
```

### Message Broadcast Flow

```
Agent A          CollabServer              SQLite            Agents B, C, D
    |                 |                       |                    |
    |-- broadcast --->|                       |                    |
    |                 |-- store message ----->|                    |
    |                 |                       |                    |
    |                 |----------- WebSocket push --------------->|
    |<-- OK ---------|                       |                    |
```

## API Reference

### Authentication

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/auth` | POST | Register/authenticate agent | No |

### Teams

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/teams/:name/agents` | GET | List team members | Yes |
| `/teams/:name/tasks` | GET | List team tasks | Yes |
| `/teams/:name/broadcast` | POST | Broadcast to team | Yes (lead) |

### Tasks

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/tasks` | POST | Create task | Yes |
| `/tasks/:id` | GET | Get task details | Yes |
| `/tasks/:id` | PATCH | Update task status | Yes |

### Worker Orchestration

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/orchestrate/spawn` | POST | Spawn worker | Yes (lead) |
| `/orchestrate/workers` | GET | List workers | Yes |
| `/orchestrate/send/:handle` | POST | Send message to worker | Yes |
| `/orchestrate/output/:handle` | GET | Get worker output | Yes |
| `/orchestrate/dismiss/:handle` | POST | Dismiss worker | Yes (lead) |

### Worktree Operations

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/orchestrate/worktree/:handle/commit` | POST | Commit changes | Yes |
| `/orchestrate/worktree/:handle/push` | POST | Push to remote | Yes (lead) |
| `/orchestrate/worktree/:handle/pr` | POST | Create pull request | Yes (lead) |
| `/orchestrate/worktree/:handle/status` | GET | Get worktree status | Yes |

### Work Items & Batches

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/workitems` | POST | Create work item | Yes |
| `/workitems` | GET | List work items | Yes |
| `/workitems/:id` | GET | Get work item | Yes |
| `/workitems/:id` | PATCH | Update work item | Yes |
| `/batches` | POST | Create batch | Yes |
| `/batches` | GET | List batches | Yes |
| `/batches/:id/dispatch` | POST | Dispatch batch to worker | Yes (lead) |

### Mail & Handoffs

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/mail` | POST | Send mail | Yes |
| `/mail/:handle` | GET | Get all mail | Yes |
| `/mail/:handle/unread` | GET | Get unread mail | Yes |
| `/handoffs` | POST | Create handoff | Yes |
| `/handoffs/:handle` | GET | Get pending handoffs | Yes |

### Monitoring

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/health` | GET | Server health + stats | No |
| `/metrics` | GET | Prometheus metrics | No |
| `/metrics/json` | GET | JSON metrics | Yes |
| `/debug` | GET | Debug information | Yes (lead) |

### Swarm Intelligence

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/swarms` | POST | Create swarm | Yes (lead) |
| `/swarms` | GET | List swarms | Yes |
| `/swarms/:id` | DELETE | Kill swarm | Yes (lead) |
| `/pheromones` | POST | Deposit pheromone trail | Yes |
| `/pheromones/query` | POST | Query trails | Yes |
| `/pheromones/hot` | GET | Hot resources | Yes |
| `/beliefs` | POST | Set belief | Yes |
| `/beliefs/:swarmId/:handle` | GET | Get beliefs | Yes |
| `/beliefs/:swarmId/consensus` | GET | Consensus query | Yes |

### Knowledge & RAG

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/knowledge/ingest` | POST | Ingest document | Yes |
| `/knowledge/search` | POST | FTS5 search | Yes |
| `/knowledge/sources` | GET | List sources | Yes |

### Policy & Safety (Phase 8)

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/policies` | POST/GET | Create/list rules | Yes |
| `/policies/:id` | GET/PATCH/DELETE | Get/update/delete rule | Yes |
| `/policies/evaluate` | POST | Evaluate operation | Yes |
| `/policies/violations` | GET | List violations | Yes (lead) |
| `/policies/stats` | GET | Policy stats | Yes |

### Session Lineage (Phase 8)

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/sessions` | POST | Create session | Yes |
| `/sessions/:id` | GET | Get session | Yes |
| `/sessions/worker/:handle` | GET | Worker sessions | Yes |
| `/sessions/:id/trim` | POST | Trim session | Yes |
| `/sessions/:id/continue` | POST | Continue session | Yes |
| `/sessions/:id/lineage` | GET | Full lineage chain | Yes |
| `/sessions/search` | POST | Search session content | Yes |

### Workflows & Executions

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/workflows` | POST/GET | Create/list workflows | Yes |
| `/workflows/:id` | GET/PATCH/DELETE | Get/update/delete | Yes |
| `/workflows/:id/start` | POST | Start execution | Yes |
| `/executions` | GET | List executions | Yes |
| `/executions/:id` | GET | Get execution | Yes |
| `/executions/:id/pause` | POST | Pause execution | Yes |
| `/executions/:id/resume` | POST | Resume execution | Yes |
| `/executions/:id/cancel` | POST | Cancel execution | Yes |

## Types

### Core Types

```typescript
// Agent identification
type AgentType = 'team-lead' | 'worker';
type AgentRole = 'coordinator' | 'worker' | 'monitor' | 'notifier' | 'merger';

// Task lifecycle
type TaskStatus = 'open' | 'in_progress' | 'resolved' | 'blocked';

// Worker lifecycle
type WorkerState = 'starting' | 'ready' | 'working' | 'stopping' | 'stopped';
type WorkerHealth = 'healthy' | 'degraded' | 'unhealthy';

// Work item lifecycle
type WorkItemStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';
type BatchStatus = 'open' | 'dispatched' | 'completed' | 'cancelled';
```

### Key Interfaces

```typescript
interface TeamAgent {
  uid: string;           // Unique ID (hash of teamName:handle)
  handle: string;        // Human-readable name
  teamName: string;      // Team identifier
  agentType: AgentType;  // Role in team
  createdAt: string;
  lastSeen: string | null;
}

interface WorkerProcess {
  id: string;
  handle: string;
  teamName: string;
  process: ChildProcess;
  sessionId: string | null;  // For session resumption
  workingDir: string;
  state: WorkerState;
  recentOutput: string[];
  lastHeartbeat: number;
  restartCount: number;
  health: 'healthy' | 'degraded' | 'unhealthy';
}

interface TeamTask {
  id: string;
  teamName: string;
  subject: string;
  description: string | null;
  ownerHandle: string | null;
  ownerUid: string | null;
  status: TaskStatus;
  blockedBy: string[];      // Task dependency graph
  createdAt: string;
  updatedAt: string;
}

interface WorkItem {
  id: string;               // e.g., 'wi-x7k2m'
  title: string;
  description: string | null;
  status: WorkItemStatus;
  assignedTo: string | null;
  batchId: string | null;
  createdAt: number;
}
```

### Configuration

```typescript
interface ServerConfig {
  port: number;              // Default: 3847
  dbPath: string;            // SQLite database path
  jwtSecret: string;         // JWT signing secret
  jwtExpiresIn: string;      // Default: '24h'
  maxWorkers: number;        // Default: 5
  rateLimitWindow: number;   // Default: 60000 (1 minute)
  rateLimitMax: number;      // Default: 100 requests
}
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3847` |
| `DB_PATH` | SQLite database path | `./fleet.db` |
| `JWT_SECRET` | JWT signing secret | Auto-generated |
| `JWT_EXPIRES_IN` | Token expiration | `24h` |
| `MAX_WORKERS` | Maximum concurrent workers | `5` |
| `CLAUDE_CODE_TEAM_NAME` | Team identifier | `dev-team` |
| `CLAUDE_CODE_AGENT_TYPE` | Agent role | `worker` |
| `CLAUDE_CODE_AGENT_NAME` | Agent display name | - |
| `CLAUDE_FLEET_URL` | Server URL for MCP | `http://localhost:3847` |
| `LOG_LEVEL` | Logging verbosity | `info` |

## Swarm Intelligence Features

Claude Fleet includes advanced swarm intelligence capabilities for multi-agent coordination:

### Pheromone System (Stigmergic Coordination)
Agents leave trails on resources they interact with, enabling indirect coordination:
- **Trail Types**: touch, modify, complete, error, warning, success
- **Resource Types**: file, function, module, endpoint, test, config
- **Decay**: Trails fade over time, keeping data fresh
- **Hot Resources**: Query most active resources across the swarm

### Belief System (Theory of Mind)
Agents share knowledge and track beliefs about each other:
- **Belief Types**: knowledge, assumption, inference, observation
- **Confidence Scores**: 0-1 scale with evidence tracking
- **Meta-Beliefs**: Beliefs about other agents' capabilities/reliability
- **Consensus**: Query swarm-wide agreement on subjects

### Credit System (Reputation)
Track agent contributions and build reputation:
- **Credits**: Earned for task completion, spent on resource access
- **Reputation**: Rolling score based on task quality
- **Leaderboard**: Rank agents by contributions
- **Transfers**: Agents can transfer credits to each other

### Consensus (Voting)
Make swarm-level decisions through proposals:
- **Proposals**: Create issues for swarm voting
- **Weighted Votes**: Vote weight based on reputation
- **Automatic Close**: Proposals close by deadline or threshold

### Task Bidding (Market Allocation)
Agents bid for tasks based on capability:
- **Auctions**: First-price, second-price, or Vickrey auctions
- **Evaluation**: Score bids by amount, duration, reputation
- **Payoffs**: Define completion bonuses with decay rates

---

## Rust Native Acceleration

Claude Fleet v3.0 includes an optional Rust acceleration layer via NAPI-RS. All Rust crates have JS fallback implementations, so native binaries are never required.

### Crate Architecture

```
crates/
├── compound/    # Ring-buffer accumulator for time-series metrics
├── search/      # Tantivy-based full-text search engine
├── lmsh/        # Natural language → shell command translator
├── logstream/   # High-performance log streaming and filtering
├── dag/         # Directed acyclic graph operations (topo sort, critical path)
├── swarm/       # Swarm coordination primitives (pheromone decay, consensus)
├── metrics/     # Native Prometheus metrics engine
└── ringbus/     # Lock-free ring buffer message bus
```

### How Fallback Works

Each TypeScript wrapper attempts to load the native module at startup:

```typescript
try {
  const native = require('@claude-fleet/search');
  // Use native implementation
} catch {
  // Fall back to JS implementation
}
```

This means:
- `npm install` works everywhere (native binaries are optional)
- CI/CD environments without Rust still run all tests
- Performance-sensitive hot paths benefit from native speed when available

### Building Native Modules

```bash
# Build all Rust crates
cargo build --workspace --release

# Run Rust tests
cargo test --workspace
```

---

## See Also

- [Documentation Index](README.md) - Full documentation overview
- [README](../README.md) - Quick start and usage
- [DEPLOYMENT](DEPLOYMENT.md) - Production deployment guide
- [TMUX-AUTOMATION](TMUX-AUTOMATION.md) - Tmux integration for worker panes
- [NATIVE-INTEGRATION](NATIVE-INTEGRATION.md) - Claude Code native features integration
- [FEATURE-FLAGS](FEATURE-FLAGS.md) - Environment variables and configuration
- [CONTRIBUTING](../CONTRIBUTING.md) - Development guidelines
