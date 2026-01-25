# Architecture

Claude Code Collab v2.0 - Enterprise-ready multi-agent orchestration for Claude Code.

## Overview

Claude Code Collab is a TypeScript server that enables team collaboration, task management, and worker orchestration across multiple Claude Code instances. It provides:

- **REST API**: Express-based HTTP API for all coordination operations
- **WebSocket**: Real-time notifications for messages, tasks, and worker events
- **Worker Orchestration**: Spawn and control Claude Code instances programmatically
- **MCP Integration**: 25+ tools accessible via Model Context Protocol
- **Persistent Storage**: SQLite database for durable state

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

**Tool Categories:**

| Category | Tools | Description |
|----------|-------|-------------|
| Team Status | `team_status`, `team_broadcast` | Team health and communication |
| Tasks | `team_tasks`, `team_assign`, `team_complete` | Task management |
| Files | `team_claim` | File conflict prevention |
| Workers | `team_spawn`, `team_dismiss`, `team_workers`, `team_send` | Worker orchestration |
| Work Items | `workitem_create`, `workitem_update`, `workitem_list` | Structured work tracking |
| Batches | `batch_create`, `batch_dispatch` | Bundled work distribution |
| Mail | `mail_send`, `mail_read` | Persistent messaging |
| Handoffs | `team_handoff` | Context transfer |
| Worktree | `worktree_commit`, `worktree_push`, `worktree_pr` | Git operations |

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
| `/metrics/json` | GET | JSON metrics | No |
| `/debug` | GET | Debug information | No |

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
| `DB_PATH` | SQLite database path | `./collab.db` |
| `JWT_SECRET` | JWT signing secret | Auto-generated |
| `JWT_EXPIRES_IN` | Token expiration | `24h` |
| `MAX_WORKERS` | Maximum concurrent workers | `5` |
| `CLAUDE_CODE_TEAM_NAME` | Team identifier | `dev-team` |
| `CLAUDE_CODE_AGENT_TYPE` | Agent role | `worker` |
| `CLAUDE_CODE_AGENT_NAME` | Agent display name | - |
| `COLLAB_SERVER_URL` | Server URL for MCP | `http://localhost:3847` |
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

## See Also

- [README.md](README.md) - Quick start and usage
- [DEPLOYMENT.md](DEPLOYMENT.md) - Production deployment guide
- [TMUX-AUTOMATION.md](TMUX-AUTOMATION.md) - Tmux integration for worker panes
- [CONTRIBUTING.md](CONTRIBUTING.md) - Development guidelines
