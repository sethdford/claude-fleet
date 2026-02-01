# Feature Flags & Configuration Reference

Complete reference for all environment variables, config options, and tuning constants
in Claude Fleet, mapped to the capabilities they control.

## Table of Contents

- [Environment Variables](#environment-variables)
  - [Server Core](#server-core)
  - [Authentication](#authentication)
  - [Storage Backends](#storage-backends)
  - [Worker Orchestration](#worker-orchestration)
  - [Native Integration](#native-integration)
  - [External Integrations](#external-integrations)
- [Internal Config Structs](#internal-config-structs)
  - [ServerConfig](#serverconfig)
  - [WorkerManagerOptions](#workermanageroptions)
  - [SpawnControllerOptions](#spawncontrolleroptions)
  - [NativeBridgeConfig](#nativebridgeconfig)
  - [TaskSyncConfig](#tasksyncconfig)
  - [InboxBridgeConfig](#inboxbridgeconfig)
- [Hardcoded Constants](#hardcoded-constants)
  - [Worker Health Thresholds](#worker-health-thresholds)
  - [Spawn Controller Limits](#spawn-controller-limits)
  - [Compound Runner Timeouts](#compound-runner-timeouts)
  - [Workflow Engine](#workflow-engine)
  - [Miscellaneous](#miscellaneous)
- [Spawn Modes](#spawn-modes)
- [Capability Matrix](#capability-matrix)

---

## Environment Variables

### Server Core

| Variable | Default | Maps To | Capability |
|----------|---------|---------|------------|
| `PORT` | `3847` | `ServerConfig.port` | HTTP/WebSocket server listen port |
| `NODE_ENV` | — | (checked inline) | `production` suppresses stack traces in error responses and debug output |
| `CORS_ORIGINS` | `http://localhost:3847` | `ServerConfig.corsOrigins` | Comma-separated allowed origins for CORS headers |
| `CLAUDE_FLEET_URL` | `http://localhost:3847` | CLI + MCP server | Base URL the CLI and MCP server use to reach the Fleet API |

### Authentication

| Variable | Default | Maps To | Capability |
|----------|---------|---------|------------|
| `JWT_SECRET` | random 32-byte hex | `ServerConfig.jwtSecret` | Signing key for JWT tokens. **Must be set in production** — random default means tokens invalidate on restart |
| `JWT_EXPIRES_IN` | `24h` | `ServerConfig.jwtExpiresIn` | Token TTL. Accepts `ms`-compatible strings (`1h`, `7d`, `30m`) |
| `FLEET_TOKEN` | — | CLI auth cache | Pre-shared token the CLI uses to skip interactive auth |

### Storage Backends

`STORAGE_BACKEND` selects which storage adapter to initialize. Each backend has its own
env vars. Only one backend is active at a time.

| Variable | Default | Capability |
|----------|---------|------------|
| `STORAGE_BACKEND` | `sqlite` | Backend selector: `sqlite` \| `dynamodb` \| `s3` \| `firestore` \| `postgresql` |

**SQLite** (default):

| Variable | Default | Capability |
|----------|---------|------------|
| `DB_PATH` | `./fleet.db` | SQLite database file path. Created on first run with WAL mode |

**DynamoDB**:

| Variable | Default | Capability |
|----------|---------|------------|
| `AWS_REGION` | `us-east-1` | AWS region for DynamoDB |
| `DYNAMODB_TABLE_PREFIX` | `fleet_` | Prefix for all DynamoDB table names |
| `DYNAMODB_ENDPOINT` | — | Custom DynamoDB endpoint (for LocalStack / local dev) |

**S3**:

| Variable | Default | Capability |
|----------|---------|------------|
| `S3_BUCKET` | `claude-fleet` | S3 bucket name |
| `AWS_REGION` | `us-east-1` | AWS region for S3 |
| `S3_PREFIX` | `data/` | Key prefix for all stored objects |
| `S3_ENDPOINT` | — | Custom S3 endpoint (for MinIO / local dev) |

**Firestore**:

| Variable | Default | Capability |
|----------|---------|------------|
| `GOOGLE_CLOUD_PROJECT` | — | GCP project ID (fallback: `FIRESTORE_PROJECT_ID`) |
| `FIRESTORE_PROJECT_ID` | — | Alternate project ID env var |
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Path to GCP service account JSON |

**PostgreSQL**:

| Variable | Default | Capability |
|----------|---------|------------|
| `DATABASE_URL` | — | Connection string (fallback: `POSTGRESQL_URL`) |
| `POSTGRESQL_URL` | — | Alternate connection string env var |
| `POSTGRESQL_SCHEMA` | `public` | Schema to use for all tables |
| `POSTGRESQL_POOL_SIZE` | `10` | Connection pool size |

### Worker Orchestration

| Variable | Default | Maps To | Capability |
|----------|---------|---------|------------|
| `MAX_WORKERS` | `5` | `ServerConfig.maxWorkers` | Maximum concurrent workers the server will manage |
| `FLEET_NATIVE_ONLY` | `false` | `ServerConfig.nativeOnly` | When `true`, rejects `process` spawn mode and enforces native/tmux only. Enables full native integration layer |

### Native Integration

These variables are set *by* the native bridge when spawning agents, or can be set
manually to configure standalone MCP server mode.

| Variable | Default | Set By | Capability |
|----------|---------|--------|------------|
| `CLAUDE_CODE_AGENT_NAME` | — | NativeBridge | Agent handle visible to the team |
| `CLAUDE_CODE_AGENT_ID` | — | NativeBridge | Unique agent identifier |
| `CLAUDE_CODE_TEAM_NAME` | `default` | NativeBridge | Team namespace for task/message isolation |
| `CLAUDE_CODE_AGENT_TYPE` | `worker` | NativeBridge | Role: `team-lead` \| `worker` \| `scout` \| `reviewer` |
| `CLAUDE_CODE_AGENT_UID` | — | MCP server (post-auth) | UID assigned after `/auth` registration |
| `CLAUDE_CODE_SWARM_ID` | — | Manual | Links agent to a specific swarm for coordinated spawning |
| `CLAUDE_CODE_SPAWN_BACKEND` | — | NativeBridge | Spawn mode override: `native` \| `tmux` \| `process` |

### External Integrations

| Variable | Default | Capability |
|----------|---------|------------|
| `LINEAR_API_KEY` | — | Enables Linear issue sync and MCP tools |
| `LINEAR_MCP_ENABLED` | — | Enables Linear tools in the MCP server |
| `GITHUB_WEBHOOK_SECRET` | `''` | HMAC secret for verifying GitHub webhook payloads |

---

## Internal Config Structs

These are the TypeScript types that consume the env vars above. Useful for
developers extending Fleet or writing custom spawn logic.

### ServerConfig

**Source**: `src/types.ts`

```typescript
interface ServerConfig {
  port: number;              // PORT
  dbPath: string;            // DB_PATH
  storageBackend?: string;   // STORAGE_BACKEND
  jwtSecret: string;         // JWT_SECRET
  jwtExpiresIn: string;      // JWT_EXPIRES_IN
  maxWorkers: number;        // MAX_WORKERS
  rateLimitWindow: number;   // hardcoded 60000
  rateLimitMax: number;      // hardcoded 100
  corsOrigins: string[];     // CORS_ORIGINS (split on comma)
  nativeOnly: boolean;       // FLEET_NATIVE_ONLY
}
```

### WorkerManagerOptions

**Source**: `src/workers/manager.ts`

| Field | Type | Default | Capability |
|-------|------|---------|------------|
| `maxWorkers` | `number` | `5` | Per-manager worker cap |
| `defaultTeamName` | `string` | `'default'` | Team name when none specified in spawn |
| `serverUrl` | `string` | — | Fleet URL injected into worker environment |
| `autoRestart` | `boolean` | `false` | Automatically restart failed workers up to `MAX_RESTART_ATTEMPTS` |
| `storage` | `SQLiteStorage` | — | Storage instance for persistence |
| `useWorktrees` | `boolean` | `false` | Enable git worktree isolation per worker |
| `worktreeBaseDir` | `string` | — | Directory for worktree checkouts |
| `injectMail` | `boolean` | `false` | Inject pending mail into worker prompts on spawn |
| `spawnController` | `SpawnController` | — | Attach spawn rate limiting and depth control |
| `defaultSpawnMode` | `SpawnMode` | `'process'` | Default mode when not specified in spawn request |
| `nativeOnly` | `boolean` | `false` | Mirror of `FLEET_NATIVE_ONLY` |

### SpawnControllerOptions

**Source**: `src/workers/spawn-controller.ts`

| Field | Type | Default | Capability |
|-------|------|---------|------------|
| `softLimit` | `number` | `50` | Warning threshold — spawns succeed but log alerts |
| `hardLimit` | `number` | `100` | Absolute cap — spawns rejected above this |
| `maxDepth` | `number` | `3` | Prevents recursive agent spawning chains |
| `autoProcess` | `boolean` | `true` | Automatically process the spawn queue |
| `processIntervalMs` | `number` | `5000` | Queue drain interval |

### NativeBridgeConfig

**Source**: `src/workers/native-bridge.ts`

| Field | Type | Default | Capability |
|-------|------|---------|------------|
| `teamsDir` | `string` | `~/.claude/teams` | Root directory for team coordination files |
| `tasksDir` | `string` | `~/.claude/tasks` | Root directory for native task JSON files |
| `claudeBinary` | `string` | auto-detected | Path to `claude` CLI binary |
| `fallbackToProcess` | `boolean` | `true` | Fall back to process spawn if native unavailable |

### TaskSyncConfig

**Source**: `src/workers/task-sync.ts`

| Field | Type | Default | Capability |
|-------|------|---------|------------|
| `tasksDir` | `string` | `~/.claude/tasks` | Watched directory for native task files |
| `debounceMs` | `number` | `100` | File-change debounce interval (ms) |
| `enabled` | `boolean` | `true` | Master switch for bidirectional task sync |

### InboxBridgeConfig

**Source**: `src/workers/inbox-bridge.ts`

| Field | Type | Default | Capability |
|-------|------|---------|------------|
| `teamsDir` | `string` | `~/.claude/teams` | Root directory for message files |
| `enabled` | `boolean` | `true` | Master switch for native inbox watching |
| `debounceMs` | `number` | `50` | File-change debounce interval (ms) |

---

## Hardcoded Constants

These values are not configurable via env vars but can be changed in source.

### Worker Health Thresholds

**Source**: `src/workers/manager.ts`

| Constant | Value | Capability |
|----------|-------|------------|
| `HEALTH_CHECK_INTERVAL` | `15000` ms (15s) | How often the health loop polls workers |
| `HEALTHY_THRESHOLD` | `30000` ms (30s) | Time without output before state → `degraded` |
| `UNHEALTHY_THRESHOLD` | `60000` ms (60s) | Time without output before state → `unhealthy` |
| `MAX_RESTART_ATTEMPTS` | `3` | Auto-restart limit per worker (requires `autoRestart: true`) |
| `MAX_OUTPUT_LINES` | `100` | Ring buffer size for cached worker output |

### Spawn Controller Limits

**Source**: `src/workers/spawn-controller.ts`

| Constant | Value | Capability |
|----------|-------|------------|
| `SOFT_AGENT_LIMIT` | `50` | Default soft limit (override via `SpawnControllerOptions.softLimit`) |
| `HARD_AGENT_LIMIT` | `100` | Default hard limit (override via `SpawnControllerOptions.hardLimit`) |
| `MAX_DEPTH_LEVEL` | `3` | Max recursive spawn depth |

### Compound Runner Timeouts

**Source**: `src/compound/runner.ts`

| Constant | Value | Capability |
|----------|-------|------------|
| `SESSION_NAME` | `'fleet-compound'` | Tmux session name for compound runs |
| `POLL_INTERVAL_MS` | `5000` ms (5s) | Worker status polling interval |
| `SERVER_STARTUP_TIMEOUT_MS` | `30000` ms (30s) | Max time to wait for Fleet server boot |
| `WORKER_TIMEOUT_FIRST_ITER_MS` | `600000` ms (10m) | First-iteration worker timeout |
| `WORKER_TIMEOUT_SUBSEQUENT_MS` | `300000` ms (5m) | Subsequent-iteration worker timeout |

### Workflow Engine

**Source**: `src/workers/workflow-engine.ts`

| Constant | Value | Capability |
|----------|-------|------------|
| `DEFAULT_PROCESS_INTERVAL_MS` | `5000` ms (5s) | Step processing loop interval |
| `DEFAULT_MAX_CONCURRENT_STEPS` | `5` | Parallel workflow step limit |

### Miscellaneous

| Constant | Value | Source | Capability |
|----------|-------|--------|------------|
| `MAX_ERRORS_PER_GATE` | `20` | `compound/feedback.ts` | Error extraction limit per gate check |
| `RAW_TAIL_LINES` | `15` | `compound/feedback.ts` | Lines captured from error output tail |
| `MAX_POINTS` | `720` | `routes/compound.ts` | Ring buffer size for time-series metrics (1h at 5s intervals) |
| `MAX_OUTPUT_LINES` | `1000` | `routes/audit.ts` | Audit output line cache limit |
| `ID_LENGTH` | `5` | `storage/workitems.ts` | Generated work-item ID length |
| Rate limit window | `60000` ms | `server.ts` | Request rate limit window |
| Rate limit max | `100` | `server.ts` | Max requests per rate limit window |
| WebSocket heartbeat | `30000` ms | `server.ts` | Ping/pong liveliness interval |

---

## Spawn Modes

**Source**: `src/types.ts` — `SpawnMode`

| Mode | Description | When to Use |
|------|-------------|-------------|
| `native` | Uses Claude Code's built-in TeammateTool. Tasks and messages sync via `~/.claude/tasks/` and `~/.claude/teams/` JSON files. | Batch tasks, CI pipelines, production. Preferred mode. |
| `tmux` | Spawns Claude Code inside a tmux pane. Output is captured via tmux pipe. | Interactive debugging, sessions requiring terminal access. |
| `external` | Registers an already-running Claude process. Fleet tracks state but does not manage the process lifecycle. | Compound runner, IDE-launched agents, external orchestrators. |
| `process` | **Deprecated.** Spawns a raw child process. No tmux, no native coordination. | Legacy compatibility only. Blocked when `FLEET_NATIVE_ONLY=true`. |

### Mode Selection Logic

1. If `FLEET_NATIVE_ONLY=true` → reject `process` mode, default to `native`
2. If spawn request specifies `spawnMode` → use that mode
3. If TaskRouter provides a recommendation → advisory only (does not override explicit mode)
4. Fallback → `WorkerManagerOptions.defaultSpawnMode` (default: `process`)

---

## Capability Matrix

Maps each major capability to the flags/config that enable it.

| Capability | Required Config | Optional Tuning |
|------------|----------------|-----------------|
| **Basic server** | `PORT`, `JWT_SECRET` | `CORS_ORIGINS`, `NODE_ENV` |
| **Worker spawning** | `MAX_WORKERS` | `defaultSpawnMode`, spawn controller limits |
| **Native integration** | `FLEET_NATIVE_ONLY=true` | `NativeBridgeConfig.*`, `TaskSyncConfig.*`, `InboxBridgeConfig.*` |
| **Bidirectional task sync** | TaskSyncBridge enabled (default) | `TaskSyncConfig.debounceMs` |
| **Native messaging** | InboxBridge enabled (default) | `InboxBridgeConfig.debounceMs` |
| **Agent discovery** | NativeBridge active | `NativeBridgeConfig.teamsDir` |
| **Dynamic team watching** | Automatic on `/auth` | — |
| **Agent memory** | Storage connected (automatic) | — |
| **Task routing** | `initialPrompt` in spawn request | — (advisory, non-blocking) |
| **Git worktrees** | `useWorktrees: true`, `worktreeBaseDir` | — |
| **Mail injection** | `injectMail: true` | — |
| **Auto-restart** | `autoRestart: true` | `MAX_RESTART_ATTEMPTS` |
| **Compound mode** | `fleet compound` CLI command | Compound runner timeouts |
| **Workflows** | Workflow storage + engine initialized | `DEFAULT_MAX_CONCURRENT_STEPS` |
| **Linear sync** | `LINEAR_API_KEY` | `LINEAR_MCP_ENABLED` |
| **GitHub webhooks** | `GITHUB_WEBHOOK_SECRET` | — |
| **SQLite storage** | `STORAGE_BACKEND=sqlite` (default) | `DB_PATH` |
| **DynamoDB storage** | `STORAGE_BACKEND=dynamodb` | `AWS_REGION`, `DYNAMODB_TABLE_PREFIX`, `DYNAMODB_ENDPOINT` |
| **S3 storage** | `STORAGE_BACKEND=s3` | `S3_BUCKET`, `AWS_REGION`, `S3_PREFIX`, `S3_ENDPOINT` |
| **Firestore storage** | `STORAGE_BACKEND=firestore` | `GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS` |
| **PostgreSQL storage** | `STORAGE_BACKEND=postgresql` | `DATABASE_URL`, `POSTGRESQL_SCHEMA`, `POSTGRESQL_POOL_SIZE` |
| **Prometheus metrics** | Always enabled | — |
| **Rate limiting** | Always enabled | `rateLimitWindow`, `rateLimitMax` |
| **WebSocket events** | Always enabled on `/ws` | Heartbeat interval (30s) |
| **Spawn depth control** | SpawnController attached | `softLimit`, `hardLimit`, `maxDepth` |

---

## Quick Start Examples

### Minimal Local Development

```bash
PORT=3847 npm run dev
```

Uses all defaults: SQLite at `./fleet.db`, random JWT secret, 5 max workers.

### Production with Native Mode

```bash
export PORT=3847
export NODE_ENV=production
export JWT_SECRET=$(openssl rand -base64 48)
export DB_PATH=/var/lib/fleet/fleet.db
export FLEET_NATIVE_ONLY=true
export MAX_WORKERS=20
npm run build && node dist/index.js
```

### Cloud Storage (DynamoDB)

```bash
export STORAGE_BACKEND=dynamodb
export AWS_REGION=us-west-2
export DYNAMODB_TABLE_PREFIX=prod_fleet_
npm run build && node dist/index.js
```

### Cloud Storage (PostgreSQL)

```bash
export STORAGE_BACKEND=postgresql
export DATABASE_URL=postgres://user:pass@host:5432/fleet
export POSTGRESQL_POOL_SIZE=20
npm run build && node dist/index.js
```

---

## See Also

- [Documentation Index](README.md) - Full documentation overview
- [ARCHITECTURE](ARCHITECTURE.md) - System architecture
- [DEPLOYMENT](DEPLOYMENT.md) - Production deployment guide
- [NATIVE-INTEGRATION](NATIVE-INTEGRATION.md) - Native Claude Code features
